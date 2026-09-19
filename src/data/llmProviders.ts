/**
 * 大模型厂商预设 —— 让平台具备调用市面常用大模型 API 的能力
 * ---------------------------------------------------------------------------
 * 本文件把「智能检索问答」所需的模型接入配置固化下来。所有预设统一使用
 * **OpenAI 兼容协议**（POST {baseUrl}，Header `Authorization: Bearer <apiKey>`，
 * Body `{ model, messages, temperature, stream }`），这也是目前国内主流厂商
 * （DeepSeek / 智谱 GLM / 通义千问 / Kimi / 硅基流动 等）共同支持的接口形态，
 * 因此一套客户端代码即可切换所有厂商。
 *
 * 模型清单随时间滚动更新（`lastUpdated`），默认值为最近一个月内厂商
 * 官方主推型号。`featuredModels` 是 UI 中"推荐"组展示的几个；下方
 * `models` 则是 datalist 下拉可选项，方便用户选历史稳定型号。
 *
 * 已通过实测验证各厂商接口返回 `Access-Control-Allow-Origin`，
 * 浏览器可直连（见 docs/llm-integration.md）。若使用私有网关或企业内网模型，
 * 可选择「自定义（OpenAI 兼容）」并填写你自己的接口地址。
 */

/**
 * 运行时模型配置 —— 保存在浏览器 localStorage，不会上传到任何第三方，
 * 仅在发起对话请求时随 Header 发送给用户所选厂商。
 */
export interface LlmConfig {
  /** 厂商预设 id（或 'custom'）。 */
  providerId: string;
  /** 对话补全接口地址（完整 URL）。 */
  baseUrl: string;
  /** API Key。本地 Ollama 等无需鉴权的端点可留空。 */
  apiKey: string;
  /** 模型名称。 */
  model: string;
  /** 采样温度 0–2。检索问答建议 0–0.3 以降低幻觉。 */
  temperature: number;
  /** 单次回答最大 token 数。 */
  maxTokens: number;
  /**
   * 站点内代理前缀（可选）。当浏览器直连目标厂商被 CORS 拦截时，
   * 可填写自建网关地址，最终请求会变为 `${proxyBaseUrl}${真正的接口地址}`。
   */
  proxyBaseUrl?: string;
}

export interface LlmProviderPreset {
  id: string;
  /** 展示名称，如「DeepSeek」。 */
  label: string;
  /** 厂商全称，用于副标题。 */
  vendor: string;
  /** 对话补全接口（完整地址）。 */
  baseUrl: string;
  /** 默认模型（新手一键接入就用这个）。 */
  defaultModel: string;
  /**
   * 推荐模型列表 —— UI 上会突出展示为「⭐ 推荐」。
   * 一般包含厂商当下最新可用的 2-3 个旗舰/性价比型号。
   */
  featuredModels: string[];
  /** 模型清单（datalist 全部可选项），含历史与推荐型号。 */
  models: string[];
  /** 是否需要 API Key（本地 Ollama 可为空）。 */
  requiresKey: boolean;
  /** 品牌色，用于卡片与状态标识。 */
  accent: string;
  /** 申请 Key 的地址。 */
  consoleUrl?: string;
  /** 厂商官网最新模型列表的链接，方便用户校对。 */
  modelsUrl?: string;
  /** 使用提示。 */
  note?: string;
  /** 该 preset 最后一次同步的年月（YYYY-MM），用户看到时便于判断新鲜度。 */
  lastUpdated?: string;
}

