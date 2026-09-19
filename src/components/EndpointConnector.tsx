import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Plus,
  Trash2,
  RefreshCw,
  Database,
  Globe,
  Code2,
  FileJson,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  FileUp,
  Wand2,
  ArrowRight,
  Layers,
  CheckSquare,
  Square,
  Link2,
  Library,
  Info,
} from 'lucide-react';
import { useAppStore, type DataEndpoint, type EndpointKind } from '../store/appStore';
import {
  MAX_IMPORT_BYTES,
  autoMapColumns,
  fileNameToEndpointName,
  parseImportFile,
  readFileAsText,
  type AutoImportResult,
  type GraphImportResult,
} from '../lib/jsonAutoImport';
import { countReuploadEndpoints, saveUserOntology } from '../lib/userOntologyLibrary';

interface EndpointConnectorProps {
  onClose: () => void;
}

/**
 * 手动填写的数据源类型。**JSON 文件排第一且是默认值** ——
 * 这是本产品最常见的接入方式，其余类型（REST / SPARQL / GraphQL）排在其后。
 */
const KIND_OPTIONS: { id: EndpointKind; label: string; description: string; icon: typeof Globe; placeholder: string }[] = [
  {
    id: 'json-file',
    label: 'JSON 文件',
    description: '从可访问的 JSON 文件直接加载',
    icon: Database,
    placeholder: 'https://example.com/data.json',
  },
  {
    id: 'rest',
    label: 'REST API',
    description: '从 RESTful 接口拉取 JSON 数据',
    icon: Globe,
    placeholder: 'https://api.example.com/customers',
  },
  {
    id: 'sparql',
    label: 'SPARQL',
    description: '查询 RDF 三元组存储（DBpedia、Wikidata 等）',
    icon: Code2,
    placeholder: 'https://dbpedia.org/sparql',
  },
  {
    id: 'graphql',
    label: 'GraphQL',
    description: '通过 GraphQL 端点拉取数据',
    icon: FileJson,
    placeholder: 'https://api.example.com/graphql',
  },
];

/**
 * 自动解析接入的状态机。
 * `ready` = 扁平行数组（一个数据源）；`graph` = 多实体分桶图（一桶一个数据源）。
 */
type AutoImportState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string }
  | { status: 'ready'; result: AutoImportResult; name: string; entityTypeId: string | null }
  | {
      status: 'graph';
      result: GraphImportResult;
      /** 数据源名称前缀，最终名称是 `${name} · ${桶名}`。 */
      name: string;
      /** 被用户取消勾选的桶名（默认全选，所以记「隐藏」比记「选中」更省）。 */
      hidden: string[];
      /** 是否把关系表也接成一个数据源。 */
      includeRelationships: boolean;
    }
  | { status: 'error'; fileName: string; message: string };

