/**
 * JSON 文件自动解析接入
 * ---------------------------------------------------------------------------
 * 用户上传一个 JSON 文件，本模块负责把它「读懂」成可以直接接入的数据源。
 * 支持两种文件形态：
 *
 *  A. **扁平行数组**（`flat`）
 *     文件文本 → 行数组 → 列名集合 → 猜测本体实体 → 自动生成列映射
 *
 *  B. **多实体分桶图**（`graph`）
 *     `{ metadata, objects: { 实体名: [实例…] }, relationships: [三元组…] }`
 *     这类文件（本体导出 / 图数据库 dump）顶层不是一张表，而是「一桶一张表」。
 *     过去它会被当成「单个对象」读成 1 行 3 列的垃圾数据，现在改成把每个桶
 *     展开成一个独立数据源，并把 relationships 作为一个关系数据源接进来。
 *
 * 设计原则：
 *  1. **纯函数、不碰 DOM**：所有解析逻辑都可单测，UI 只负责取文本、渲染结果。
 *  2. **宽容输入**：数组 / {items|rows|results|data} 包装 / 单个对象 / 分桶图 都能吃下
 *     （扁平行提取复用 `pickRows`，与在线数据源保持同一套解析口径）。
 *  3. **不静默**：认不出实体、行数被截断、桶被跳过，都要写进 warnings
 *     让用户在界面上看得见，而不是悄悄接了一个空壳数据源。
 */
import { pickRows } from './datasetFetcher';
import type { EntityType, Ontology } from '../data/ontology';

/** 单次导入保留的最大行数（超出会截断并给出提示）。 */
export const MAX_IMPORT_ROWS = 5000;
/** 允许上传的最大文件体积（字节）。超过直接拒绝，避免主线程长时间 JSON.parse。 */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
/** 参与实体识别 / 列映射的列数上限（宽表只取前若干列，避免噪音干扰打分）。 */
export const MAX_IMPORT_COLUMNS = 60;

export interface AutoImportResult {
  /** 判别字段：扁平行数组。 */
  kind: 'flat';
  /** 原始文件名。 */
  fileName: string;
  /** 解析出的数据行。 */
  rows: Record<string, unknown>[];
  /** 源文件的列名，按「出现频次降序 → 首次出现顺序」排列。 */
  columns: string[];
  /** 自动识别的实体类型 id；置信度不足时为 null（由用户手动选择）。 */
  entityTypeId: string | null;
  /** 源列 → 本体属性名的映射（只包含识别成功的列）。 */
  columnMappings: Record<string, string>;
  /** 需要提示用户的问题（截断、识别失败等）。 */
  warnings: string[];
  /** 被截断掉的行数（0 表示完整保留）。 */
  truncated: number;
}

/** 是否为普通对象（排除 null / 数组）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── 多实体分桶图（{ objects: { 实体名: [实例…] }, relationships: [...] }）──────

/**
 * 可能盛放「实体名 → 实例数组」的顶层键。
 * `data` 故意不在列表里：它在扁平行提取里已经代表「REST / GraphQL 包装」，
 * 抢过来会把 `{ data: { orders: [...] } }` 误判成分桶图。
 */
const BUCKET_CONTAINER_KEYS = ['objects', 'entities', 'instances', 'nodes'];

/** 可能盛放关系三元组的顶层键。 */
const RELATION_CONTAINER_KEYS = ['relationships', 'relations', 'edges', 'links'];

/** `metadata` 里被认为可展示的字符串最大长度。 */
const METADATA_VALUE_MAX = 160;

/** 分桶图里的一个实体桶。 */
export interface GraphBucket {
  /** 桶名（= `objects` 下的键，例如 `Requirement_Document`）。 */
  name: string;
  /** 该桶的数据行。 */
  rows: Record<string, unknown>[];
  /** 该桶的列名（按频次排序）。 */
  columns: string[];
  /** 该桶被截断掉的行数。 */
  truncated: number;
  /** 匹配到的本体实体 id；没匹配上为 null。 */
  entityTypeId: string | null;
  /** 匹配得分（用于排序与置信度展示）。 */
  entityScore: number;
  /** 实体是怎么来的：桶名命中 / 列名猜测 / 没匹配上。 */
  entitySource: 'bucket' | 'columns' | null;
  /** 桶内列映射（桶没匹配到实体时为空对象）。 */
  columnMappings: Record<string, string>;
}