export const LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI GPT',
    vendor: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5-mini',
    featuredModels: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-pro'],
    models: [
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-5-pro',
      'o4-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
    ],
    requiresKey: true,
    accent: '#10A37F',
    consoleUrl: 'https://platform.openai.com/api-keys',
    modelsUrl: 'https://platform.openai.com/docs/models',
    note: 'gpt-5-mini 综合性价比最高；gpt-5-pro 用于强推理；gpt-5-nano 最低时延；gpt-5-chat-latest 已下线。',
    lastUpdated: '2026-09',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    vendor: '深度求索',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-v4-flash',
    featuredModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    models: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-0731',
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-v3.2',
      'deepseek-v3',
    ],
    requiresKey: true,
    accent: '#4D6BFE',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    modelsUrl: 'https://platform.deepseek.com/api-docs/',
    note: 'v4-Flash（284B/13B 激活）快且性价比最高；v4-Pro 是 1.6T/49B 激活的强推理型号；deepseek-chat 是 V3 系列的稳定经典；deepseek-reasoner 会附带思维链。',
    lastUpdated: '2026-09',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    vendor: '智谱 AI（BigModel）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4.7',
    featuredModels: ['glm-4.7', 'glm-4.7-flash', 'glm-5', 'glm-5-turbo'],
    models: [
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-5v-turbo',
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4.7-flashx',
      'glm-4.6',
      'glm-4.6v',
      'glm-4.5-air',
      'glm-4-long',
    ],
    requiresKey: true,
    accent: '#3859FF',
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    modelsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    note: 'GLM-5 系列对齐 Claude Opus 4.5，专为长程 Agent 设计（可自主工作 8 小时+）；GLM-4.7-Flash 免费，适合本地试用；GLM-5.3 是 2026-09 期间推出的最新型号。',
    lastUpdated: '2026-09',
  },
  {
    id: 'dashscope',
    label: '通义千问 Qwen',
    vendor: '阿里云百炼（DashScope 兼容模式）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen3.7-max',
    featuredModels: [
      'qwen3.8-max',
      'qwen3.7-max',
      'qwen3-max',
      'qwen-plus',
      'qwen-flash',
    ],
    models: [
      'qwen3.8-max',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3-max',
      'qwen3-coder-plus',
      'qwen3-vl-plus',
      'qwen3-vl-flash',
      'qwen3-omni-flash',
      'qwen-plus',
      'qwen-flash',
      'qwen-long-latest',
      'qwq-plus',
      'deepseek-v3.2',
      'deepseek-v3',
      'deepseek-r1',
    ],
    requiresKey: true,
    accent: '#615CED',
    consoleUrl: 'https://bailian.console.aliyun.com/',
    modelsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
    note: 'Qwen3.8-Max 是 2026-08-03 最新旗舰；Qwen-Plus 综合性价比高；Qwen-Flash 速度最快；DashScope 兼容模式跨域已放行。',
    lastUpdated: '2026-09',
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    vendor: 'Moonshot AI',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'kimi-k3',
    featuredModels: ['kimi-k3', 'kimi-k2.5', 'kimi-k2-thinking'],
    models: [
      'kimi-k3',
      'kimi-k2.5',
      'kimi-k2-0905-preview',
      'kimi-k2-thinking',
      'kimi-k2-thinking-turbo',
    ],
    requiresKey: true,
    accent: '#0F1014',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    modelsUrl: 'https://platform.moonshot.cn/docs/intro',
    note: 'kimi-k3 是当前主推型号（kimi-k2 系列已 2026-05-25 下线）；k2 系列如仍在用 ID 仍可继续调用但不再官方维护。',
    lastUpdated: '2026-09',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    vendor: '聚合网关（多家开源模型）',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    featuredModels: [
      'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-ai/DeepSeek-V4-Pro',
      'Qwen/Qwen3-Max',
      'THUDM/glm-4-9b-chat',
    ],
    models: [
      'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-ai/DeepSeek-V4-Pro',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-Max',
      'Qwen/Qwen2.5-72B-Instruct',
      'THUDM/glm-4-9b-chat',
      'THUDM/glm-4-flash',
    ],
    requiresKey: true,
    accent: '#7C3AED',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    modelsUrl: 'https://siliconflow.cn/models',
    note: '一个 Key 调用多家开源模型；跨域已放行；V4-Flash / V4-Pro 已上架可直调用。',
    lastUpdated: '2026-09',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    vendor: '本机推理（离线可用）',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen3:8b',
    featuredModels: ['qwen3:8b', 'deepseek-v4-flash:8b', 'llama3.2:8b'],
    models: [
      'qwen3:8b',
      'qwen3:14b',
      'llama3.2:8b',
      'llama3.1:8b',
      'deepseek-v4-flash:8b',
      'deepseek-r1:8b',
      'gemma3:9b',
    ],
    requiresKey: false,
    accent: '#6B7280',
    consoleUrl: 'https://ollama.com/download',
    modelsUrl: 'https://ollama.com/library',
    note: '需本机运行 ollama serve 并设置 OLLAMA_ORIGINS=* 才能被网页调用；数据不出本机；下方模型 ID 必须先 `ollama pull <name>`。',
    lastUpdated: '2026-09',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    vendor: '自建网关 / 企业内网模型',
    baseUrl: '',
    defaultModel: '',
    featuredModels: [],
    models: [],
    requiresKey: true,
    accent: '#0078D4',
    note: '填写任何兼容 /chat/completions 协议的地址，如 One-API、vLLM、SGLang、公司网关；模型名称照抄目标网关的取值即可。',
  },
];

