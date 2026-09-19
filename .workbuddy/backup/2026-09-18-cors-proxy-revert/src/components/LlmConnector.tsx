import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  ShieldCheck,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  ExternalLink,
  Info,
  Zap,
  Plug,
  Sparkles,
  Terminal,
  Activity,
  Wand2,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import {
  LLM_PROVIDERS,
  allPresetModels,
  findProvider,
  isLlmConfigured,
  maskApiKey,
  resolveChatEndpoint,
  normalizeMaxTokens,
  proxyPrefixIssue,
  withProxy,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  DEFAULT_LOCAL_PROXY_BASE,
} from '../data/llmProviders';
import {
  testConnection,
  diagnoseProxyFailure,
  llmErrorHint,
  probeProxy,
  isMixedContentRisk,
  LlmError,
} from '../lib/llmClient';

interface LlmConnectorProps {
  onClose: () => void;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; reply: string; elapsedMs: number; model?: string }
  | { status: 'error'; message: string };

type ProxyProbeState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message: string; elapsedMs: number }
  | { status: 'error'; message: string };

/** 右上角「模型连接」入口使用的图标（AI 芯片 + 神经元 + 引脚）。 */
export function ModelConnectionIcon({ size = 20, connected = false }: { size?: number; connected?: boolean }) {
  const accent = connected ? 'var(--ms-green, #107C10)' : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 芯片本体 */}
      <rect x="6" y="6" width="12" height="12" rx="3" />
      {/* 内部神经元与总线 */}
      <path d="M9 12h6" />
      <circle cx="9.2" cy="12" r="1.5" fill={accent} stroke="none" />
      <circle cx="14.8" cy="12" r="1.5" fill={accent} stroke="none" />
      {/* 引脚 */}
      <path d="M9.5 6V3.6M14.5 6V3.6M9.5 18v2.4M14.5 18v2.4M6 9.5H3.6M6 14.5H3.6M18 9.5h2.4M18 14.5h2.4" />
    </svg>
  );
}

