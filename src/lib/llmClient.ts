/**
 * 大模型客户端 —— 基于本体知识图谱 + 真实数据集做「有依据的检索问答」
 * ---------------------------------------------------------------------------
 * 设计要点：
 *  1. 上下文先行：把当前本体的实体 / 属性 / 关系 / 基数，以及已接入数据源的
 *     真实数据行（含「源列 → 本体属性」映射）序列化成结构化文本注入提示词，
 *     要求模型只依据这些内容作答，并在数据不足时明确说明。
 *  2. 协议统一：全部走 OpenAI 兼容的 /chat/completions（含 SSE 流式），
 *     因此同一套代码可切换 GPT / DeepSeek / GLM / Qwen / Kimi / 硅基流动 / Ollama。
 *  3. 零依赖：仅使用浏览器原生 fetch + ReadableStream，不引入任何 SDK。
 */
import type { Ontology, Property } from '../data/ontology';
import type { LlmConfig } from '../data/llmProviders';
import {
  MAX_OUTPUT_TOKENS,
  normalizeMaxTokens,
  normalizeTemperature,
  resolveChatEndpoint,
  withProxy,
} from '../data/llmProviders';
import { selectRelevantRows } from '../data/queryEngine';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 传入模型的一份「可检索数据」：来自已接入的数据源。 */
export interface GroundingDataset {
  /** 数据源名称，如「Fourth Coffee · 客户」。 */
  name: string;
  /** 数据源类型（rest / sparql / graphql / json-file）。 */
  kind?: string;
  /** 映射到的本体实体类型 id / 名称。 */
  entityTypeId?: string;
  entityName?: string;
  /** 源列名 → 本体属性名。 */
  columnMappings?: Record<string, string>;
  /** 该数据源总行数（可能大于实际注入的行数）。 */
  rowCount: number;
  /** 实际注入模型的数据行。 */
  rows: Record<string, unknown>[];
  /** 数据来源描述（如「数据湖仓 bronze 层」）。 */
  source?: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmResult {
  content: string;
  model?: string;
  usage?: LlmUsage;
  /** 耗时（毫秒）。 */
  elapsedMs: number;
}

export interface LlmRequestParams {
  config: LlmConfig;
  messages: LlmMessage[];
  /** 覆盖配置中的温度。 */
  temperature?: number;
  /** 覆盖配置中的最大输出。 */
  maxTokens?: number;
  /** 超时（毫秒），默认 60s；流式请求建议更长。 */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * 内部使用：本次请求是否省略「输出上限」参数。
   * 当厂商因输出上限取值不合法返回 400 时，会带上此标记自动重试一次，
   * 让厂商使用它自己的默认值（见 `sendChatRequest`）。
   */
  omitOutputLimit?: boolean;
  /**
   * 内部使用：本次请求是否已经「放大输出额度」重试过。
   * 思考型模型可能把输出额度全部花在推理上导致正文为空（finish_reason=length），
   * 此时自动放大一次额度重试；此标记防止无限递归（见 `chatCompletion` / `streamChatCompletion`）。
   */
  expandedOutputLimit?: boolean;
}

export type LlmErrorCode =
  | 'not-configured'
  | 'network'
  | 'cors'
  | 'auth'
  | 'not-found'
  | 'rate-limit'
  | 'server'
  | 'bad-request'
  | 'timeout'
  | 'empty'
  | /** 思考型模型把输出额度全部花在推理上，正文为空（finish_reason=length）。 */
    'empty-length'
  | 'aborted'
  | 'unknown';

export class LlmError extends Error {
  code: LlmErrorCode;
  status?: number;

  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

/** 给用户看的中文排查建议。 */
export function llmErrorHint(code: LlmErrorCode): string {
  switch (code) {
    case 'not-configured':
      return '尚未配置大模型，请点击右上角「模型连接」图标填写 API Key 与模型名称。';
    case 'auth':
      return '鉴权失败（401/403）：请检查 API Key 是否正确、是否已过期或额度用尽。';
    case 'not-found':
      return '接口或模型不存在（404）：请核对接口地址与模型名称是否与厂商文档一致。';
    case 'rate-limit':
      return '触发限流（429）：请稍后重试，或降低请求频率 / 更换模型。';
    case 'server':
      return '厂商服务异常（5xx）：请稍后重试。';
    case 'bad-request':
      return '请求参数被厂商拒绝（400/422）：请核对「模型名称」是否与厂商文档一致，或把「最大输出 Token」调小后重试（不同模型的可输出上限不同）。';
    case 'cors':
      return '请求被浏览器跨域策略拦截：可在「模型设置」中填写自建代理前缀（如 http://localhost:8787）。';
    case 'network':
      return '网络不可达：请检查网络连接、本机是否已启动本地模型服务。';
    case 'timeout':
      return '请求超时：可换用更快的模型，或减少注入的数据行数。';
    case 'empty':
      return '模型返回了空内容：请重试，或更换模型。';
    case 'empty-length':
      return '模型把输出额度全部用于思考（推理），正文为空：请在「模型连接」中把「最大输出 Token」调大（建议 4096–8192）后重试。';
    case 'aborted':
      return '请求已取消。';
    default:
      return '调用失败，请稍后重试。';
  }
}

// ── 上下文构建 ──────────────────────────────────────────────────────────────

function formatProperty(prop: Property): string {
  const parts: string[] = [prop.type];
  if (prop.isIdentifier) parts.push('主键');
  if (prop.unit) parts.push(`单位 ${prop.unit}`);
  if (prop.values?.length) parts.push(`枚举值：${prop.values.join(' / ')}`);
  const meta = parts.join('，');
  return prop.description ? `${prop.name}（${meta}）—— ${prop.description}` : `${prop.name}（${meta}）`;
}

/** 把本体序列化成模型可读的结构化文本。 */
export function buildOntologyContext(ontology: Ontology): string {
  const lines: string[] = [];
  lines.push(`# 本体（知识图谱）`);
  lines.push(`名称：${ontology.name}`);
  if (ontology.description) lines.push(`描述：${ontology.description}`);
  lines.push(`规模：${ontology.entityTypes.length} 个实体类型、${ontology.relationships.length} 条关系`);
  lines.push('');
  lines.push('## 实体类型');
  for (const entity of ontology.entityTypes) {
    lines.push(`### ${entity.id}｜${entity.name}`);
    if (entity.description) lines.push(`说明：${entity.description}`);
    lines.push(
      `属性（${entity.properties.length}）：${entity.properties.map(formatProperty).join('；') || '无'}`,
    );
    lines.push('');
  }
  lines.push('## 关系');
  if (ontology.relationships.length === 0) {
    lines.push('（无）');
  } else {
    for (const rel of ontology.relationships) {
      const from = ontology.entityTypes.find((e) => e.id === rel.from);
      const to = ontology.entityTypes.find((e) => e.id === rel.to);
      const desc = rel.description ? ` —— ${rel.description}` : '';
      lines.push(
        `- ${rel.name}：${from?.name ?? rel.from} → ${to?.name ?? rel.to}（${rel.cardinality}）${desc}`,
      );
    }
  }
  return lines.join('\n');
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if ('value' in rec) return formatCellValue(rec.value); // SPARQL binding
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 单个数据集注入上下文的默认行数上限。
 *
 * 设计取向（2026-09 调整）：**召回无下限、上限给足**。
 *  - 无下限：`selectRelevantRows` 没命中任何行就返回 0 行，不做「补足 N 行」兜底；
 *  - 上限大：这里给一个足够宽松的兜底值，让「命中多少就注入多少」，
 *    上限只用于防止单张超长表把上下文撑爆。
 * 实际可注入行数还会受 `FETCH_ROWS`（抓取候选行数）限制。
 */
export const DEFAULT_ROWS_PER_DATASET = 120;

/**
 * 把一份数据集渲染成 markdown 表格，并标注列映射关系。
 *
 * 行选取策略：
 *  - 提供 `question` 时按 `selectRelevantRows` 做相关性筛选与排序
 *    （列名 / 单元格值与问题 token 的重合度打分），**有命中才注入**，至多 topN 行。
 *  - 不提供 `question` 时退化为「原始顺序前 topN 行」。
 *
 * topN 默认 `DEFAULT_ROWS_PER_DATASET`（宽松上限，实际由相关性决定）。
 */
export function buildDatasetContext(
  datasets: GroundingDataset[],
  rowsPerDataset = DEFAULT_ROWS_PER_DATASET,
  question: string = '',
): string {
  if (datasets.length === 0) {
    return '# 真实数据集\n（当前未接入任何数据源，请仅依据本体结构作答，并明确指出缺少实例数据。）';
  }
  const lines: string[] = ['# 真实数据集（已接入的数据源，取自真实表 / 接口）'];
  for (const ds of datasets) {
    const rawRows = Array.isArray(ds.rows) ? ds.rows : [];
    const rows = question
      ? selectRelevantRows(rawRows, question, ds.columnMappings, rowsPerDataset)
      : rawRows.slice(0, rowsPerDataset);
    const entity = ds.entityName ? `，映射实体：${ds.entityName}` : '';
    lines.push('');
    lines.push(`## ${ds.name}${entity}`);
    const meta: string[] = [];
    if (ds.source) meta.push(`来源：${ds.source}`);
    if (ds.kind) meta.push(`类型：${ds.kind}`);
    if (question) {
      meta.push(`总行数：${ds.rowCount}；按问题相关性召回 ${rows.length} 行（未命中的行不注入）`);
    } else {
      meta.push(`总行数：${ds.rowCount}（下表展示 ${rows.length} 行，原始顺序）`);
    }
    lines.push(meta.join('；'));

    const mappings = ds.columnMappings ?? {};
    const mappingEntries = Object.entries(mappings);
    if (mappingEntries.length > 0) {
      lines.push(`列映射（源列 → 本体属性）：${mappingEntries.map(([k, v]) => `${k} → ${v}`).join('；')}`);
    }

    if (rows.length === 0) {
      lines.push(
        question
          ? '（该数据源中没有与问题相关的行，已按相关性过滤，本次不注入任何行）'
          : '（无数据行）',
      );
      continue;
    }
    const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 10);
    lines.push('');
    lines.push(`| ${columns.join(' | ')} |`);
    lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of rows) {
      const cells = columns.map((c) => {
        const v = formatCellValue(row[c]).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        return v.length > 60 ? `${v.slice(0, 60)}…` : v;
      });
      lines.push(`| ${cells.join(' | ')} |`);
    }
  }
  return lines.join('\n');
}

/**
 * 默认系统提示词。
 *
 * 用户可以在「智能检索问答」面板的「提示词」按钮里自定义——
 * 自定义内容会**整体替换**这段默认提示词（编辑框里预填的就是它，方便在其基础上改），
 * 而「本体 + 真实数据集」的接地上下文仍然照常注入用户消息，不受影响。
 */
export const DEFAULT_SYSTEM_PROMPT = `你是「本体平台」的智能检索助手。用户会针对当前载入的本体（知识图谱）与已接入的真实数据集提问。

【作答要求】
1. 只能依据下方提供的「本体」与「真实数据集」作答，严禁编造实体、属性、关系或数据行。
2. 回答中引用实体、属性、关系时，请使用本体中定义的中英文名称，便于用户在图谱中定位。
3. 当数据不足以回答时，明确说明缺少什么（例如"当前接入的数据源不含 xx 字段"），并给出可行的下一步建议。
   注意：数据集标注「本次不注入任何行」表示**该表没有与问题相关的行**（系统按问题相关性做了过滤），
   不代表这张表本身是空的；请表述为"该数据源中没有与问题相关的记录"，不要断言"表为空 / 无数据"。
4. 涉及统计、对比、排序时，请先列出所依据的数据行（可摘要），再给结论；只做数据表内可验证的计算。
5. 使用简体中文，结构清晰：先给结论，再给依据。可用短标题、要点列表、加粗与行内代码，避免冗长铺垫。
6. 若问题与本体和数据都无关，直接说明无法基于当前知识作答，并推荐可提问的方向。
7. 对话可能是多轮的：结合之前的问答历史理解当前问题（如指代、追问），但回答仍须以本轮注入的本体与数据为准。`;

/** 组装最终发给模型的消息。 */
export function buildChatMessages(params: {
  question: string;
  ontology: Ontology;
  datasets: GroundingDataset[];
  /** 本地检索引擎命中的本体元素摘要（作为额外提示）。 */
  localHits?: string[];
  /** 每源注入行数上限（会按问题相关性筛选，未命中则不注入）。默认 DEFAULT_ROWS_PER_DATASET。 */
  rowsPerDataset?: number;
  /** 自定义系统提示词；为空时使用 DEFAULT_SYSTEM_PROMPT。 */
  systemPrompt?: string;
  /** 多轮对话历史（不含本轮），按时间升序；只接受 user / assistant 且内容非空的消息。 */
  history?: LlmMessage[];
}): LlmMessage[] {
  const { question, ontology, datasets, localHits, rowsPerDataset = DEFAULT_ROWS_PER_DATASET } = params;
  const contextParts = [
    buildOntologyContext(ontology),
    '',
    buildDatasetContext(datasets, rowsPerDataset, question),
  ];
  if (localHits && localHits.length > 0) {
    contextParts.push('');
    contextParts.push('# 本地图谱检索引擎的命中（供参考，可按需修正）');
    contextParts.push(localHits.map((h) => `- ${h}`).join('\n'));
  }

  const system = params.systemPrompt?.trim();
  const history = (params.history ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0,
  );

  return [
    { role: 'system', content: system ? system : DEFAULT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `${contextParts.join('\n')}\n\n# 用户问题\n${question}` },
  ];
}

// ── 响应解析 ────────────────────────────────────────────────────────────────

/** 兼容 OpenAI 形状：choices[0].message.content（字符串或分段数组）。 */
export function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as Record<string, unknown>;
  const message = (first.message ?? first.delta) as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in (part as Record<string, unknown>)) {
          return String((part as Record<string, unknown>).text ?? '');
        }
        return '';
      })
      .join('');
  }
  const text = first.text;
  return typeof text === 'string' ? text : '';
}