/** 分桶图 JSON 的解析结果。 */
export interface GraphImportResult {
  /** 判别字段：多实体分桶图。 */
  kind: 'graph';
  /** 原始文件名。 */
  fileName: string;
  /** 分桶容器所在的顶层键（`objects` / `entities` …）。 */
  containerKey: string;
  /** 从 `metadata` 里挑出来的可读描述（只保留短字符串）。 */
  metadata: Record<string, string>;
  /** 所有实体桶（已过滤空桶）。 */
  buckets: GraphBucket[];
  /** 关系三元组的行数据（文件里没有关系时为空数组）。 */
  relationshipRows: Record<string, unknown>[];
  /** 关系表的列名。 */
  relationshipColumns: string[];
  /** 关系容器所在的顶层键；没有关系时为 null。 */
  relationshipKey: string | null;
  /** 全部桶的实例总数。 */
  totalRows: number;
  /** 需要提示用户的问题。 */
  warnings: string[];
}

/** 单次导入的解析结果（扁平行数组 / 多实体分桶图）。 */
export type ImportParseResult = AutoImportResult | GraphImportResult;

/**
 * 归一化列名 / 属性名，用于匹配。
 * `customer_id` / `customerId` / `Customer ID` / `customer-id` 都会收敛成 `customerid`。
 */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]{}]+/g, '');
}

/** 统计所有行出现过的列名，按频次降序（同频次保持首次出现顺序）。 */
export function collectColumns(
  rows: Record<string, unknown>[],
  limit = MAX_IMPORT_COLUMNS,
): string[] {
  // Map 保留插入顺序 = 首次出现顺序；Array.sort 是稳定排序，
  // 所以「同频次」的列会自然保持首次出现的先后。
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

/** 单个源列与单个本体属性的匹配分：完全同名 3 分，包含关系 1.5 分，否则 0。 */
function pairScore(column: string, property: string): number {
  const a = normalizeKey(column);
  const b = normalizeKey(property);
  if (!a || !b) return 0;
  if (a === b) return 3;
  // 太短的串不参与包含匹配，避免 `id` 命中一切
  if (b.length >= 3 && a.includes(b)) return 1.5;
  if (a.length >= 3 && b.includes(a)) return 1.5;
  return 0;
}

/** 某个源列对某个实体的最佳匹配（含命中的属性名）。 */
function bestPropertyFor(
  column: string,
  entity: EntityType,
): { property: string; score: number } | null {
  let best: { property: string; score: number } | null = null;
  for (const prop of entity.properties) {
    let score = pairScore(column, prop.name);
    if (score > 0 && prop.isIdentifier) {
      // 主键列额外加权：`order_id → orderId` 这类映射几乎是必中的
      const col = normalizeKey(column);
      const isIdColumn = col.endsWith('id') || col.endsWith('key') || col.endsWith('no');
      if (isIdColumn) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { property: prop.name, score };
  }
  return best;
}

/** 实体识别的最小门槛：至少命中 2 列、累计 4 分，否则宁可不猜。 */
const ENTITY_SCORE_MIN = 4;
const ENTITY_MATCHED_COLUMNS_MIN = 2;

export interface EntityGuess {
  entityTypeId: string;
  score: number;
  matchedColumns: number;
}

/** 按「列名 ∩ 属性名」的累计得分猜测实体类型。 */
export function guessEntityType(
  columns: string[],
  entityTypes: EntityType[],
): EntityGuess | null {
  let best: EntityGuess | null = null;

  for (const entity of entityTypes) {
    let score = 0;
    let matchedColumns = 0;
    for (const column of columns) {
      const hit = bestPropertyFor(column, entity);
      if (hit) {
        score += hit.score;
        matchedColumns += 1;
      }
    }
    if (score >= ENTITY_SCORE_MIN && matchedColumns >= ENTITY_MATCHED_COLUMNS_MIN) {
      if (!best || score > best.score) {
        best = { entityTypeId: entity.id, score, matchedColumns };
      }
    }
  }

  return best;
}

/**
 * 自动生成列映射：对所有 (源列, 属性) 组合按分数降序贪心分配，
 * 一个属性只被一个源列占用，避免两列抢同一个属性。
 */
export function autoMapColumns(
  columns: string[],
  entity: EntityType | undefined,
): Record<string, string> {
  if (!entity) return {};

  const candidates: { column: string; property: string; score: number; order: number }[] = [];
  columns.forEach((column, order) => {
    const hit = bestPropertyFor(column, entity);
    if (hit) candidates.push({ column, property: hit.property, score: hit.score, order });
  });

  candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order));

  const mappings: Record<string, string> = {};
  const usedProperties = new Set<string>();
  for (const c of candidates) {
    if (mappings[c.column] || usedProperties.has(c.property)) continue;
    mappings[c.column] = c.property;
    usedProperties.add(c.property);
  }
  return mappings;
}