export function LlmConnector({ onClose }: LlmConnectorProps) {
  const { llm, setLlmConfig, resetLlmConfig } = useAppStore();
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [proxyProbe, setProxyProbe] = useState<ProxyProbeState>({ status: 'idle' });
  const apiKey = llm.apiKey;
  const proxyBaseUrl = llm.proxyBaseUrl ?? '';

  const provider = useMemo(() => findProvider(llm.providerId), [llm.providerId]);
  const configured = isLlmConfigured(llm);
  const chatEndpoint = resolveChatEndpoint(llm.baseUrl);

  /** https 页面 + http 代理会被浏览器拦成「混合内容」，这类失败在本地开发看不出来。 */
  const mixedContentRisk = useMemo(
    () => isMixedContentRisk(typeof window === 'undefined' ? '' : window.location.href, proxyBaseUrl),
    [proxyBaseUrl],
  );

  /** 代理前缀的写法校验（协议 / 是否误带路径）—— 写错时请求会静默失败，必须提前点出来。 */
  const proxyIssue = useMemo(() => proxyPrefixIssue(proxyBaseUrl), [proxyBaseUrl]);

  /**
   * 实际请求地址 —— 必须复用 withProxy 这同一个函数，不能自己拼字符串：
   * 早先这里漏了中间那个 `/`，界面上显示的地址（`…:8787https://…`）
   * 跟真正请求的地址不是一回事，排障时反而被它带偏。
   */
  const requestUrl = useMemo(() => withProxy(chatEndpoint, proxyBaseUrl), [chatEndpoint, proxyBaseUrl]);

  // 锁定背景滚动
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // 监听 Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleProviderChange = useCallback((id: string) => {
    setTest({ status: 'idle' });
    if (id === 'custom') {
      setLlmConfig({ providerId: id });
      return;
    }
    const preset = findProvider(id);
    if (!preset) return;
    setLlmConfig({
      providerId: id,
      baseUrl: preset.baseUrl,
      model: preset.defaultModel,
    });
  }, [setLlmConfig]);

  const handleTest = useCallback(async () => {
    if (!configured) {
      setTest({ status: 'error', message: llmErrorHint('not-configured') });
      return;
    }
    setTest({ status: 'testing' });
    try {
      const result = await testConnection(llm);
      setTest({ status: 'ok', reply: result.reply, elapsedMs: result.elapsedMs, model: result.model });
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      const detail = err instanceof Error ? err.message : String(err);
      const hasProxy = Boolean(proxyBaseUrl.trim());
      // 网络类失败：浏览器只给一句 Failed to fetch，看不出是代理没起、前缀写错还是 Key 不对。
      // 这里自动探一次代理，并把**这同一次**探测结果喂给「检测代理」面板 ——
      // 两处结论必须来自同一次探测，否则用户会看到自相矛盾的两句话。
      if ((code === 'cors' || code === 'network') && hasProxy) {
        const diagnosis = await diagnoseProxyFailure(llm);
        if (diagnosis) {
          setProxyProbe(
            diagnosis.reachable
              ? { status: 'ok', message: diagnosis.probeMessage, elapsedMs: diagnosis.probeElapsedMs }
              : { status: 'error', message: diagnosis.probeMessage },
          );
          setTest({ status: 'error', message: `${diagnosis.message}（${detail}）` });
          return;
        }
      }
      // 已配代理时，失败原因指向代理而非跨域 —— 提示必须跟着变，否则用户被引到错误方向
      setTest({ status: 'error', message: `${llmErrorHint(code, { hasProxy })}（${detail}）` });
    }
  }, [configured, llm, proxyBaseUrl]);

  /** 一键把代理前缀填成内置代理的默认地址。 */
  const handleFillLocalProxy = useCallback(() => {
    setLlmConfig({ proxyBaseUrl: DEFAULT_LOCAL_PROXY_BASE });
    setTest({ status: 'idle' });
    setProxyProbe({ status: 'idle' });
  }, [setLlmConfig]);

  /** 探测代理是否真的在跑 —— 与真实模型请求分开，才能分清「代理没起」和「Key 不对」。 */
  const handleProbeProxy = useCallback(async () => {
    setProxyProbe({ status: 'testing' });
    const result = await probeProxy(proxyBaseUrl);
    setProxyProbe(
      result.ok
        ? { status: 'ok', message: result.message, elapsedMs: result.elapsedMs }
        : { status: 'error', message: result.message },
    );
  }, [proxyBaseUrl]);

  const handleClearKey = useCallback(() => {
    setLlmConfig({ apiKey: '' });
    setTest({ status: 'idle' });
  }, [setLlmConfig]);

  const handleReset = useCallback(() => {
    resetLlmConfig();
    setTest({ status: 'idle' });
  }, [resetLlmConfig]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        className="modal-content llm-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.18 }}
        role="dialog"
        aria-label="模型连接设置"
      >
        {/* 头部 */}
        <div className="llm-modal-head">
          <div className="llm-modal-head-left">
            <span className={`llm-modal-icon ${configured ? 'is-connected' : ''}`}>
              <ModelConnectionIcon size={22} connected={configured} />
            </span>
            <div>
              <h2 className="llm-modal-title">模型连接</h2>
              <p className="llm-modal-sub">
                接入市面常用大模型，让检索问答基于本体知识图谱与真实数据集作答
              </p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>

        {/* 当前状态 */}
        <div className={`llm-status-banner ${configured ? 'ok' : 'warn'}`}>
          {configured ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <div>
            <strong>{configured ? '已就绪' : '尚未配置'}</strong>
            <span>
              {configured
                ? `${provider?.label ?? '自定义'} · ${llm.model}｜接口：${chatEndpoint}`
                : '未配置时，「智能检索问答」会自动降级为本地图谱检索（不调用大模型）。'}
            </span>
          </div>
        </div>

        {/* 厂商选择 */}
        <div className="llm-section">
          <div className="llm-section-title">
            <Zap size={14} /> 选择厂商
          </div>
          <div className="llm-provider-grid">
            {LLM_PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`llm-provider-card ${llm.providerId === p.id ? 'active' : ''}`}
                onClick={() => handleProviderChange(p.id)}
              >
                <span className="llm-provider-dot" style={{ background: p.accent }} />
                <span className="llm-provider-name">{p.label}</span>
                <span className="llm-provider-vendor">{p.vendor}</span>
              </button>
            ))}
          </div>
          <div className="llm-provider-meta">
            {provider?.note && (
              <div className="llm-note">
                <Info size={12} />
                <span>{provider.note}</span>
              </div>
            )}
            <div className="llm-meta-row">
              {provider?.lastUpdated && (
                <span className="llm-meta-chip" title="本项目内置该厂商模型清单的最近一次同步月份">
                  📅 清单更新：{provider.lastUpdated}
                </span>
              )}
              {provider?.modelsUrl && (
                <a
                  className="llm-meta-chip llm-meta-chip--link"
                  href={provider.modelsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={11} /> 厂商最新模型清单
                </a>
              )}
              {provider?.consoleUrl && (
                <a
                  className="llm-meta-chip llm-meta-chip--link"
                  href={provider.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={11} /> 申请 API Key
                </a>
              )}
            </div>
          </div>
        </div>

        {/* 接口与鉴权 */}
        <div className="llm-section">
          <div className="llm-section-title">
            <Plug size={14} /> 接口与鉴权
          </div>

          <label className="llm-field">
            <span className="llm-field-label">接口地址（/chat/completions）</span>
            <input
              className="endpoint-form-input"
              type="text"
              value={llm.baseUrl}
              placeholder="https://api.deepseek.com/chat/completions"
              onChange={(e) => { setLlmConfig({ baseUrl: e.target.value }); setTest({ status: 'idle' }); }}
            />
          </label>

          <label className="llm-field">
            <span className="llm-field-label">
              API Key
              {provider && !provider.requiresKey && <em className="llm-field-hint">（本地模型可留空）</em>}
            </span>
            <span className="llm-key-row">
              <input
                className="endpoint-form-input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setLlmConfig({ apiKey: e.target.value });
                  setTest({ status: 'idle' });
                }}
              />
              <button
                className="icon-btn"
                onClick={() => setShowKey((s) => !s)}
                title={showKey ? '隐藏' : '显示'}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {apiKey && (
                <button className="llm-mini-btn" onClick={handleClearKey}>清除</button>
              )}
            </span>
            {apiKey && (
              <span className="llm-field-hint">当前：{maskApiKey(apiKey)}</span>
            )}
          </label>

          <label className="llm-field">
            <span className="llm-field-label">模型名称</span>
            <input
              className="endpoint-form-input"
              type="text"
              list="llm-model-options"
              value={llm.model}
              placeholder={provider?.defaultModel || 'deepseek-chat'}
              onChange={(e) => { setLlmConfig({ model: e.target.value }); setTest({ status: 'idle' }); }}
            />
            <datalist id="llm-model-options">
              {provider && allPresetModels(provider).map((m) => (<option key={m} value={m} />))}
            </datalist>
            {provider && allPresetModels(provider).length > 0 && (
              <div className="llm-model-selector">
                {/* ⭐ 推荐组（厂商当下主推的几个） */}
                {provider.featuredModels.length > 0 && (
                  <div className="llm-chip-group llm-chip-group--featured">
                    <span className="llm-chip-group-label">
                      <Sparkles size={12} /> 推荐模型
                    </span>
                    <span className="llm-model-chips">
                      {provider.featuredModels.map((m) => (
                        <button
                          key={`feat-${m}`}
                          className={`llm-chip llm-chip--featured ${llm.model === m ? 'active' : ''}`}
                          onClick={() => { setLlmConfig({ model: m }); setTest({ status: 'idle' }); }}
                          title={`厂商主推：${m}`}
                        >
                          {m}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
                {/* 📜 全部模型（datalist 也能下拉） */}
                {provider.models.length > 0 && (
                  <details className="llm-chip-group">
                    <summary>
                      全部 {provider.models.length} 个模型
                      <span className="llm-chip-group-summary">展开</span>
                    </summary>
                    <span className="llm-model-chips">
                      {provider.models.map((m) => (
                        <button
                          key={m}
                          className={`llm-chip ${llm.model === m ? 'active' : ''}`}
                          onClick={() => { setLlmConfig({ model: m }); setTest({ status: 'idle' }); }}
                        >
                          {m}
                        </button>
                      ))}
                    </span>
                  </details>
                )}
              </div>
            )}
          </label>

          <div className="llm-field-row">
            <label className="llm-field llm-field--half">
              <span className="llm-field-label">温度（{llm.temperature}）</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={llm.temperature}
                onChange={(e) => setLlmConfig({ temperature: Number(e.target.value) })}
              />
            </label>
            <label className="llm-field llm-field--half">
              <span className="llm-field-label">最大输出 Token</span>
              <input
                className="endpoint-form-input"
                type="number"
                min={MIN_OUTPUT_TOKENS}
                max={MAX_OUTPUT_TOKENS}
                step={64}
                value={llm.maxTokens}
                onChange={(e) => setLlmConfig({ maxTokens: normalizeMaxTokens(e.target.value) })}
                onBlur={(e) => setLlmConfig({ maxTokens: normalizeMaxTokens(e.target.value) })}
              />
              <span className="llm-field-hint">
                可填 {MIN_OUTPUT_TOKENS}–{MAX_OUTPUT_TOKENS}（不同模型上限不同，超出会被自动收敛）
              </span>
            </label>
          </div>
        </div>

        {/* 高级：代理 */}
        <details className="llm-advanced">
          <summary>
            高级：跨域代理与私有网关
            {proxyBaseUrl.trim() && <span className="llm-advanced-badge">已开启</span>}
          </summary>

          <label className="llm-field" style={{ marginTop: 10 }}>
            <span className="llm-field-label">代理前缀（可选）</span>
            <input
              className="endpoint-form-input"
              type="text"
              value={proxyBaseUrl}
              placeholder={DEFAULT_LOCAL_PROXY_BASE}
              onChange={(e) => {
                setLlmConfig({ proxyBaseUrl: e.target.value });
                // 地址变了，上次的检测结果就过期了 —— 留着会误导
                setProxyProbe({ status: 'idle' });
              }}
            />
            <span className="llm-field-hint">
              代理前缀会拼在接口地址前面，实际请求 <code>{requestUrl}</code>
              （漏写 <code>http://</code> 会自动补上）。
              主流厂商已放行浏览器跨域，通常无需配置；<strong>自建网关 / 私有反代若未返回 CORS 响应头</strong>，
              浏览器会直接抛「Failed to fetch」，此时必须走本地代理。
            </span>
            {proxyIssue && (
              <div className="llm-test-result error" style={{ marginTop: 8 }}>
                <AlertCircle size={14} />
                <span>{proxyIssue}</span>
              </div>
            )}
          </label>

          <div className="llm-proxy-actions">
            <button type="button" className="btn btn-secondary" onClick={handleFillLocalProxy}>
              <Wand2 size={13} /> 填入本地代理
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleProbeProxy()}
              disabled={!proxyBaseUrl.trim() || proxyProbe.status === 'testing'}
            >
              {proxyProbe.status === 'testing'
                ? <Loader2 size={13} className="endpoint-spin" />
                : <Activity size={13} />}
              检测代理
            </button>
          </div>

          <div className="llm-proxy-cmd">
            <Terminal size={13} />
            <span>本机先启动代理：</span>
            <code>npm run llm:proxy</code>
          </div>

          {proxyProbe.status === 'ok' && (
            <div className="llm-test-result ok" style={{ marginTop: 10 }}>
              <CheckCircle size={14} />
              <span>{proxyProbe.message} · {proxyProbe.elapsedMs}ms</span>
            </div>
          )}
          {proxyProbe.status === 'error' && (
            <div className="llm-test-result error" style={{ marginTop: 10 }}>
              <AlertCircle size={14} />
              <span>{proxyProbe.message}</span>
            </div>
          )}

          {mixedContentRisk && (
            <div className="llm-test-result error" style={{ marginTop: 10 }}>
              <AlertCircle size={14} />
              <span>
                当前页面是 https，而代理填的是 http —— 浏览器会按「混合内容」直接拦截，
                与跨域是两回事。请让代理走 https，或把代理与页面部署在同源路径下（如 <code>/llm-proxy</code>）。
              </span>
            </div>
          )}
        </details>

        {/* 测试结果 */}
        {test.status === 'error' && (
          <div className="llm-test-result error">
            <AlertCircle size={14} />
            <span>{test.message}</span>
          </div>
        )}
        {test.status === 'ok' && (
          <div className="llm-test-result ok">
            <CheckCircle size={14} />
            <span>
              连接成功 · {test.elapsedMs}ms{test.model ? ` · 模型 ${test.model}` : ''} · 模型回复「{test.reply}」
            </span>
          </div>
        )}

        {/* 隐私说明 */}
        <div className="llm-privacy">
          <ShieldCheck size={14} />
          <span>
            API Key 仅保存在本机浏览器 localStorage，不会上传到本平台服务器；发起提问时，本体结构与已接入数据集的样本行会随请求发送给你所选择的模型厂商。
          </span>
        </div>

        {/* 底部操作 */}
        <div className="llm-modal-actions">
          <button className="btn btn-secondary" onClick={handleReset} title="恢复默认厂商与空 Key">
            <RotateCcw size={14} /> 重置
          </button>
          {provider?.consoleUrl && (
            <a className="btn btn-secondary" href={provider.consoleUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> 获取 API Key
            </a>
          )}
          <button className="btn btn-secondary" onClick={handleTest} disabled={test.status === 'testing'}>
            {test.status === 'testing' ? <Loader2 size={14} className="endpoint-spin" /> : <Zap size={14} />}
            {test.status === 'testing' ? '测试中…' : '测试连接'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </motion.div>
    </div>
  );
}