/** 兼容 OpenAI 形状的错误体。 */
export function extractApiError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const err = obj.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const message = e.message ?? e.msg ?? e.code;
    if (typeof message === 'string') return message;
  }
  if (typeof obj.message === 'string') return obj.message;
  return null;
}

export function extractUsage(payload: unknown): LlmUsage | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const pick = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : undefined);
  const result: LlmUsage = {
    promptTokens: pick('prompt_tokens') ?? pick('input_tokens'),
    completionTokens: pick('completion_tokens') ?? pick('output_tokens'),
    totalTokens: pick('total_tokens'),
  };
  if (result.promptTokens === undefined && result.completionTokens === undefined && result.totalTokens === undefined) {
    return undefined;
  }
  return result;
}

export function extractModel(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const model = (payload as Record<string, unknown>).model;
  return typeof model === 'string' ? model : undefined;
}

/** choices[0].finish_reason（length / stop / tool_calls …）。 */
export function extractFinishReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const reason = (choices[0] as Record<string, unknown>).finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * 思考型模型（deepseek-reasoner / v4 混合思考系列等）会把推理过程放在
 * `reasoning_content` 字段，正文仍在 `content`。兼容 message 与 delta 两种形状。
 */
export function extractReasoningContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as Record<string, unknown>;
  const message = (first.message ?? first.delta) as Record<string, unknown> | undefined;
  const reasoning = message?.reasoning_content;
  return typeof reasoning === 'string' ? reasoning : '';
}

