/**
 * 数据集抓取工具 —— 被「实例浏览」与「智能检索问答」共用
 * ---------------------------------------------------------------------------
 * 统一负责：SPARQL / GraphQL 请求地址拼装、JSON 解析（兼容 SPARQL JSON、
 * GraphQL data 包装、数组、items/rows 包装）、以及带超时的 fetch。
 */
import type { Ontology } from '../data/ontology';
import type { DataEndpoint } from '../store/appStore';

/** 从任意 JSON 载荷中提取对象行数组。 */
export function pickRows(payload: unknown, max = 50): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null).slice(0, max);
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.results)) return pickRows(obj.results, max);
    if (obj.results && typeof obj.results === 'object') {
      const r = obj.results as Record<string, unknown>;
      if (Array.isArray(r.bindings)) return pickRows(r.bindings, max);
    }
    // `{ data: [...] }` 与 `{ data: { 某字段: [...] } }` 两种包装都要吃下：
    // 前者是常见 REST 响应，后者是 GraphQL。
    if (Array.isArray(obj.data)) return pickRows(obj.data, max);
    if (obj.data && typeof obj.data === 'object') {
      for (const v of Object.values(obj.data)) {
        if (Array.isArray(v)) return pickRows(v, max);
      }
    }
    if (Array.isArray(obj.items)) return pickRows(obj.items, max);
    if (Array.isArray(obj.rows)) return pickRows(obj.rows, max);
    return [obj];
  }
  return [];
}

/** 把单元格值渲染为字符串（兼容 SPARQL binding 包装）。 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('value' in (value as Record<string, unknown>)) {
      return formatCell((value as Record<string, unknown>).value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** 端点未声明查询时使用的兜底 SPARQL。 */
export function buildSparqlSelect(ontology: Ontology): string {
  const entity = ontology.entityTypes[0];
  if (!entity) return '';
  const props = entity.properties.slice(0, 6).map((p) => `?${entity.id} <…> "${p.name}"@en .`).join(' ');
  return `PREFIX ex: <http://example.org/ontology/>
SELECT * WHERE {
  ?${entity.id} a ex:${entity.name} .
  ${props}
} LIMIT 30`;
}

/** 拼装最终的请求地址（SPARQL 注入 query，GraphQL 走 ?query=）。 */
export function buildFetchUrl(endpoint: DataEndpoint, ontology: Ontology): string {
  let url = endpoint.url;
  if (endpoint.kind === 'sparql' && !url.includes('?')) {
    const sparqlQuery = endpoint.query || buildSparqlSelect(ontology);
    if (sparqlQuery) url = `${url}?query=${encodeURIComponent(sparqlQuery)}&format=json`;
  }
  if (endpoint.kind === 'graphql' && endpoint.query && !url.includes('?')) {
    url = `${url}?query=${encodeURIComponent(endpoint.query)}`;
  }
  return url;
}

/** 是否为「本地 JSON 文件」接入的数据源（数据在内存里，不需要联网）。 */
export function isLocalEndpoint(endpoint: DataEndpoint): boolean {
  // needsFileReupload = 从本体库恢复但行数据未随库存放，同属本地文件类数据源，
  // 只是暂时没有数据；展示上应显示文件名而不是 local:// 伪地址。
  return Array.isArray(endpoint.localRows) || endpoint.needsFileReupload === true;
}

/** 本地数据源在界面上的展示标识（可以安全替代 URL 显示）。 */
export function localSourceLabel(endpoint: DataEndpoint): string {
  return `本地文件：${endpoint.localFileName ?? endpoint.name}`;
}

export interface FetchRowsResult {
  rows: Record<string, unknown>[];
  url: string;
  error?: string;
  elapsedMs: number;
}

/**
 * 请求一个数据源并返回其数据行。
 * 失败时返回 error 字段而不是抛出异常，便于 UI 逐条展示状态。
 *
 * 本地 JSON 文件接入的数据源（`localRows` 有值）不走网络，
 * 直接返回内存里的行，因此离线可用且不受 CORS 影响。
 */
export async function fetchEndpointRows(
  endpoint: DataEndpoint,
  ontology: Ontology,
  options: { timeoutMs?: number; maxRows?: number; signal?: AbortSignal } = {},
): Promise<FetchRowsResult> {
  const { timeoutMs = 12000, maxRows = 50 } = options;

  if (endpoint.localRows) {
    return {
      rows: endpoint.localRows.slice(0, maxRows),
      url: localSourceLabel(endpoint),
      elapsedMs: 0,
    };
  }

  // 从本体库恢复的本地文件数据源：行数据未随库存放，也没有可请求的地址，
  // 直接给出可执行的中文提示，而不是拿 local:// 去发一次注定失败的请求。
  if (endpoint.needsFileReupload || endpoint.url.startsWith('local://')) {
    return {
      rows: [],
      url: localSourceLabel(endpoint),
      elapsedMs: 0,
      error: '这条数据源来自本体库，行数据不随库存放；请在「接入数据源」里重新上传该 JSON 文件。',
    };
  }

  const url = buildFetchUrl(endpoint, ontology);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json, application/sparql-results+json, */*',
        ...(endpoint.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json') || url.includes('format=json')) {
      return { rows: pickRows(await res.json(), maxRows), url, elapsedMs: Date.now() - started };
    }
    const text = await res.text();
    try {
      return { rows: pickRows(JSON.parse(text), maxRows), url, elapsedMs: Date.now() - started };
    } catch {
      return { rows: [], url, elapsedMs: Date.now() - started };
    }
  } catch (err) {
    const message =
      controller.signal.aborted && !options.signal?.aborted
        ? `请求超时（${Math.round(timeoutMs / 1000)}s）`
        : err instanceof Error
          ? err.message
          : String(err);
    return { rows: [], url, error: message, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