/**
 * 单次输出上限（token）。取 8192 是为了兼容绝大多数对话模型的输出上限
 * （部分模型只有 4096），同时与 UI 输入框的上限保持一致。
 * 若你的模型支持更长输出，可调大此值。
 */
export const MAX_OUTPUT_TOKENS = 8192;

/**
 * 平台默认输出上限（token）。
 *
 * 取值与 `MAX_OUTPUT_TOKENS` 一致（2026-09-18 从 1200 上调）：
 * 思考型模型（deepseek-reasoner / v4 混合思考系列）会先消耗输出额度做推理，
 * 默认值太小会导致「推理没写完、正文为空」。默认给满，把上限交给用户按需下调。
 */
export const DEFAULT_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS;

/** 平台默认模型配置（等价于「未配置」），用 DeepSeek V4-Flash 开箱即跑得通。 */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/chat/completions',
  apiKey: '',
  model: 'deepseek-v4-flash',
  temperature: 0.2,
  maxTokens: DEFAULT_OUTPUT_TOKENS,
  proxyBaseUrl: '',
};

// ── 数值参数的合法化 ────────────────────────────────────────────────────────
// 各厂商对 max_tokens / temperature 的取值有硬性校验，一旦越界会直接返回
// 400（例如 DeepSeek：`Invalid max_tokens value, the valid range of max_tokens
// is [1, 393216]`）。而 `max_tokens` 的值来自浏览器 localStorage，历史上
// 可能被写成 0 / null / 字符串 / 超大数字（例如旧版本、手工改库），
// 因此**每次读取与每次发请求前都必须归一化**，否则会出现
// 「测试连接成功、真正提问却失败」这种极难排查的问题。

/** 单次输出下限（token）。 */
export const MIN_OUTPUT_TOKENS = 1;

/**
 * 历史默认值（随平台版本变化）。
 *
 * 为什么要留一份：用户从未手动改过输入框时，存量 localStorage 里会一直留着
 * 旧版本的默认值。若直接换新默认值，这些「没动过」的配置会永远停在旧值上。
 * `sanitizeLlmConfig` 会把这些值平滑升级到新默认值，用户自定义过的值不受影响。
 */
const LEGACY_OUTPUT_TOKEN_DEFAULTS: readonly number[] = [1200];

/** 判断是否属于「缺失值」。注意 `Number(null)` / `Number('')` 都等于 0，
 *  直接参与运算会把「没填」误当成「填了 0」，因此必须先单独排除。 */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** 把任意输入归一化成合法温度：缺失或非有限数回落 0.2，并夹到 [0, 2]。 */
export function normalizeTemperature(value: unknown, fallback = 0.2): number {
  if (isBlank(value)) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 2);
}

/**
 * 把任意输入归一化成合法输出上限：
 *  - 缺失或非有限数（undefined / null / NaN / Infinity / 'abc'）→ 兜底值；
 *  - 小于下限（0 / 负数）→ 兜底值；
 *  - 合法但超过上限 → 夹到上限（不是丢弃，避免用到模型默认的极大值）。
 * 返回的一定是 `[MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS]` 内的整数。
 */
