/**
 * 本体库的「本地保存区」
 * ---------------------------------------------------------------------------
 * 用户可以把自己的东西**存入本体库**，之后在「本体库」弹窗里随时重新加载：
 *  1. 导入 RDF 成功后的本体（可带数据绑定 bindings）；
 *  2. 在「接入数据源」面板里配置好的数据源（endpoints）——
 *     一起存成同一个条目，加载时本体与数据源一并恢复。
 *
 * 设计要点：
 *  1. **只存浏览器 localStorage**，不随 catalogue.json 分发 —— 本体库的官方 /
 *     社区条目是构建期编译出来的静态内容，用户保存的本体属于「我的」来源
 *     （`source: 'local'`），两类在 GalleryModal 里合并展示。
 *  2. **同名覆盖**：再次保存同名本体时原地更新（保留原 id），不会堆出重复卡片。
 *     这也意味着「先存本体、后存数据源」= 后者补齐到同一条目上，不会变成两张卡。
 *  3. 容量防御：单条本体序列化后一般几十 KB，localStorage 5MB 足够；
 *     写入失败（隐私模式 / 配额满）时抛出带中文提示的错误，由 UI 呈现。
 *     **本地 JSON 文件的数据行（localRows）绝不入库** —— 上千行的原始数据
 *     很容易撑爆配额；入库时剥离并打上 `needsFileReupload` 标记，
 *     加载后 UI 提示重新上传文件（见 `toRuntimeEndpoints`）。
 *  4. 纯函数 + 显式存储读写，全部可单测（vitest 环境自带 jsdom localStorage）。
 */
import type { CatalogueEntry } from '../types/catalogue';
import type { Ontology, DataBinding } from '../data/ontology';
import type { DataEndpoint } from '../store/appStore';

const STORAGE_KEY = 'ontology-platform.user-ontology-library';

/** 本地保存条目在存储里的完整形态（CatalogueEntry + 保存时间 + 数据源）。 */
export interface StoredUserOntology extends CatalogueEntry {
  savedAt: number;
  /** 随本体一起保存的已接入数据源。 */
  endpoints?: DataEndpoint[];
}

function readStore(): StoredUserOntology[] {
  if (typeof window === 'undefined' || !('localStorage' in window)) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 只保留结构合法的条目，坏数据直接丢弃（例如旧版本字段变更）
    return parsed.filter(
      (e): e is StoredUserOntology =>
        typeof e === 'object' && e !== null &&
        typeof (e as StoredUserOntology).id === 'string' &&
        typeof (e as StoredUserOntology).name === 'string' &&
        Boolean((e as StoredUserOntology).ontology),
    );
  } catch {
    return [];
  }
}

function writeStore(entries: StoredUserOntology[]): void {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    throw new Error('当前环境不支持本地存储，无法保存到本体库。');
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    throw new Error(
      `保存到本体库失败：${err instanceof Error ? err.message : String(err)}。` +
        '可能是浏览器存储配额已满或处于隐私模式。',
    );
  }
}

/** 列出用户存入本体库的全部本体（按保存时间倒序，最新的在前）。 */
export function listUserOntologies(): StoredUserOntology[] {
  return readStore().sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/**
 * 入库前的数据源归一化：
 *  - 剥掉本地 JSON 文件的**行数据**（体积不可控），改打 `needsFileReupload` 标记；
 *  - 剥掉一次性的抓取状态（成功/失败/时间戳），这些是运行时信息、入库无意义。
 */
function toStoredEndpoint(endpoint: DataEndpoint): DataEndpoint {
  const persisted: DataEndpoint = { ...endpoint };
  if (endpoint.localRows && endpoint.localRows.length > 0) {
    persisted.needsFileReupload = true;
  }
  delete persisted.localRows;
  delete persisted.lastFetchStatus;
  delete persisted.lastFetchedAt;
  delete persisted.lastError;
  return persisted;
}

/** 从库条目取出数据源，恢复为可直接使用的运行时形态。 */
export function toRuntimeEndpoints(endpoints: DataEndpoint[] = []): DataEndpoint[] {
  return endpoints.map((ep) => ({ ...ep, lastFetchStatus: 'idle' as const, lastError: undefined }));
}

/** 统计一份数据源里「需要重新上传文件」的条数（入库时会丢失行数据的那几类）。 */
export function countReuploadEndpoints(endpoints: DataEndpoint[] = []): number {
  return endpoints.filter((ep) => Boolean(ep.localRows && ep.localRows.length > 0) || ep.needsFileReupload).length;
}

/**
 * 把一份本体（连同可选的数据源）存入本体库（同名覆盖）。
 *
 * `endpoints` 的语义要分清，否则会静默丢数据：
 *  - **不传**（`undefined`）：不动这条记录里已有的数据源。
 *    给「导入 RDF → 存入本体库」这类只关心本体的调用方用。
 *  - **传数组**（哪怕是空数组）：整体替换数据源。
 *    给「接入数据源 → 存入本体库」用（用户删掉某个源后再存，就要真的少一个）。
 *
 * 返回保存后的完整列表与本次写入的条目。
 */
export function saveUserOntology(
  ontology: Ontology,
  bindings: DataBinding[] = [],
  endpoints?: DataEndpoint[],
): { entries: StoredUserOntology[]; entry: StoredUserOntology } {
  const entries = readStore();
  const existingIndex = entries.findIndex((e) => e.ontology.name === ontology.name);
  const previous = existingIndex >= 0 ? entries[existingIndex] : undefined;
  // 不传 endpoints 且此前也没存过 → 保持 undefined（「这条记录不管理数据源」），
  // 而不是硬塞一个空数组：否则加载这条记录时会把用户当前接入的数据源清空。
  const storedEndpoints = endpoints === undefined
    ? previous?.endpoints
    : endpoints.map(toStoredEndpoint);
  // savedAt 单调递增：同一毫秒内连续保存时保底 +1，
  // 保证「最新的在前」排序稳定，也不会出现两条完全相同的时间戳。
  const maxSavedAt = entries.reduce((max, e) => Math.max(max, e.savedAt ?? 0), 0);
  const savedAt = Math.max(Date.now(), maxSavedAt + 1);

  const entry: StoredUserOntology = {
    // 同名覆盖时保留原 id，避免外部引用（如 URL 深链）失效；
    // id 里带随机后缀 —— 同一毫秒内连续保存两份本体也不能碰撞。
    id: existingIndex >= 0
      ? entries[existingIndex].id
      : `local/${slugify(ontology.name)}-${savedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: ontology.name || '未命名本体',
    description: ontology.description || '从导入的 RDF 文件保存到本地本体库。',
    icon: '📥',
    category: 'general',
    tags: [],
    author: '我',
    source: 'local',
    savedAt,
    ontology,
    bindings,
    endpoints: storedEndpoints,
  };

  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }
  writeStore(entries);
  return { entries: listUserOntologies(), entry };
}

/** 从本体库移除一条本地保存的本体，返回剩余列表。 */
export function removeUserOntology(id: string): StoredUserOntology[] {
  const entries = readStore().filter((e) => e.id !== id);
  writeStore(entries);
  return listUserOntologies();
}

function slugify(name: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // 纯中文名 slug 化后为空，退化为 'onto'（id 唯一性由时间戳保证）
  return ascii || 'onto';
}