export function EndpointConnector({ onClose }: EndpointConnectorProps) {
  const { endpoints, addEndpoint, resetEndpoints, updateEndpoint, removeEndpoint, currentOntology, dataBindings } = useAppStore();
  const [form, setForm] = useState<{
    name: string;
    kind: EndpointKind;
    url: string;
    headers: string;
  }>({ name: '', kind: 'json-file', url: '', headers: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetNotice, setResetNotice] = useState(false);
  /** 自动解析接入成功后的临时提示（2.2s 后自动消失）。 */
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  /** 「存入本体库」的反馈（含提示文案，稍长，2.8s 后自动消失）。 */
  const [libraryNotice, setLibraryNotice] = useState<{ text: string; hint?: string; error?: boolean } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const libraryTimer = useRef<number | null>(null);
  /** 自动解析接入：上传 JSON 文件后的解析结果。 */
  const [auto, setAuto] = useState<AutoImportState>({ status: 'idle' });
  const [autoDragOver, setAutoDragOver] = useState(false);
  const autoFileRef = useRef<HTMLInputElement>(null);

  /**
   * 当前选中实体下的列映射。
   * 做成派生值而不是存进 state —— 用户在预览里换实体时映射要跟着重算，
   * 存 state 就得在 onChange 里手动同步，容易漏。
   */
  const autoMappings = useMemo(() => {
    if (auto.status !== 'ready' || !auto.entityTypeId) return {};
    const entity = currentOntology.entityTypes.find((e) => e.id === auto.entityTypeId);
    return autoMapColumns(auto.result.columns, entity);
  }, [auto, currentOntology]);

  /**
   * 当前本体实体索引，用于展示数据源映射到的实体。
   * 必须跟着 `currentOntology` 走 —— 写死成内置本体的话，用户导入自己的
   * 本体后，已接入列表里的实体标签会全部消失。
   */
  const entityById = useMemo(
    () => new Map(currentOntology.entityTypes.map((e) => [e.id, e])),
    [currentOntology],
  );

  // Lock body scroll while modal open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // 卸载时清掉提示定时器，避免 unmounted 后 setState
  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    if (libraryTimer.current) window.clearTimeout(libraryTimer.current);
  }, []);

  /** 弹一条 2.2s 的「已接入：<名称>」提示。 */
  const flashNotice = useCallback((name: string) => {
    setActionNotice(name);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setActionNotice(null), 2200);
  }, []);

  // ── 自动解析接入：读文件 → 解析 → 预览 → 接入 ────────────────────────────

  /** 读取并解析上传的 JSON 文件（失败时落到 error 状态，不抛异常）。 */
  const processAutoFile = useCallback(async (file: File) => {
    if (!/\.json$/i.test(file.name)) {
      setAuto({
        status: 'error',
        fileName: file.name,
        message: '请上传 .json 文件。如果是 CSV / Excel，请先另存为 JSON 再上传。',
      });
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setAuto({
        status: 'error',
        fileName: file.name,
        message: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请控制在 ${MAX_IMPORT_BYTES / 1024 / 1024} MB 以内。`,
      });
      return;
    }

    setAuto({ status: 'parsing', fileName: file.name });
    try {
      const text = await readFileAsText(file);
      const result = parseImportFile(text, file.name, currentOntology);
      const name = fileNameToEndpointName(file.name);
      if (result.kind === 'graph') {
        setAuto({
          status: 'graph',
          result,
          name,
          hidden: [],
          includeRelationships: result.relationshipRows.length > 0,
        });
      } else {
        setAuto({ status: 'ready', result, name, entityTypeId: result.entityTypeId });
      }
    } catch (err) {
      setAuto({
        status: 'error',
        fileName: file.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentOntology]);

  /** 把解析结果正式接入为一个数据源（数据留在内存，不走网络）。 */
  const handleAutoConnect = useCallback(() => {
    if (auto.status !== 'ready') return;
    const name = auto.name.trim() || fileNameToEndpointName(auto.result.fileName);
    addEndpoint({
      name,
      kind: 'json-file',
      // url 仅作为标识保留，实际读取走 localRows
      url: `local://${auto.result.fileName}`,
      entityTypeId: auto.entityTypeId ?? undefined,
      columnMappings: Object.keys(autoMappings).length > 0 ? autoMappings : undefined,
      localRows: auto.result.rows,
      localFileName: auto.result.fileName,
    });
    setAuto({ status: 'idle' });
    if (autoFileRef.current) autoFileRef.current.value = '';
    flashNotice(name);
  }, [auto, autoMappings, addEndpoint, flashNotice]);

  /** 清掉当前解析结果，回到初始态。 */
  const resetAutoImport = useCallback(() => {
    setAuto({ status: 'idle' });
    if (autoFileRef.current) autoFileRef.current.value = '';
  }, []);

  // ── 分桶图的预览交互：勾选桶 / 命名 / 是否接关系 ──────────────────────────

  /** 切换单个桶的勾选状态。 */
  const toggleBucket = useCallback((bucketName: string) => {
    setAuto((prev) => {
      if (prev.status !== 'graph') return prev;
      const hidden = prev.hidden.includes(bucketName)
        ? prev.hidden.filter((n) => n !== bucketName)
        : [...prev.hidden, bucketName];
      return { ...prev, hidden };
    });
  }, []);

  /** 全选 / 全不选。 */
  const toggleAllBuckets = useCallback((checked: boolean) => {
    setAuto((prev) =>
      prev.status === 'graph'
        ? { ...prev, hidden: checked ? [] : prev.result.buckets.map((b) => b.name) }
        : prev,
    );
  }, []);

  /** 在分桶预览态下改名称前缀 / 关系开关（非 graph 态下是空操作）。 */
  const patchGraphPreview = (patch: Partial<{ name: string; includeRelationships: boolean }>) => {
    setAuto((prev) => (prev.status === 'graph' ? { ...prev, ...patch } : prev));
  };

  /** 分桶图勾选后可接入的数据源数量。 */
  const graphTargetCount = useMemo(() => {
    if (auto.status !== 'graph') return 0;
    const hidden = new Set(auto.hidden);
    const buckets = auto.result.buckets.filter((b) => !hidden.has(b.name)).length;
    const relations = auto.includeRelationships && auto.result.relationshipRows.length > 0 ? 1 : 0;
    return buckets + relations;
  }, [auto]);

  /** 分桶图里已经自动匹配到本体实体的桶数量。 */
  const graphMatchedCount = useMemo(
    () => (auto.status === 'graph' ? auto.result.buckets.filter((b) => b.entityTypeId).length : 0),
    [auto],
  );

  /**
   * 把分桶图展开接入：每个桶一个数据源，外加（可选的）一个关系数据源。
   * 同名数据源已存在时原地刷新数据 —— 重新上传同一份文件等于「更新」，
   * 不会在列表里堆出一串重复项。
   */
  const handleAutoConnectGraph = useCallback(() => {
    if (auto.status !== 'graph') return;
    const { result, hidden, includeRelationships } = auto;
    const baseName = auto.name.trim() || fileNameToEndpointName(result.fileName);
    const hiddenSet = new Set(hidden);

    const targets: Omit<DataEndpoint, 'id'>[] = result.buckets
      .filter((b) => !hiddenSet.has(b.name))
      .map((b) => ({
        kind: 'json-file' as const,
        name: `${baseName} · ${b.name}`,
        url: `local://${result.fileName}#${b.name}`,
        entityTypeId: b.entityTypeId ?? undefined,
        columnMappings: Object.keys(b.columnMappings).length > 0 ? b.columnMappings : undefined,
        localRows: b.rows,
        localFileName: result.fileName,
      }));

    if (includeRelationships && result.relationshipRows.length > 0) {
      const relationKey = result.relationshipKey ?? 'relationships';
      targets.push({
        kind: 'json-file',
        name: `${baseName} · ${relationKey}`,
        url: `local://${result.fileName}#${relationKey}`,
        localRows: result.relationshipRows,
        localFileName: result.fileName,
      });
    }
    if (targets.length === 0) return;

    for (const target of targets) {
      const existing = endpoints.find((e) => e.name === target.name);
      if (existing) updateEndpoint(existing.id, target);
      else addEndpoint(target);
    }

    setAuto({ status: 'idle' });
    if (autoFileRef.current) autoFileRef.current.value = '';
    flashNotice(`${targets.length} 个数据源`);
  }, [auto, endpoints, addEndpoint, updateEndpoint, flashNotice]);

  /** 在预览态下修改名称 / 实体（非 preview 态下是空操作）。 */
  const patchAutoPreview = (patch: Partial<{ name: string; entityTypeId: string | null }>) => {
    setAuto((prev) => (prev.status === 'ready' ? { ...prev, ...patch } : prev));
  };

  const handleAdd = useCallback(async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('请填写端点名称');
      return;
    }
    if (!form.url.trim()) {
      setFormError('请填写 URL');
      return;
    }
    try {
      new URL(form.url);
    } catch {
      setFormError('URL 格式不正确');
      return;
    }

    let parsedHeaders: Record<string, string> | undefined;
    if (form.headers.trim()) {
      try {
        parsedHeaders = JSON.parse(form.headers);
        if (typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
          setFormError('Headers 必须是 JSON 对象');
          return;
        }
      } catch (err) {
        setFormError('Headers JSON 解析失败：' + (err instanceof Error ? err.message : String(err)));
        return;
      }
    }

    addEndpoint({
      name: form.name.trim(),
      kind: form.kind,
      url: form.url.trim(),
      headers: parsedHeaders,
    });

    setForm({ name: '', kind: 'rest', url: '', headers: '' });
    setFormOpen(false);
  }, [form, addEndpoint]);

  const handleTest = useCallback(async (target: { id: string; url: string; localRows?: unknown[] }) => {
    const { id, url } = target;
    updateEndpoint(id, { lastFetchStatus: 'idle', lastError: undefined });
    setTesting(true);
    try {
      // 本地 JSON 文件的数据源没有可请求的地址，直接判定为可用
      if (target.localRows) {
        updateEndpoint(id, { lastFetchStatus: 'ok', lastFetchedAt: Date.now(), lastError: undefined });
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json,*/*' } });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      updateEndpoint(id, { lastFetchStatus: 'ok', lastFetchedAt: Date.now(), lastError: undefined });
    } catch (err) {
      updateEndpoint(id, {
        lastFetchStatus: 'error',
        lastError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }, [updateEndpoint]);

  const handleReset = useCallback(() => {
    resetEndpoints();
    setResetNotice(true);
    setTimeout(() => setResetNotice(false), 2400);
  }, [resetEndpoints]);

  /**
   * 把当前已接入的数据源**存入本体库**（连同当前本体一起）。
   *
   * 存的是「本体 + 数据源」这一个包：之后在本体库里加载这条记录，
   * 本体与数据源会一并恢复，不用重新配置。
   * 本地 JSON 文件的行数据体积不可控，入库时会剥离（见 userOntologyLibrary），
   * 这里据此提示用户「哪几个源加载后需要重新上传文件」。
   */
  const handleSaveToLibrary = useCallback(() => {
    if (endpoints.length === 0) return;
    const reupload = countReuploadEndpoints(endpoints);
    try {
      saveUserOntology(currentOntology, dataBindings, endpoints);
      setLibraryNotice({
        text: `已把「${currentOntology.name}」与 ${endpoints.length} 个数据源存入本体库`,
        hint: reupload > 0
          ? `其中 ${reupload} 个是本地 JSON 文件，行数据不随库存放，从本体库加载后需重新上传该文件。`
          : '可在「本体库 · 我的」里随时重新加载。',
      });
      if (libraryTimer.current) window.clearTimeout(libraryTimer.current);
      libraryTimer.current = window.setTimeout(() => setLibraryNotice(null), 2800);
    } catch (err) {
      setLibraryNotice({
        text: err instanceof Error ? err.message : String(err),
        error: true,
      });
      if (libraryTimer.current) window.clearTimeout(libraryTimer.current);
      libraryTimer.current = window.setTimeout(() => setLibraryNotice(null), 4200);
    }
  }, [endpoints, currentOntology, dataBindings]);


  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal-content"
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 20 }}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, maxHeight: '88vh', overflow: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={20} color="var(--ms-blue)" />
              接入数据源
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
              平台不内置任何数据集。通过下面两种方式接入你自己的数据：
              <strong>自动解析</strong>（上传 JSON 文件，自动识别实体与列映射）或
              <strong>手动填写</strong>（REST / SPARQL / GraphQL / JSON 文件地址）。
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>

        {/* Summary bar */}
        <div className="datasource-summary">
          <div className="datasource-summary-item">
            <span className="datasource-summary-value">{endpoints.length}</span>
            <span className="datasource-summary-label">已接入</span>
          </div>
          <div className="datasource-summary-actions">
            <button
              className="datasource-save-btn"
              onClick={handleSaveToLibrary}
              disabled={endpoints.length === 0}
              title={
                endpoints.length === 0
                  ? '先接入数据源，再存入本体库'
                  : `把当前本体「${currentOntology.name}」与这 ${endpoints.length} 个数据源一起存入本体库`
              }
            >
              <Library size={13} /> 存入本体库
            </button>
            <button
              className="datasource-reset-btn"
              onClick={handleReset}
              title="断开并移除全部数据源，回到初始的空白状态"
            >
              <RotateCcw size={13} /> 清空全部
            </button>
          </div>
        </div>

        {libraryNotice && (
          <div
            className={`endpoint-status ${libraryNotice.error ? 'endpoint-status--err' : 'endpoint-status--ok'}`}
            style={{ marginBottom: 14 }}
            role="status"
            aria-live="polite"
          >
            {libraryNotice.error ? <AlertCircle size={12} /> : <CheckCircle size={12} />}
            <span>
              {libraryNotice.text}
              {libraryNotice.hint && (
                <span className="datasource-save-hint"><Info size={11} /> {libraryNotice.hint}</span>
              )}
            </span>
          </div>
        )}

        {resetNotice && (
          <div className="endpoint-status endpoint-status--ok" style={{ marginBottom: 14 }}>
            <CheckCircle size={12} />
            <span>已清空全部数据源，回到初始状态</span>
          </div>
        )}

        {/* 自动解析接入成功后的即时反馈：2.2s 后自动消失 */}
        {actionNotice && (
          <div
            className="endpoint-status endpoint-status--ok"
            style={{ marginBottom: 14 }}
            role="status"
            aria-live="polite"
          >
            <CheckCircle size={12} />
            <span>已接入：{actionNotice}</span>
          </div>
        )}

        {/* Connected endpoints */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
            已接入的数据源（{endpoints.length}）
          </div>

          {endpoints.length === 0 && (
            <div style={{
              padding: 20,
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
            }}>
              还没有接入任何数据源。展开「自定义接入」上传 JSON 文件自动解析，或手动填写数据源地址。
            </div>
          )}

          {endpoints.map((ep) => {
            const opt = KIND_OPTIONS.find((k) => k.id === ep.kind);
            const Icon = opt?.icon ?? Database;
            const entity = ep.entityTypeId ? entityById.get(ep.entityTypeId) : undefined;
            return (
              <div key={ep.id} className="endpoint-card">
                <div className="endpoint-card-header">
                  <div className="endpoint-card-icon">
                    <Icon size={16} />
                  </div>
                  <div className="endpoint-card-info">
                    <div className="endpoint-card-name">
                      {ep.name}
                    </div>
                    <div className="endpoint-card-meta">
                      <span className="endpoint-kind-pill">
                        {ep.localRows ? '本地文件' : ep.needsFileReupload ? '本地文件（待上传）' : (opt?.label ?? ep.kind)}
                      </span>
                      {entity && (
                        <span className="preset-entity-pill" title="映射到的本体实体">
                          <span className="preset-entity-dot" style={{ background: entity.color }} />
                          {entity.name}
                        </span>
                      )}
                      {ep.localRows ? (
                        <span className="endpoint-card-url endpoint-card-url--local" title="数据来自本地文件，未上传到任何服务器">
                          <FileJson size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                          {ep.localFileName ?? ep.name} · {ep.localRows.length} 行
                        </span>
                      ) : ep.needsFileReupload ? (
                        <span
                          className="endpoint-card-url endpoint-card-url--local is-pending"
                          title="这条数据源来自本体库，行数据不随库存放；请重新上传该文件以恢复数据"
                        >
                          <AlertCircle size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                          {ep.localFileName ?? ep.name} · 需重新上传文件
                        </span>
                      ) : (
                        <a href={ep.url} target="_blank" rel="noreferrer" className="endpoint-card-url" title="在浏览器打开">
                          {ep.url}
                          <ExternalLink size={10} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="endpoint-card-actions">
                    <button
                      className="icon-btn"
                      onClick={() => handleTest(ep)}
                      disabled={testing}
                      title="测试连接"
                      aria-label="测试连接"
                    >
                      <RefreshCw size={14} className={testing ? 'endpoint-spin' : ''} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => removeEndpoint(ep.id)}
                      title="删除"
                      aria-label="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {ep.lastFetchStatus === 'ok' && (
                  <div className="endpoint-status endpoint-status--ok">
                    <CheckCircle size={12} />
                    <span>最近一次连通性测试成功（{ep.lastFetchedAt ? new Date(ep.lastFetchedAt).toLocaleTimeString() : ''}）</span>
                  </div>
                )}
                {ep.lastFetchStatus === 'error' && (
                  <div className="endpoint-status endpoint-status--err">
                    <AlertCircle size={12} />
                    <span>连通性测试失败：{ep.lastError ?? '未知错误'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Custom endpoint form (collapsible) */}
        <div style={{
          padding: 16,
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 18,
        }}>
          <button
            className="endpoint-form-toggle"
            onClick={() => setFormOpen((o) => !o)}
            aria-expanded={formOpen}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> 自定义接入
            </span>
            {formOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {formOpen && (
            <div style={{ marginTop: 14 }}>
              {/* ── 自动解析接入：上传 JSON 文件，自动识别实体与列映射 ── */}
              <div className="auto-import">
                <div className="auto-import-head">
                  <Wand2 size={14} />
                  <span>自动解析接入</span>
                  <span className="auto-import-head-hint">
                    上传 JSON 文件，自动识别实体与列映射；多实体分桶文件会按桶拆成多个数据源
                  </span>
                </div>

                {auto.status === 'idle' && (
                  <div
                    className={`auto-import-drop ${autoDragOver ? 'is-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setAutoDragOver(true); }}
                    onDragLeave={() => setAutoDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setAutoDragOver(false);
                      const file = e.dataTransfer?.files?.[0];
                      if (file) void processAutoFile(file);
                    }}
                    onClick={() => autoFileRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        autoFileRef.current?.click();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label="选择 JSON 文件"
                  >
                    <FileUp size={20} />
                    <div className="auto-import-drop-title">点击选择 JSON 文件，或拖拽到此处</div>
                    <div className="auto-import-drop-sub">
                      支持对象数组、items / rows / results / data 包装、单个对象，
                      以及 {'{ objects: { 实体名: [...] }, relationships: [...] }'} 这类多实体分桶文件；
                      单个文件最大 {MAX_IMPORT_BYTES / 1024 / 1024} MB
                    </div>
                  </div>
                )}

                {auto.status === 'parsing' && (
                  <div className="auto-import-hint">
                    <RefreshCw size={13} className="endpoint-spin" />
                    <span>正在解析 {auto.fileName} …</span>
                  </div>
                )}

                {auto.status === 'error' && (
                  <div className="auto-import-error">
                    <AlertCircle size={13} />
                    <span><strong>{auto.fileName}</strong>：{auto.message}</span>
                    <button type="button" className="auto-import-link" onClick={resetAutoImport}>重新选择</button>
                  </div>
                )}

                {auto.status === 'ready' && (
                  <div className="auto-import-preview">
                    <div className="auto-import-file">
                      <FileJson size={13} />
                      <strong>{auto.result.fileName}</strong>
                      <span>{auto.result.rows.length} 行 · {auto.result.columns.length} 列</span>
                    </div>

                    <div className="auto-import-grid">
                      <div>
                        <label className="endpoint-form-label" htmlFor="auto-import-name">数据源名称</label>
                        <input
                          id="auto-import-name"
                          className="endpoint-form-input"
                          value={auto.name}
                          onChange={(e) => patchAutoPreview({ name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="endpoint-form-label" htmlFor="auto-import-entity">映射到的本体实体</label>
                        <select
                          id="auto-import-entity"
                          className="endpoint-form-input"
                          value={auto.entityTypeId ?? ''}
                          onChange={(e) => patchAutoPreview({ entityTypeId: e.target.value || null })}
                        >
                          <option value="">（不映射，仅作为原始数据接入）</option>
                          {currentOntology.entityTypes.map((entity) => (
                            <option key={entity.id} value={entity.id}>{entity.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="auto-import-map-head">
                      <span>列映射（自动识别）</span>
                      <span className="auto-import-map-count">
                        {Object.keys(autoMappings).length}/{auto.result.columns.length} 列已映射
                      </span>
                    </div>
                    <div className="auto-import-map">
                      {auto.result.columns.slice(0, 24).map((column) => {
                        const prop = autoMappings[column];
                        return (
                          <span key={column} className={`auto-import-chip ${prop ? 'is-mapped' : ''}`}>
                            <code>{column}</code>
                            {prop ? (
                              <>
                                <ArrowRight size={11} />
                                <code className="auto-import-chip-target">{prop}</code>
                              </>
                            ) : (
                              <em>未映射</em>
                            )}
                          </span>
                        );
                      })}
                      {auto.result.columns.length > 24 && (
                        <span className="auto-import-chip auto-import-chip-more">
                          另有 {auto.result.columns.length - 24} 列…
                        </span>
                      )}
                    </div>

                    {auto.result.warnings.map((w) => (
                      <div key={w} className="auto-import-warn">
                        <AlertCircle size={12} />
                        <span>{w}</span>
                      </div>
                    ))}
                    {!auto.entityTypeId && (
                      <div className="auto-import-warn">
                        <AlertCircle size={12} />
                        <span>未能自动识别对应的本体实体，请在上方下拉框手动选择。</span>
                      </div>
                    )}
                    {auto.entityTypeId && Object.keys(autoMappings).length === 0 && (
                      <div className="auto-import-warn">
                        <AlertCircle size={12} />
                        <span>没有识别出列映射，接入后需手动补充映射才能被检索命中。</span>
                      </div>
                    )}

                    <div className="auto-import-actions">
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleAutoConnect}>
                        <Plus size={14} /> 接入这个数据源
                      </button>
                      <button className="btn btn-secondary" onClick={resetAutoImport}>重新选择</button>
                    </div>
                  </div>
                )}

                {/* ── 多实体分桶图：一桶一个数据源 ── */}
                {auto.status === 'graph' && (
                  <div className="auto-import-preview">
                    <div className="auto-import-file">
                      <Layers size={13} />
                      <strong>{auto.result.fileName}</strong>
                      <span>
                        {auto.result.buckets.length} 个实体桶 · {auto.result.totalRows} 行
                        {auto.result.relationshipRows.length > 0 &&
                          ` · ${auto.result.relationshipRows.length} 条关系`}
                      </span>
                    </div>

                    {(auto.result.metadata.scenario || auto.result.metadata.domain) && (
                      <div className="auto-import-meta">
                        {auto.result.metadata.domain && <span>领域：{auto.result.metadata.domain}</span>}
                        {auto.result.metadata.scenario && <span>场景：{auto.result.metadata.scenario}</span>}
                      </div>
                    )}

                    <div className="auto-import-grid">
                      <div>
                        <label className="endpoint-form-label" htmlFor="auto-import-prefix">数据源名称前缀</label>
                        <input
                          id="auto-import-prefix"
                          className="endpoint-form-input"
                          value={auto.name}
                          onChange={(e) => patchGraphPreview({ name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="endpoint-form-label" htmlFor="auto-import-matched">本体实体匹配</label>
                        <div id="auto-import-matched" className="auto-import-stat">
                          {graphMatchedCount}/{auto.result.buckets.length} 个桶已匹配
                        </div>
                      </div>
                    </div>

                    <div className="auto-import-map-head">
                      <span>实体桶（点击可取消接入）</span>
                      <button
                        type="button"
                        className="auto-import-link"
                        onClick={() => toggleAllBuckets(auto.hidden.length > 0)}
                      >
                        {auto.hidden.length > 0 ? '全选' : '全不选'}
                      </button>
                    </div>

                    <div className="auto-import-buckets">
                      {auto.result.buckets.map((bucket) => {
                        const checked = !auto.hidden.includes(bucket.name);
                        const entity = bucket.entityTypeId ? entityById.get(bucket.entityTypeId) : undefined;
                        return (
                          <button
                            type="button"
                            key={bucket.name}
                            className={`auto-import-bucket ${checked ? 'is-on' : ''}`}
                            onClick={() => toggleBucket(bucket.name)}
                            aria-pressed={checked}
                            title={checked ? '点击取消接入这个桶' : '点击接入这个桶'}
                          >
                            <span className="auto-import-bucket-check" aria-hidden="true">
                              {checked ? <CheckSquare size={13} /> : <Square size={13} />}
                            </span>
                            <code className="auto-import-bucket-name">{bucket.name}</code>
                            <span className="auto-import-bucket-meta">
                              {bucket.rows.length} 行 · {bucket.columns.length} 列
                            </span>
                            {entity ? (
                              <span className="auto-import-bucket-entity">
                                <span className="preset-entity-dot" style={{ background: entity.color }} />
                                {entity.name}
                                {bucket.entitySource === 'columns' && <em>（按列名推断）</em>}
                              </span>
                            ) : (
                              <span className="auto-import-bucket-entity is-none">未匹配</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {auto.result.relationshipRows.length > 0 && (
                      <button
                        type="button"
                        className={`auto-import-relation ${auto.includeRelationships ? 'is-on' : ''}`}
                        onClick={() => patchGraphPreview({ includeRelationships: !auto.includeRelationships })}
                        aria-pressed={auto.includeRelationships}
                      >
                        <span className="auto-import-bucket-check" aria-hidden="true">
                          {auto.includeRelationships ? <CheckSquare size={13} /> : <Square size={13} />}
                        </span>
                        <Link2 size={12} />
                        <span>
                          同时接入关系表 <code>{auto.result.relationshipKey}</code>
                          （{auto.result.relationshipRows.length} 条 ·
                          {' '}{auto.result.relationshipColumns.join(' / ')}）
                        </span>
                      </button>
                    )}

                    {auto.result.warnings.map((w) => (
                      <div key={w} className="auto-import-warn">
                        <AlertCircle size={12} />
                        <span>{w}</span>
                      </div>
                    ))}
                    {graphMatchedCount === 0 && (
                      <div className="auto-import-warn">
                        <AlertCircle size={12} />
                        <span>
                          当前本体里找不到与桶名对应的实体，数据仍可接入，但检索与问答命中不到；
                          建议先导入这份数据对应的本体，再重新上传本文件。
                        </span>
                      </div>
                    )}

                    <div className="auto-import-actions">
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1 }}
                        onClick={handleAutoConnectGraph}
                        disabled={graphTargetCount === 0}
                      >
                        <Plus size={14} /> 接入选中的 {graphTargetCount} 个数据源
                      </button>
                      <button className="btn btn-secondary" onClick={resetAutoImport}>重新选择</button>
                    </div>
                  </div>
                )}

                <input
                  ref={autoFileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void processAutoFile(file);
                  }}
                />
              </div>

              <div className="auto-import-divider"><span>或手动填写</span></div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="endpoint-form-label">名称</label>
                  <input
                    className="endpoint-form-input"
                    placeholder="例如：我的 SPARQL 仓库"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="endpoint-form-label">类型</label>
                  <select
                    className="endpoint-form-input"
                    value={form.kind}
                    onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as EndpointKind }))}
                  >
                    {KIND_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="endpoint-form-label">URL</label>
                <input
                  className="endpoint-form-input"
                  placeholder={KIND_OPTIONS.find((k) => k.id === form.kind)?.placeholder}
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                />
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {KIND_OPTIONS.find((k) => k.id === form.kind)?.description}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="endpoint-form-label">自定义 Headers（JSON，可选）</label>
                <textarea
                  className="endpoint-form-input"
                  placeholder='{ "Authorization": "Bearer ..." }'
                  rows={2}
                  value={form.headers}
                  onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>

              {formError && (
                <div style={{
                  padding: 10,
                  background: 'rgba(232, 17, 35, 0.12)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: '#E81123',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <AlertCircle size={14} /> {formError}
                </div>
              )}

              <button className="btn btn-primary" onClick={handleAdd} style={{ width: '100%' }}>
                <Plus size={14} /> 添加数据源
              </button>
            </div>
          )}
        </div>

        <div style={{
          padding: 12,
          background: 'rgba(0, 120, 212, 0.08)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}>
          数据源接入后，可在右侧「实例浏览」中查看已拉取的真实数据；系统会按数据源声明的
          <strong> 列映射 </strong>把源系统字段翻译成本体属性，自然语言查询也会自动引用这些真实数据。
          配置完成后可点上方
          <strong> 存入本体库 </strong>
          把当前本体与这些数据源一起保存，之后在本体库里一键恢复。
        </div>

        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