export function normalizeMaxTokens(value: unknown, fallback = DEFAULT_OUTPUT_TOKENS): number {
  if (isBlank(value)) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const int = Math.trunc(parsed);
  if (int < MIN_OUTPUT_TOKENS) return fallback;
  return Math.min(int, MAX_OUTPUT_TOKENS);
}

/**
 * 存量配置里的「旧默认值」平滑升级到当前默认值。
 * 只认历史默认值，用户自己填的数字原样保留（例如手动改成 2048 的不会被顶掉）。
 */
function upgradeLegacyOutputTokens(value: unknown): unknown {
  if (isBlank(value)) return value;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return value;
  return LEGACY_OUTPUT_TOKEN_DEFAULTS.includes(Math.trunc(parsed)) ? DEFAULT_OUTPUT_TOKENS : value;
}

/**
 * 清洗从 localStorage 读回、或用户编辑中的配置：
 * 保证每个字段类型正确、数值在合法区间内。脏数据在这里被就地修复，
 * 因此上层（UI 与请求构造）可以认为 `LlmConfig` 始终是可信的。
 */
export function sanitizeLlmConfig(config: Partial<LlmConfig> | null | undefined): LlmConfig {
  const merged = { ...DEFAULT_LLM_CONFIG, ...(config ?? {}) };
  return {
    providerId:
      typeof merged.providerId === 'string' && merged.providerId.trim()
        ? merged.providerId.trim()
        : DEFAULT_LLM_CONFIG.providerId,
    baseUrl: typeof merged.baseUrl === 'string' ? merged.baseUrl : '',
    apiKey: typeof merged.apiKey === 'string' ? merged.apiKey : '',
    model: typeof merged.model === 'string' ? merged.model : '',
    temperature: normalizeTemperature(merged.temperature),
    maxTokens: normalizeMaxTokens(upgradeLegacyOutputTokens(merged.maxTokens)),
    proxyBaseUrl: typeof merged.proxyBaseUrl === 'string' ? merged.proxyBaseUrl : '',
  };
}

/**
 * 该预设的全部模型清单 = 推荐 + datalist 全部，去重保留顺序。
 * `custom` 等无模型列表的预设会退化为 featuredModels。
 */
export function allPresetModels(preset: LlmProviderPreset): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [...preset.featuredModels, ...preset.models]) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

export function findProvider(id: string): LlmProviderPreset | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

/** 是否已具备调用条件：有接口地址 + 有模型名 +（需要 Key 时）有 Key。 */
export function isLlmConfigured(config: LlmConfig | null | undefined): boolean {
  if (!config) return false;
  if (!config.baseUrl?.trim() || !config.model?.trim()) return false;
  const provider = findProvider(config.providerId);
  const requiresKey = provider ? provider.requiresKey : true;
  if (requiresKey && !config.apiKey?.trim()) return false;
  return true;
}

/** 掩码展示 API Key，避免在界面上明文暴露。 */
export function maskApiKey(apiKey: string): string {
  const key = apiKey?.trim() ?? '';
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
}

/** 当前配置的人类可读标识，如「DeepSeek · deepseek-v4-flash」。 */
export function describeLlm(config: LlmConfig | null | undefined): string {
  if (!config) return '未配置模型';
  const provider = findProvider(config.providerId);
  const label = provider?.label ?? '自定义';
  const model = config.model?.trim();
  return model ? `${label} · ${model}` : `${label} · 未选择模型`;
}

/**
 * 归一化接口地址：
 *  - 已含 /chat/completions → 原样返回
 *  - 以 /v1 或 /v4 等版本号结尾 → 追加 /chat/completions
 *  - 其它 → 追加 /v1/chat/completions
 */
export function resolveChatEndpoint(baseUrl: string): string {
  const url = (baseUrl ?? '').trim().replace(/\s/g, '');
  if (!url) return '';
  const trimmed = url.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v\d+[a-z]*$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/** 叠加可选代理前缀，得到最终请求地址。 */
export function withProxy(endpoint: string, proxyBaseUrl?: string): string {
  const proxy = (proxyBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!proxy || !endpoint) return endpoint;
  return `${proxy}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}
