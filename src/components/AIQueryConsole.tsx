/**
 * 智能检索问答控制台 —— 位于图谱正下方
 * ---------------------------------------------------------------------------
 * 一次提问的完整链路：
 *   1. 本地图谱检索：用 queryEngine 对本体做相关度排序，得到命中实体 / 关系，
 *      并即时把命中的节点与边在图谱上加亮（这一层不依赖大模型）。
 *   2. 数据接地（Grounding）：并行拉取已接入数据源的真实数据行，按命中实体优先，
 *      连同「源列 → 本体属性」映射一起注入提示词。
 *   3. 大模型作答：以流式方式调用用户所选厂商的 /chat/completions，
 *      回答严格依据「本体 + 真实数据集」，数据不足时明确说明。
 *   4. 未配置模型时优雅降级为本地检索结论，并给出接入引导。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Database,
  Eraser,
  Link2,
  Loader2,
  MessageSquareText,
  Send,
  Settings2,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { processQuery, generateQuerySuggestions, selectRelevantRows } from '../data/queryEngine';
import type { Ontology } from '../data/ontology';
import { describeLlm, isLlmConfigured } from '../data/llmProviders';
import {
  buildChatMessages,
  llmErrorHint,
  streamChatCompletion,
  isOutputLimitError,
  LlmError,
  type GroundingDataset,
  type LlmMessage,
} from '../lib/llmClient';
import { fetchEndpointRows } from '../lib/datasetFetcher';
import { usePanelResize } from '../hooks/usePanelResize';
import { SystemPromptModal } from './SystemPromptModal';

interface AIQueryConsoleProps {
  onOpenModelSettings: () => void;
}

interface DatasetUsage {
  id: string;
  name: string;
  entityName?: string;
  rowCount: number;
  injectedRows: number;
  error?: string;
}

interface AnswerMeta {
  engine: 'llm' | 'local';
  model?: string;
  answer: string;
  hitEntities: string[];
  hitRelationships: string[];
  datasets: DatasetUsage[];
  elapsedMs: number;
  contextChars: number;
}

// ── 上下文注入上限（召回无下限：命中多少注入多少；上限只做兜底防爆上下文） ──
const MAX_ENDPOINTS = 6;        // 一次提问最多纳入的数据源数
const ROWS_PER_ENDPOINT = 120;  // 每源注入上限（宽松兜底，实际由「问题相关性召回」决定）
const FETCH_ROWS = 400;         // 单源实际抓取的候选行数（给相关性筛选足够候选）
const CACHE_TTL = 60_000;       // 数据源结果缓存（毫秒）
const MAX_HISTORY_TURNS = 3;    // 多轮对话注入的历史轮数上限（防上下文爆炸）

/** 一轮已完成的多轮对话（问答对）。 */
interface ConsoleTurn {
  id: number;
  question: string;
  answer: string;
  engine: 'llm' | 'local';
}

// ── 轻量 Markdown 渲染（标题 / 列表 / 加粗 / 行内代码） ────────────────────
function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(
        <code key={`${prefix}-c${i++}`} className="ai-inline-code">{token.slice(1, -1)}</code>,
      );
    } else {
      nodes.push(<strong key={`${prefix}-b${i++}`}>{token.slice(2, -2)}</strong>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderRichText(text: string): ReactNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const current = list;
    const items = current.items.map((item, idx) => (
      <li key={idx}>{renderInline(item, `li${key}-${idx}`)}</li>
    ));
    blocks.push(
      current.ordered
        ? <ol key={`ol${key++}`} className="ai-list ai-list--ordered">{items}</ol>
        : <ul key={`ul${key++}`} className="ai-list">{items}</ul>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s*(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 4);
      blocks.push(
        <div key={`h${key++}`} className={`ai-heading ai-heading--${level}`}>
          {renderInline(heading[2], `h${key}`)}
        </div>,
      );
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }
    flushList();
    blocks.push(<p key={`p${key++}`} className="ai-paragraph">{renderInline(line, `p${key}`)}</p>);
  }
  flushList();
  return blocks;
}