/** 解析文件文本为 JSON，失败时抛出带中文可执行提示的 Error。 */
function parseJsonText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('文件是空的，没有可解析的内容。');
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `不是合法的 JSON：${err instanceof Error ? err.message : String(err)}。` +
        '如果是 CSV / Excel，请先另存为 JSON；如果是 JSON Lines，请改成标准数组格式。',
    );
  }
}

/**
 * 把「扁平行数组」形态的载荷解析成可接入的数据源配置。
 * 解析失败时抛出带中文可执行提示的 Error。
 */
function buildFlatResult(
  payload: unknown,
  fileName: string,
  ontology: Ontology,
): AutoImportResult {
  const all = pickRows(payload, Number.MAX_SAFE_INTEGER);
  if (all.length === 0) {
    throw new Error('文件里没有解析出任何数据行。请确认内容是最新 JSON 对象数组，而不是纯文本或空数组。');
  }

  const truncated = Math.max(0, all.length - MAX_IMPORT_ROWS);
  const rows = truncated > 0 ? all.slice(0, MAX_IMPORT_ROWS) : all;
  const columns = collectColumns(rows);
  if (columns.length === 0) {
    throw new Error('解析出的数据行里没有任何字段，请确认文件内容是对象数组（例如 [{ "id": 1, "name": "..." }]）。');
  }

  const guess = guessEntityType(columns, ontology.entityTypes);
  const entity = guess ? ontology.entityTypes.find((e) => e.id === guess.entityTypeId) : undefined;
  const columnMappings = autoMapColumns(columns, entity);

  // 只记录「文件级」的问题（截断等）；实体识别与映射覆盖率由 UI 实时计算，
  // 否则用户手动改了实体之后，这些文案就变成过期的了。
  const warnings: string[] = [];
  if (truncated > 0) {
    warnings.push(`文件共 ${all.length} 行，已截取前 ${MAX_IMPORT_ROWS} 行接入。`);
  }

  return {
    kind: 'flat',
    fileName,
    rows,
    columns,
    entityTypeId: guess?.entityTypeId ?? null,
    columnMappings,
    warnings,
    truncated,
  };
}

/**
 * 识别「多实体分桶」结构。
 *
 * 判定条件（宁可漏判也不要误判 —— 误判会把普通对象拆成一堆碎片数据源）：
 *  1. 顶层是普通对象；
 *  2. 存在 `objects` / `entities` / `instances` / `nodes` 之一，且它的值是对象；
 *  3. 该对象里至少有一个「数组」值，且数组里至少有一个对象元素。
 */
function bucketContainerOf(
  payload: unknown,
): { key: string; buckets: Record<string, unknown> } | null {
  if (!isPlainObject(payload)) return null;
  for (const key of BUCKET_CONTAINER_KEYS) {
    const value = payload[key];
    if (!isPlainObject(value)) continue;
    const entries = Object.entries(value).filter(([, v]) => Array.isArray(v));
    if (entries.length === 0) continue;
    const hasObjectRow = entries.some(([, v]) =>
      (v as unknown[]).some((row) => isPlainObject(row)),
    );
    if (hasObjectRow) return { key, buckets: value };
  }
  return null;
}