/** 把 HTTP 状态与异常归类为可展示的错误码。 */
export function classifyError(status: number, message: string): LlmError {
  if (status === 401 || status === 403) return new LlmError('auth', message, status);
  if (status === 404) return new LlmError('not-found', message, status);
  if (status === 429) return new LlmError('rate-limit', message, status);
  if (status >= 500) return new LlmError('server', message, status);
  if (status === 400 || status === 422) return new LlmError('bad-request', message, status);
  return new LlmError('unknown', message, status);
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new LlmError('aborted', '请求已取消');
  }
  if (err instanceof TypeError) {
    // 浏览器对 CORS 失败与网络不可达都抛 TypeError: Failed to fetch，
    // 这里统一提示为跨域/网络，并在 UI 中给出代理方案。
    return new LlmError('cors', '网络请求失败（可能被跨域策略拦截或目标不可达）');
  }
  return new LlmError('unknown', err instanceof Error ? err.message : String(err));
}

/** 组装请求地址（含可选代理前缀）。 */
export function buildRequestUrl(config: LlmConfig): string {
  return withProxy(resolveChatEndpoint(config.baseUrl), config.proxyBaseUrl);
}

function buildHeaders(config: LlmConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = config.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * OpenAI 的推理类模型（gpt-5 系列、o1/o3/o4 系列）在 Chat Completions 上
 * 要求用 `max_completion_tokens`，传 `max_tokens` 会被拒绝。
 * 这里做定向识别，其它厂商（deepseek / glm / qwen / kimi …）统一沿用 `max_tokens`。
 */
export function isReasoningModel(model: string): boolean {
  const m = (model ?? '').trim();
  // gpt-5 系列，以及 o1 / o3 / o4 等推理系列（后跟分隔符或直接结束）
  return /^gpt-5/i.test(m) || /^o[1-9](\b|[-.])/i.test(m);
}

/**
 * 判断错误信息是否属于「输出上限参数不合法」。
 * 各厂商措辞不同，这里覆盖常见几种：
 *  - DeepSeek：`Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`
 *  - OpenAI ：`Unsupported parameter: 'max_tokens' ...`
 *  - 阿里百炼：`Range of max_tokens should be [1, xxx]`
 */
export function isOutputLimitError(message: string): boolean {
  const m = (message ?? '').toLowerCase();
  if (!m) return false;
  const mentionsParam =
    m.includes('max_tokens') ||
    m.includes('max_completion_tokens') ||
    m.includes('max output') ||
    m.includes('maximum output') ||
    m.includes('输出长度') ||
    m.includes('maxoutputtokens');
  if (!mentionsParam) return false;
  return (
    m.includes('invalid') ||
    m.includes('range') ||
    m.includes('unsupported') ||
    m.includes('not supported') ||
    m.includes('must be') ||
    m.includes('should be') ||
    m.includes('exceed')
  );
}

/** 构造请求体。`omitOutputLimit` 为真时不带输出上限参数，由厂商使用默认值。 */
export function buildBody(
  config: LlmConfig,
  params: LlmRequestParams,
  stream: boolean,
  omitOutputLimit = false,
): string {
  const body: Record<string, unknown> = {
    model: config.model.trim(),
    messages: params.messages,
    temperature: normalizeTemperature(params.temperature ?? config.temperature),
    stream,
  };

  if (!omitOutputLimit) {
    // 兜底归一化：即使 localStorage 里存着 0 / NaN / 超大值，也不会把
    // 非法值直接发给厂商（这是「测试连接通过、提问却报 400」的根因）。
    const maxTokens = normalizeMaxTokens(params.maxTokens ?? config.maxTokens);
    const key = isReasoningModel(config.model) ? 'max_completion_tokens' : 'max_tokens';
    body[key] = maxTokens;
  }

  return JSON.stringify(body);
}

/**
 * 发起一次 chat/completions 请求；若厂商因「输出上限参数」拒绝（400/422），
 * 自动省略该参数重试一次。这样即便用户配置了一个当前模型不支持的上限，
 * 也能正常拿到回答，而不是直接失败。
 */
async function sendChatRequest(
  url: string,
  config: LlmConfig,
  params: LlmRequestParams,
  stream: boolean,
  signal: AbortSignal,
): Promise<Response> {
  const headers = stream
    ? { ...buildHeaders(config), Accept: 'text/event-stream' }
    : buildHeaders(config);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: buildBody(config, params, stream, params.omitOutputLimit === true),
    signal,
  });

  if (res.ok || params.omitOutputLimit) return res;

  // 仅针对参数类错误重试，鉴权/限流/服务端错误不重试
  if (res.status !== 400 && res.status !== 422) return res;

  const text = await res.text();
  const payload = safeJsonParse(text);
  const message = extractApiError(payload) ?? `${res.status} ${res.statusText}`;
  if (!isOutputLimitError(message)) {
    // 不是输出上限的问题，把错误原样抛给上层（响应体已被消费，故直接抛错）
    throw classifyError(res.status, message);
  }

  return fetch(url, {
    method: 'POST',
    headers,
    body: buildBody(config, params, stream, true),
    signal,
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * 「输出额度放大重试」时使用的新上限：原值 × 4，夹到平台允许的最大值。
 * 典型场景：输出额度被思考型模型的推理过程全部吃掉，正文为空
 * （默认额度已给到上限 8192，此处主要覆盖用户手动调小后的情况）。
 */
function expandedMaxTokens(config: LlmConfig, params: LlmRequestParams): number {
  const base = normalizeMaxTokens(params.maxTokens ?? config.maxTokens);
  return Math.min(base * 4, MAX_OUTPUT_TOKENS);
}

// ── 调用 ────────────────────────────────────────────────────────────────────

/** 非流式对话补全（连接性测试与普通问答均可用）。 */
export async function chatCompletion(params: LlmRequestParams): Promise<LlmResult> {
  const { config } = params;
  const url = buildRequestUrl(config);
  if (!url || !config.model?.trim()) {
    throw new LlmError('not-configured', '接口地址或模型名称为空');
  }
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 60000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);

  try {
    const res = await sendChatRequest(url, config, params, false, controller.signal);
    const text = await res.text();
    const payload = safeJsonParse(text);
    if (!res.ok) {
      const msg = extractApiError(payload) ?? `${res.status} ${res.statusText}`;
      throw classifyError(res.status, msg);
    }
    const content = extractContent(payload).trim();
    if (!content) {
      // 思考型模型把输出额度全部花在推理上：finish_reason=length 且正文为空。
      // 自动放大一次输出额度重试；已重试过则给出可操作的错误分类。
      const finishReason = extractFinishReason(payload);
      if (finishReason === 'length' && params.expandedOutputLimit !== true) {
        return chatCompletion({
          ...params,
          maxTokens: expandedMaxTokens(config, params),
          expandedOutputLimit: true,
        });
      }
      throw new LlmError(
        finishReason === 'length' ? 'empty-length' : 'empty',
        finishReason === 'length' ? '模型返回空内容（输出额度已被思考过程用尽）' : '模型返回空内容',
      );
    }
    return {
      content,
      model: extractModel(payload),
      usage: extractUsage(payload),
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    if (controller.signal.aborted && !params.signal?.aborted) {
      throw new LlmError('timeout', `请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw toLlmError(err);
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 流式对话补全（SSE）。逐段回调 onDelta，返回完整结果。
 * 若响应体不可读（老浏览器 / 非流式返回），自动退化为一次性解析。
 */
export async function streamChatCompletion(
  params: LlmRequestParams & { onDelta?: (delta: string, full: string) => void },
): Promise<LlmResult> {
  const { config, onDelta } = params;
  const url = buildRequestUrl(config);
  if (!url || !config.model?.trim()) {
    throw new LlmError('not-configured', '接口地址或模型名称为空');
  }
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 120000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);

  let full = '';
  const emit = (delta: string) => {
    if (!delta) return;
    full += delta;
    onDelta?.(delta, full);
  };

  try {
    // 若厂商因输出上限参数拒绝请求，此处会先自动去掉该参数重试一次，
    // 因此真正进入下面的流式解析时响应一定是成功的。
    const res = await sendChatRequest(url, config, params, true, controller.signal);

    if (!res.ok) {
      const text = await res.text();
      const payload = safeJsonParse(text);
      const msg = extractApiError(payload) ?? `${res.status} ${res.statusText}`;
      throw classifyError(res.status, msg);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.body || contentType.includes('application/json')) {
      // 服务端忽略了 stream=true，按普通响应解析
      const text = await res.text();
      const payload = safeJsonParse(text);
      const content = extractContent(payload).trim();
      if (!content) {
        const finishReason = extractFinishReason(payload);
        if (finishReason === 'length' && params.expandedOutputLimit !== true) {
          return streamChatCompletion({
            ...params,
            maxTokens: expandedMaxTokens(config, params),
            expandedOutputLimit: true,
          });
        }
        throw new LlmError(
          finishReason === 'length' ? 'empty-length' : 'empty',
          finishReason === 'length' ? '模型返回空内容（输出额度已被思考过程用尽）' : '模型返回空内容',
        );
      }
      emit(content);
      return {
        content: full,
        model: extractModel(payload),
        usage: extractUsage(payload),
        elapsedMs: Date.now() - started,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let model: string | undefined;
    let usage: LlmUsage | undefined;
    let finishReason: string | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔；这里统一按行处理 data: 前缀
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        model = extractModel(payload) ?? model;
        usage = extractUsage(payload) ?? usage;
        finishReason = extractFinishReason(payload) ?? finishReason;
        const apiError = extractApiError(payload);
        if (apiError) {
          // 流中途才报错通常无法重试，但错误码要归类正确，便于给出可操作建议
          throw new LlmError(isOutputLimitError(apiError) ? 'bad-request' : 'server', apiError);
        }
        // 思考型模型会先推 reasoning_content 分片（extractContent 对其返回空串），
        // 这里只把正文 content 汇入回答，思考过程不进 UI。
        emit(extractContent(payload));
      }
    }

    if (!full.trim()) {
      // 思考型模型把输出额度全部花在推理上：流结束时正文仍为空且 finish_reason=length。
      // 自动放大一次输出额度重试；已重试过则给出可操作的错误分类。
      if (finishReason === 'length' && params.expandedOutputLimit !== true) {
        return streamChatCompletion({
          ...params,
          maxTokens: expandedMaxTokens(config, params),
          expandedOutputLimit: true,
        });
      }
      throw new LlmError(
        finishReason === 'length' ? 'empty-length' : 'empty',
        finishReason === 'length' ? '模型返回空内容（输出额度已被思考过程用尽）' : '模型返回空内容',
      );
    }
    return { content: full, model, usage, elapsedMs: Date.now() - started };
  } catch (err) {
    if (controller.signal.aborted && !params.signal?.aborted) {
      throw new LlmError('timeout', `请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw toLlmError(err);
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 连接性测试：发一句极短的问题，验证地址 / Key / 模型 / 参数是否可用。
 *
 * 注意：这里**刻意不再覆盖 maxTokens**，而是沿用用户真实配置里的参数
 * （由 `buildBody` 统一归一化）。否则会出现「测试连接成功、真正提问却失败」
 * 这种前后不一致的假阳性——测试必须能代表真实请求。
 */
export async function testConnection(config: LlmConfig): Promise<{ reply: string; elapsedMs: number; model?: string }> {
  const result = await chatCompletion({
    config,
    messages: [
      { role: 'system', content: '你是连通性测试助手，只回复要求的内容。' },
      { role: 'user', content: '请只回复两个字：连通' },
    ],
    temperature: 0,
    timeoutMs: 25000,
  });
  return { reply: result.content, elapsedMs: result.elapsedMs, model: result.model };
}