export function AIQueryConsole({ onOpenModelSettings }: AIQueryConsoleProps) {
  const {
    currentOntology,
    endpoints,
    llm,
    aiSystemPrompt,
    selectEntity,
    setHighlights,
  } = useAppStore();

  const [expanded, setExpanded] = useState(true);
  const [question, setQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [meta, setMeta] = useState<AnswerMeta | null>(null);
  const [phase, setPhase] = useState<'idle' | 'retrieving' | 'streaming'>('idle');
  const [error, setError] = useState<{ message: string; hint: string; paramError?: boolean } | null>(null);
  // 多轮对话：turns 为已完成的历史问答；currentQuestion 是当前正在作答的一轮
  const [turns, setTurns] = useState<ConsoleTurn[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [showPromptModal, setShowPromptModal] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const turnIdRef = useRef(0);
  const cacheRef = useRef<Map<string, { at: number; rows: Record<string, unknown>[]; error?: string }>>(new Map());

  // ── 面板高度可拖动 ────────────────────────────────────
  // 分隔条在面板上沿，所以 reverse：指针上移 = 面板变高。
  // 上限按视口动态计算，给图谱区永远留出 ~300px，避免拖成「图谱消失」。
  const panelRef = useRef<HTMLElement | null>(null);
  const resize = usePanelResize({
    storageKey: 'ai-console-height',
    initial: 360,
    min: 150,
    max: () => Math.max(240, window.innerHeight - 300),
    axis: 'y',
    reverse: true,
    // 面板未拖动过时高度由内容决定，未必等于 initial；
    // 按下瞬间量取真实高度作为拖动基准，避免第一次拖动就跳一大截。
    resolveStartSize: () => panelRef.current?.getBoundingClientRect().height ?? null,
    label: '拖动调整问答面板高度',
  });

  const llmReady = isLlmConfigured(llm);
  const suggestions = useMemo(() => generateQuerySuggestions(currentOntology).slice(0, 4), [currentOntology]);

  // 卸载时中断请求
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  /** 并行拉取已接入数据源的真实数据行，命中实体对应的数据源优先。 */
  const collectGrounding = useCallback(async (
    ontology: Ontology,
    hitEntityIds: string[],
    question: string,
  ): Promise<{ datasets: GroundingDataset[]; usage: DatasetUsage[] }> => {
    const hit = new Set(hitEntityIds);
    // Array.prototype.sort 是稳定排序：命中实体的数据源排前，其余保持接入顺序
    const ranked = [...endpoints].sort((a, b) => {
      const aHit = a.entityTypeId && hit.has(a.entityTypeId) ? 0 : 1;
      const bHit = b.entityTypeId && hit.has(b.entityTypeId) ? 0 : 1;
      return aHit - bHit;
    }).slice(0, MAX_ENDPOINTS);

    const results = await Promise.all(ranked.map(async (endpoint) => {
      const cached = cacheRef.current.get(endpoint.id);
      if (cached && Date.now() - cached.at < CACHE_TTL) {
        return { endpoint, rows: cached.rows, error: cached.error };
      }
      const res = await fetchEndpointRows(endpoint, ontology, { timeoutMs: 12000, maxRows: FETCH_ROWS });
      cacheRef.current.set(endpoint.id, { at: Date.now(), rows: res.rows, error: res.error });
      return { endpoint, rows: res.rows, error: res.error };
    }));

    const datasets: GroundingDataset[] = [];
    const usage: DatasetUsage[] = [];
    for (const { endpoint, rows, error } of results) {
      const entity = endpoint.entityTypeId
        ? ontology.entityTypes.find((e) => e.id === endpoint.entityTypeId)
        : undefined;
      usage.push({
        id: endpoint.id,
        name: endpoint.name,
        entityName: entity?.name,
        rowCount: error ? 0 : rows.length,
        // 与真正注入上下文的口径保持一致：按问题相关性召回后的行数（未命中即 0）
        injectedRows: error
          ? 0
          : selectRelevantRows(rows, question, endpoint.columnMappings, ROWS_PER_ENDPOINT).length,
        error,
      });
      if (error || rows.length === 0) continue;
      datasets.push({
        name: endpoint.name,
        kind: endpoint.kind,
        entityTypeId: endpoint.entityTypeId,
        entityName: entity?.name,
        columnMappings: endpoint.columnMappings,
        source: endpoint.source,
        rowCount: rows.length,
        rows,
      });
    }
    return { datasets, usage };
  }, [endpoints]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
  }, []);

  const handleAsk = useCallback(async (rawQuestion?: string) => {
    const q = (rawQuestion ?? question).trim();
    if (!q) return;

    // 多轮对话：把上一轮已完成的问答归档（本轮在其基础上追问）
    if (draftAnswer && meta && currentQuestion) {
      const id = turnIdRef.current + 1;
      turnIdRef.current = id;
      const archived: ConsoleTurn = { id, question: currentQuestion, answer: draftAnswer, engine: meta.engine };
      setTurns((prev) => [...prev, archived]);
    }

    setExpanded(true);
    setError(null);
    setMeta(null);
    setDraftAnswer('');
    setCurrentQuestion(q);
    setQuestion('');
    setPhase('retrieving');

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // ① 本地图谱检索：命中的实体/关系立即加亮
    const local = processQuery(q, currentOntology);
    setHighlights(local.highlightEntities, local.highlightRelationships);

    const startedAt = Date.now();

    try {
      // ② 数据接地
      const { datasets, usage } = await collectGrounding(currentOntology, local.highlightEntities, q);
      if (runIdRef.current !== runId) return;

      const localHits = local.hits.slice(0, 8).map((h) => `${h.type === 'entity' ? '实体' : h.type === 'relationship' ? '关系' : h.type}：${h.label}${h.detail ? ` — ${h.detail}` : ''}`);
      // 多轮上下文：只带最近几轮的问答（本地降级结论不注入，避免误导模型）
      const history: LlmMessage[] = [];
      for (const t of turns.filter((t) => t.engine === 'llm').slice(-MAX_HISTORY_TURNS)) {
        history.push({ role: 'user', content: t.question });
        history.push({ role: 'assistant', content: t.answer });
      }
      const messages = buildChatMessages({
        question: q,
        ontology: currentOntology,
        datasets,
        localHits,
        rowsPerDataset: ROWS_PER_ENDPOINT,
        systemPrompt: aiSystemPrompt,
        history,
      });
      const contextChars = messages.reduce((sum, m) => sum + m.content.length, 0);

      // ③ 未配置模型 → 降级为本地结论
      if (!llmReady) {
        setMeta({
          engine: 'local',
          answer: local.result,
          hitEntities: local.highlightEntities,
          hitRelationships: local.highlightRelationships,
          datasets: usage,
          elapsedMs: Date.now() - startedAt,
          contextChars,
        });
        setDraftAnswer(local.result);
        setPhase('idle');
        return;
      }

      // ④ 流式调用大模型
      setPhase('streaming');
      const result = await streamChatCompletion({
        config: llm,
        messages,
        signal: controller.signal,
        onDelta: (_delta, full) => {
          if (runIdRef.current !== runId) return;
          setDraftAnswer(full);
        },
      });
      if (runIdRef.current !== runId) return;

      setMeta({
        engine: 'llm',
        model: result.model ?? llm.model,
        answer: result.content,
        hitEntities: local.highlightEntities,
        hitRelationships: local.highlightRelationships,
        datasets: usage,
        elapsedMs: Date.now() - startedAt,
        contextChars,
      });
      setDraftAnswer(result.content);
      setPhase('idle');
    } catch (err) {
      if (runIdRef.current !== runId) return;
      const code = err instanceof LlmError ? err.code : 'unknown';
      if (code === 'aborted') { setPhase('idle'); return; }
      const detail = err instanceof Error ? err.message : String(err);
      // 参数类报错（最典型的就是 max_tokens 越界）直接在提示里说清怎么改，
      // 否则用户只会看到厂商的英文原文而无从下手。
      // 「思考耗尽输出额度」（empty-length）同样要去模型设置里调大额度，因此也亮出入口。
      const paramError = code === 'bad-request' || code === 'empty-length' || isOutputLimitError(detail);
      setError({
        message: detail,
        hint:
          code === 'empty-length'
            ? llmErrorHint('empty-length')
            : paramError
              ? '请在右上角「模型连接」中把「最大输出 Token」调小（建议 2048–4096）后重试；系统已自动尝试忽略该参数重试一次。'
              : llmErrorHint(code),
        paramError,
      });
      // 大模型失败时仍保留本地检索结论，保证有可用输出
      setMeta({
        engine: 'local',
        answer: local.result,
        hitEntities: local.highlightEntities,
        hitRelationships: local.highlightRelationships,
        datasets: [],
        elapsedMs: Date.now() - startedAt,
        contextChars: 0,
      });
      setDraftAnswer(local.result);
      setPhase('idle');
    }
  }, [question, draftAnswer, meta, currentQuestion, turns, aiSystemPrompt, currentOntology, collectGrounding, llm, llmReady, setHighlights]);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setDraftAnswer('');
    setMeta(null);
    setError(null);
    setPhase('idle');
    setQuestion('');
    setTurns([]);
    setCurrentQuestion('');
    setHighlights([], []);
  }, [setHighlights]);

  const busy = phase !== 'idle';

  return (
    <>
      {/* 水平分隔条：上下拖动调整问答面板高度，双击复位回自适应 */}
      {expanded && (
        <div
          className={`panel-resizer panel-resizer--horizontal ${resize.dragging ? 'is-dragging' : ''}`}
          {...resize.handleProps}
        />
      )}

      <section
        ref={panelRef}
        className={`ai-console ${expanded ? 'is-expanded' : 'is-collapsed'} ${resize.customized ? 'is-sized' : ''}`}
        style={{ '--ai-console-height': `${resize.size}px` } as CSSProperties}
        aria-label="智能检索问答"
      >
        <div className="ai-console-head">
        <button
          className="ai-console-toggle"
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
        >
          <span className="ai-console-icon"><Sparkles size={15} /></span>
          <span className="ai-console-title">智能检索问答</span>
          <span className="ai-console-sub">基于本体知识图谱 + 真实数据集</span>
          {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>

        <div className="ai-console-head-right">
          <button
            className={`ai-prompt-btn ${aiSystemPrompt.trim() ? 'is-custom' : ''}`}
            onClick={() => setShowPromptModal(true)}
            title="设定智能问答 Agent 的系统提示词"
            aria-label="设置系统提示词"
          >
            <MessageSquareText size={13} />
            <span>提示词</span>
          </button>
          <button
            className={`ai-model-chip ${llmReady ? 'is-ready' : 'is-unset'}`}
            onClick={onOpenModelSettings}
            title={llmReady ? '点击修改模型连接' : '尚未接入大模型，点击配置'}
          >
            {llmReady ? <Bot size={13} /> : <WifiOff size={13} />}
            <span>{llmReady ? describeLlm(llm) : '未接入大模型'}</span>
            <Settings2 size={12} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="ai-console-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="ai-console-inner">
              {/* 输入区 */}
              <div className="ai-input-row">
                <input
                  type="text"
                  className="ai-input"
                  placeholder={
                    turns.length > 0
                      ? '继续追问…（将结合之前的问答与最新数据）'
                      : `针对 ${currentOntology.name} 提问，例如：金牌会员的订单总额是多少？`
                  }
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void handleAsk(); }}
                  aria-label="检索问题"
                />
                {busy ? (
                  <button className="btn btn-secondary ai-send-btn" onClick={handleStop} title="停止">
                    <CircleStop size={16} /> 停止
                  </button>
                ) : (
                  <button
                    className="btn btn-primary ai-send-btn"
                    onClick={() => void handleAsk()}
                    disabled={!question.trim()}
                  >
                    <Send size={16} /> 检索
                  </button>
                )}
                {(draftAnswer || error || turns.length > 0) && !busy && (
                  <button className="icon-btn" onClick={handleClear} title="清空对话" aria-label="清空对话">
                    <Eraser size={16} />
                  </button>
                )}
              </div>

              {/* 示例问题（仅首轮展示） */}
              {turns.length === 0 && !draftAnswer && !busy && !error && (
                <div className="ai-suggestions">
                  <span className="ai-suggestions-label">可以试试这样问：</span>
                  {suggestions.map((s) => (
                    <button key={s} className="ai-chip" onClick={() => void handleAsk(s)}>{s}</button>
                  ))}
                </div>
              )}

              {/* 多轮对话历史 */}
              {turns.length > 0 && (
                <div className="ai-turns">
                  <div className="ai-turns-label">
                    多轮对话 · {turns.length} 轮（模型结合历史与最新数据回答）
                  </div>
                  {turns.map((t) => (
                    <div key={t.id} className="ai-turn">
                      <div className="ai-turn-q">
                        <span className="ai-turn-badge">问</span>
                        <span className="ai-turn-q-text">{t.question}</span>
                      </div>
                      <div className="ai-turn-a">{renderRichText(t.answer)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* 进度 */}
              {phase === 'retrieving' && (
                <div className="ai-progress">
                  <Loader2 size={14} className="endpoint-spin" />
                  <span>正在检索本体结构并拉取已接入数据源的真实数据…</span>
                </div>
              )}
              {phase === 'streaming' && (
                <div className="ai-progress">
                  <Loader2 size={14} className="endpoint-spin" />
                  <span>{describeLlm(llm)} 正在基于 {meta?.datasets.length ?? 0} 个数据集作答…</span>
                </div>
              )}

              {/* 错误 */}
              {error && (
                <div className="ai-error">
                  <AlertCircle size={14} />
                  <div>
                    <div className="ai-error-msg">{error.message}</div>
                    <div className="ai-error-hint">{error.hint}</div>
                    {(!llmReady || error.paramError) && (
                      <button className="ai-link-btn" onClick={onOpenModelSettings}>模型设置 →</button>
                    )}
                  </div>
                </div>
              )}

              {/* 当前这轮的问题（多轮时历史问题在上面的历史区展示） */}
              {draftAnswer && currentQuestion && (
                <div className="ai-turn-q is-current">
                  <span className="ai-turn-badge">问</span>
                  <span className="ai-turn-q-text">{currentQuestion}</span>
                </div>
              )}

              {/* 回答 */}
              {draftAnswer && (
                <div className="ai-answer">
                  <div className="ai-answer-body">
                    {renderRichText(draftAnswer)}
                    {phase === 'streaming' && <span className="ai-caret" />}
                  </div>
                </div>
              )}

              {/* 依据 */}
              {meta && !busy && (
                <div className="ai-citations">
                  <div className="ai-citations-row">
                    {meta.engine === 'llm' ? (
                      <span className="ai-citations-engine is-llm">
                        <Bot size={12} /> {meta.model ?? llm.model}
                      </span>
                    ) : (
                      <span className="ai-citations-engine is-local">
                        <Database size={12} /> 本地图谱检索引擎
                      </span>
                    )}
                    <span className="ai-citations-meta">
                      耗时 {(meta.elapsedMs / 1000).toFixed(1)}s · 上下文 {meta.contextChars} 字符
                    </span>
                  </div>

                  <div className="ai-citations-group">
                    <span className="ai-citations-label"><Database size={11} /> 依据本体</span>
                    <span className="ai-cite-item">
                      {currentOntology.name} · {currentOntology.entityTypes.length} 实体 / {currentOntology.relationships.length} 关系
                    </span>
                  </div>

                  <div className="ai-citations-group">
                    <span className="ai-citations-label"><Link2 size={11} /> 依据数据集</span>
                    {meta.datasets.length === 0 && (
                      <span className="ai-cite-item ai-cite-item--muted">未接入数据源，仅依据本体结构作答</span>
                    )}
                    {meta.datasets.map((d) => {
                      // 召回无下限：该源与问题无关时会注入 0 行，用中性样式区分「未命中」与「失败」
                      const empty = !d.error && d.injectedRows === 0;
                      return (
                        <span
                          key={d.id}
                          className={`ai-cite-item ${d.error ? 'is-error' : ''} ${empty ? 'ai-cite-item--muted' : ''}`}
                          title={
                            d.error
                              ? `拉取失败：${d.error}`
                              : empty
                                ? `${d.rowCount} 行，但本问题未命中相关行（注入 0 行）`
                                : `${d.rowCount} 行，注入 ${d.injectedRows} 行`
                          }
                        >
                          {d.error ? <AlertCircle size={11} /> : <CheckCircle size={11} />}
                          {d.name}
                          {d.entityName && <em>→ {d.entityName}</em>}
                          <b>{d.error ? '失败' : empty ? '未命中' : `${d.injectedRows} 行`}</b>
                        </span>
                      );
                    })}
                  </div>

                  {meta.hitEntities.length > 0 && (
                    <div className="ai-citations-group">
                      <span className="ai-citations-label"><Sparkles size={11} /> 图谱命中</span>
                      {meta.hitEntities.map((id) => {
                        const entity = currentOntology.entityTypes.find((e) => e.id === id);
                        if (!entity) return null;
                        return (
                          <button
                            key={id}
                            className="ai-hit-chip"
                            onClick={() => selectEntity(id)}
                            title="在检视器中打开"
                          >
                            <span style={{ color: entity.color }}>{entity.icon}</span> {entity.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 本地降级提示：引导用户接入大模型 */}
                  {meta.engine === 'local' && !llmReady && !error && (
                    <div className="ai-upgrade-hint">
                      <WifiOff size={12} />
                      <span>
                        以上为本地图谱检索结论。接入 GPT / DeepSeek / GLM 等大模型后，
                        可由模型基于本体与 <strong>{meta.datasets.filter((d) => !d.error).length}</strong> 个真实数据集生成自然语言回答。
                      </span>
                      <button className="ai-link-btn" onClick={onOpenModelSettings}>接入模型 →</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 系统提示词设置弹窗 */}
      {showPromptModal && (
        <SystemPromptModal onClose={() => setShowPromptModal(false)} />
      )}
      </section>
    </>
  );
}