/** 从 metadata 里挑出可展示的短字符串（跳过嵌套对象与超长文本）。 */
function readMetadata(payload: unknown): Record<string, string> {
  if (!isPlainObject(payload)) return {};
  const raw = (payload as Record<string, unknown>).metadata;
  if (!isPlainObject(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim() && value.length <= METADATA_VALUE_MAX) {
      out[key] = value.trim();
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}

/** 桶名 → 实体名匹配的基准分：完全同名 / 包含关系。 */
const BUCKET_NAME_EXACT = 6;
const BUCKET_NAME_CONTAINS = 3;

/**
 * 用桶名匹配本体实体。
 * 桶名往往比实体名长（`Requirement_Document` vs `Requirement`），所以除了
 * 完全同名，还要认包含关系；命中多个候选时优先「更具体」（被匹配串更长）的那个，
 * 保证 `Sub_Requirement` 不会输给 `Requirement`。
 */
export function matchEntityByBucketName(
  bucketName: string,
  entityTypes: EntityType[],
): { entityTypeId: string; score: number } | null {
  const a = normalizeKey(bucketName);
  if (!a) return null;

  let best: { entityTypeId: string; score: number } | null = null;
  for (const entity of entityTypes) {
    const b = normalizeKey(entity.name);
    if (!b) continue;
    let score = 0;
    if (a === b) {
      score = BUCKET_NAME_EXACT;
    } else if (b.length >= 3 && a.includes(b)) {
      score = BUCKET_NAME_CONTAINS + Math.min(b.length, 40) / 100;
    } else if (a.length >= 3 && b.includes(a)) {
      score = BUCKET_NAME_CONTAINS + Math.min(a.length, 40) / 200;
    }
    if (score > 0 && (!best || score > best.score)) best = { entityTypeId: entity.id, score };
  }
  return best;
}

/** 通用容器词（归一化后）——它们不代表实体，允许退回列名猜测。 */
const GENERIC_BUCKET_NAMES = new Set([
  'rows',
  'data',
  'records',
  'items',
  'list',
  'listdata',
  'values',
  'results',
  'table',
  'sheet',
  'sheet1',
  'collection',
  'entries',
  'content',
]);

/**
 * 桶名是否「像一个实体名」。
 *
 * 像实体名却在当前本体里匹配不到，说明本体根本没有这个实体 —— 此时再用列名
 * 去猜另一个实体（`Test_Case` 里的 `status` 猜成 `order`）只会误导用户：
 * 他会看到一份「映射到 Order」的测试用例数据。所以这种情况下不再兜底猜测。
 */
function looksLikeEntityName(bucketName: string): boolean {
  const key = normalizeKey(bucketName);
  if (!key || GENERIC_BUCKET_NAMES.has(key)) return false;
  if (key.length < 5) return false;
  return /[A-Z]/.test(bucketName) || /[_\-. ]/.test(bucketName);
}

/**
 * 给所有桶分配本体实体。
 *
 * 两轮 + 贪心，保证一个实体只被一个桶占用：
 *  1. 先按「桶名匹配」打分，分数高的桶先挑；
 *  2. 剩下没匹配上的桶再用列名猜测（`guessEntityType`）兜底 —— 但桶名本身
 *     已经「像实体名」的桶不参与猜测，同样跳过已被占用的实体。
 */
export function assignBucketEntities(
  buckets: { name: string; columns: string[] }[],
  entityTypes: EntityType[],
): { entityTypeId: string | null; entityScore: number; entitySource: 'bucket' | 'columns' | null }[] {
  const assigned: { entityTypeId: string | null; entityScore: number; entitySource: 'bucket' | 'columns' | null }[] =
    buckets.map(() => ({ entityTypeId: null, entityScore: 0, entitySource: null }));

  const used = new Set<string>();
  const byName: { index: number; entityTypeId: string; score: number }[] = [];
  buckets.forEach((bucket, index) => {
    const hit = matchEntityByBucketName(bucket.name, entityTypes);
    if (hit) byName.push({ index, entityTypeId: hit.entityTypeId, score: hit.score });
  });
  byName.sort((a, b) => b.score - a.score);
  for (const item of byName) {
    if (used.has(item.entityTypeId)) continue;
    used.add(item.entityTypeId);
    assigned[item.index] = { entityTypeId: item.entityTypeId, entityScore: item.score, entitySource: 'bucket' };
  }

  buckets.forEach((bucket, index) => {
    if (assigned[index].entityTypeId) return;
    if (looksLikeEntityName(bucket.name)) return;
    const guess = guessEntityType(bucket.columns, entityTypes);
    if (!guess || used.has(guess.entityTypeId)) return;
    used.add(guess.entityTypeId);
    assigned[index] = { entityTypeId: guess.entityTypeId, entityScore: guess.score, entitySource: 'columns' };
  });

  return assigned;
}

/** 把分桶容器里的每个桶解析成 `GraphBucket`。 */
function buildBuckets(
  buckets: Record<string, unknown>,
  entityTypes: EntityType[],
): { buckets: GraphBucket[]; warnings: string[]; totalRows: number } {
  const warnings: string[] = [];

  const staged: { name: string; rows: Record<string, unknown>[]; truncated: number }[] = [];
  for (const [name, value] of Object.entries(buckets)) {
    if (!Array.isArray(value)) continue;
    const rows = value.filter(isPlainObject);
    if (rows.length === 0) {
      warnings.push(`桶「${name}」里没有对象行，已跳过。`);
      continue;
    }
    const truncated = Math.max(0, rows.length - MAX_IMPORT_ROWS);
    staged.push({ name, rows: truncated > 0 ? rows.slice(0, MAX_IMPORT_ROWS) : rows, truncated });
    if (truncated > 0) {
      warnings.push(`桶「${name}」共 ${rows.length} 行，已截取前 ${MAX_IMPORT_ROWS} 行接入。`);
    }
  }

  const withColumns = staged.map((b) => ({ ...b, columns: collectColumns(b.rows) }));
  const entities = assignBucketEntities(withColumns, entityTypes);

  const result: GraphBucket[] = withColumns.map((bucket, index) => {
    const entityTypeId = entities[index].entityTypeId;
    const entity = entityTypeId ? entityTypes.find((e) => e.id === entityTypeId) : undefined;
    return {
      name: bucket.name,
      rows: bucket.rows,
      columns: bucket.columns,
      truncated: bucket.truncated,
      entityTypeId,
      entityScore: entities[index].entityScore,
      entitySource: entities[index].entitySource,
      columnMappings: autoMapColumns(bucket.columns, entity),
    };
  });

  return {
    buckets: result,
    warnings,
    totalRows: result.reduce((sum, b) => sum + b.rows.length, 0),
  };
}

/** 把分桶图载荷解析成可批量接入的数据源配置。 */
function buildGraphResult(
  payload: Record<string, unknown>,
  container: { key: string; buckets: Record<string, unknown> },
  fileName: string,
  ontology: Ontology,
): GraphImportResult {
  const { buckets, warnings, totalRows } = buildBuckets(container.buckets, ontology.entityTypes);
  if (buckets.length === 0) {
    throw new Error(
      `文件里「${container.key}」下没有可用的实体实例。请确认它下面放的是「实体名 → 行数组」的列表。`,
    );
  }

  let relationshipKey: string | null = null;
  let relationshipRows: Record<string, unknown>[] = [];
  for (const key of RELATION_CONTAINER_KEYS) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    const rows = value.filter(isPlainObject);
    if (rows.length === 0) continue;
    relationshipKey = key;
    relationshipRows = rows;
    if (rows.length > MAX_IMPORT_ROWS) {
      warnings.push(`关系表共 ${rows.length} 行，已截取前 ${MAX_IMPORT_ROWS} 行接入。`);
      relationshipRows = rows.slice(0, MAX_IMPORT_ROWS);
    }
    break;
  }

  return {
    kind: 'graph',
    fileName,
    containerKey: container.key,
    metadata: readMetadata(payload),
    buckets,
    relationshipRows,
    relationshipColumns: collectColumns(relationshipRows),
    relationshipKey,
    totalRows,
    warnings,
  };
}

/**
 * 单入口：把上传文件的文本解析成可接入的数据源配置。
 * 只做一次 `JSON.parse`，随后自动判别是「扁平行数组」还是「多实体分桶图」。
 */
export function parseImportFile(
  text: string,
  fileName: string,
  ontology: Ontology,
): ImportParseResult {
  const payload = parseJsonText(text);
  const container = bucketContainerOf(payload);
  if (container) {
    return buildGraphResult(payload as Record<string, unknown>, container, fileName, ontology);
  }
  return buildFlatResult(payload, fileName, ontology);
}

/**
 * 把「扁平行数组」文本解析成可接入的数据源配置。
 * 解析失败时抛出带中文可执行提示的 Error。
 *
 * 分桶图请走 `parseImportFile` —— 本函数只负责一张表的形态。
 */
export function parseJsonForImport(
  text: string,
  fileName: string,
  ontology: Ontology,
): AutoImportResult {
  const result = parseImportFile(text, fileName, ontology);
  if (result.kind === 'graph') {
    throw new Error('这是一个「多实体分桶」的图 JSON，请使用分桶导入方式接入。');
  }
  return result;
}

/** 去掉扩展名，作为数据源的默认名称。 */
export function fileNameToEndpointName(fileName: string): string {
  return fileName.replace(/\.(json|txt)$/i, '') || fileName;
}

/**
 * 读取文件文本内容。
 *
 * 统一走 `FileReader` 而不是 `file.text()`：后者在 jsdom（测试环境）里不存在，
 * 会出现「浏览器能跑、测试必崩」的两套代码路径。FileReader 在浏览器与 jsdom
 * 里都可用，行为一致。
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}
