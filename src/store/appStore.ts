import { create } from 'zustand';
import type { Ontology, DataBinding } from '../data/ontology';
import { cosmicCoffeeOntology, sampleBindings } from '../data/ontology';
import { DEFAULT_LLM_CONFIG, sanitizeLlmConfig, type LlmConfig } from '../data/llmProviders';

export type ThemeId = 'dark' | 'light' | 'aurora' | 'crimson';

// Picker order = this array's order. 浅色 leads because it is the product
// default (`getInitialTheme()` falls back to 'light'), so the first entry in
// the menu matches what a first-time visitor actually sees.
export const THEME_OPTIONS: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'light', label: '浅色', swatch: '#F5F5F5' },
  { id: 'dark', label: '深色', swatch: '#1B1B1B' },
  { id: 'aurora', label: '极光', swatch: '#2AAA92' },
  { id: 'crimson', label: '绯红', swatch: '#D6002A' },
];

const DARK_BASED_THEMES: ThemeId[] = ['dark', 'aurora'];

/** Whether a theme uses the dark base palette (drives graph/RDF rendering). */
export function isDarkTheme(theme: ThemeId): boolean {
  return DARK_BASED_THEMES.includes(theme);
}

/** CSS class(es) applied to a themed root element. */
export function themeClass(theme: ThemeId): string {
  switch (theme) {
    case 'light':
      return 'light-theme';
    case 'aurora':
      return 'theme-aurora';
    case 'crimson':
      return 'light-theme theme-crimson';
    default:
      return '';
  }
}

function getInitialTheme(): ThemeId {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return 'light';
  }
  try {
    const stored = window.localStorage.getItem('theme');
    if (stored && THEME_OPTIONS.some((t) => t.id === stored)) {
      return stored as ThemeId;
    }
    // Migrate the legacy light/dark flag
    if (window.localStorage.getItem('darkMode') === 'true') {
      return 'dark';
    }
    return 'light';
  } catch {
    return 'light';
  }
}

const initialTheme = getInitialTheme();

export type EndpointKind = 'rest' | 'sparql' | 'graphql' | 'json-file';

export interface DataEndpoint {
  id: string;
  kind: EndpointKind;
  name: string;
  url: string;
  /** Optional static headers (JSON object) to send with each request. */
  headers?: Record<string, string>;
  /** Which ontology entity type this data source maps to. */
  entityTypeId?: string;
  /** Source column name → ontology property name. */
  columnMappings?: Record<string, string>;
  /** Preset SPARQL / GraphQL query for this endpoint (when applicable). */
  query?: string;
  /** Human-readable origin of the data (e.g. "Data Lakehouse (bronze)"). */
  source?: string;
  /** Last time this endpoint was successfully fetched (ms). */
  lastFetchedAt?: number;
  /** Last fetch status: 'ok' | 'error' | 'idle'. */
  lastFetchStatus?: 'ok' | 'error' | 'idle';
  /** Optional last error message. */
  lastError?: string;
  /**
   * 本地 JSON 文件接入：解析后的原始行数据。
   * 存在时 `fetchEndpointRows` 会直接返回它、不发任何网络请求，
   * 因此这类数据源天然离线可用、也不受 CORS 限制。
   * 注意：只存在内存里（endpoints 未持久化），刷新页面后需重新上传。
   */
  localRows?: Record<string, unknown>[];
  /** 本地 JSON 文件名，用于列表展示（替代 URL 链接）。 */
  localFileName?: string;
  /**
   * 从本体库恢复的数据源：原本是本地 JSON 文件，但**行数据没有随库存下来**
   * （行数据体积可能很大，存进 localStorage 会撞配额）。
   * 带上此标记时，抓取层不发请求，UI 提示用户重新上传该文件。
   */
  needsFileReupload?: boolean;
}

/**
 * 平台启动时接入的数据源：恒为空。
 *
 * 产品**不内置任何数据集** —— 打开时数据源列表是空的，
 * 全部数据由用户通过「接入数据源」面板手动填写或自动解析接入。
 */
export function buildDefaultEndpoints(): DataEndpoint[] {
  return [];
}

// ── 大模型配置持久化 ────────────────────────────────────────────────────────
// Key 只保存在用户浏览器本地，仅在调用所选厂商接口时随请求头发送。
const LLM_STORAGE_KEY = 'ontology-platform.llm-config';

function loadLlmConfig(): LlmConfig {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return { ...DEFAULT_LLM_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(LLM_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LLM_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    // 用 sanitizeLlmConfig 兜住历史脏数据：maxTokens / temperature 若不是
    // 合法数值会被就地修复，避免「测试连接通过但提问报 400」这类问题。
    return sanitizeLlmConfig(parsed);
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

function persistLlmConfig(config: LlmConfig): void {
  if (typeof window === 'undefined' || !('localStorage' in window)) return;
  try {
    window.localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 忽略持久化失败（隐私模式等），内存态仍然生效
  }
}

// ── 智能问答系统提示词持久化 ────────────────────────────────────────────────
// 空字符串表示「使用内置默认提示词」（DEFAULT_SYSTEM_PROMPT，见 lib/llmClient）。
const AI_SYSTEM_PROMPT_KEY = 'ontology-platform.ai-system-prompt';
/** 提示词长度上限：防止误粘贴超大文本把每次请求的上下文撑爆。 */
export const AI_SYSTEM_PROMPT_MAX_LENGTH = 8000;

function loadAiSystemPrompt(): string {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return '';
  }
  try {
    const raw = window.localStorage.getItem(AI_SYSTEM_PROMPT_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed.slice(0, AI_SYSTEM_PROMPT_MAX_LENGTH) : '';
  } catch {
    return '';
  }
}

function persistAiSystemPrompt(prompt: string): void {
  if (typeof window === 'undefined' || !('localStorage' in window)) return;
  try {
    window.localStorage.setItem(AI_SYSTEM_PROMPT_KEY, JSON.stringify(prompt));
  } catch {
    // 忽略持久化失败（隐私模式等），内存态仍然生效
  }
}

interface AppState {
  // Ontology State
  currentOntology: Ontology;
  dataBindings: DataBinding[];
  /** Live endpoints the platform can call to retrieve actual data. */
  endpoints: DataEndpoint[];

  // UI State
  selectedEntityId: string | null;
  selectedRelationshipId: string | null;
  highlightedEntities: string[];
  highlightedRelationships: string[];
  showDataBindings: boolean;
  theme: ThemeId;
  darkMode: boolean;

  /** 大模型接入配置（厂商 / 接口 / Key / 模型）。 */
  llm: LlmConfig;

  /**
   * 智能检索问答的自定义系统提示词。
   * 空字符串 = 使用内置默认提示词（DEFAULT_SYSTEM_PROMPT）。
   * 检索回答始终基于「系统提示词 + 本体知识图谱 + 真实数据集」。
   */
  aiSystemPrompt: string;

  // Query State
  queryInput: string;
  queryResult: string | null;

  // Ontology Actions
  loadOntology: (ontology: Ontology, bindings?: DataBinding[]) => void;
  resetToDefault: () => void;
  exportOntology: () => string;

  // Endpoint Actions
  addEndpoint: (endpoint: Omit<DataEndpoint, 'id'>) => string;
  updateEndpoint: (id: string, patch: Partial<DataEndpoint>) => void;
  removeEndpoint: (id: string) => void;
  /** Clear every connected endpoint (back to the empty initial state). */
  resetEndpoints: () => void;
  /** 整体替换已接入的数据源（从本体库恢复某条记录时使用）。 */
  setEndpoints: (endpoints: DataEndpoint[]) => void;

  // Actions
  selectEntity: (id: string | null) => void;
  selectRelationship: (id: string | null) => void;
  setHighlightedEntities: (ids: string[]) => void;
  setHighlightedRelationships: (ids: string[]) => void;
  setHighlights: (entityIds: string[], relIds: string[]) => void;
  toggleDataBindings: () => void;
  setTheme: (theme: ThemeId) => void;
  toggleDarkMode: () => void;

  // LLM Actions
  /** 局部更新大模型配置并持久化。 */
  setLlmConfig: (patch: Partial<LlmConfig>) => void;
  /** 恢复默认大模型配置（清空 Key）。 */
  resetLlmConfig: () => void;
  /** 设置智能问答的系统提示词（传空字符串即恢复默认提示词）。 */
  setAiSystemPrompt: (prompt: string) => void;

  // Query Actions
  setQueryInput: (input: string) => void;
  setQueryResult: (result: string | null) => void;
  clearHighlights: () => void;
}

const newId = () => `ep_${Math.random().toString(36).slice(2, 10)}`;

export const useAppStore = create<AppState>((set, get) => ({
  // Initial Ontology State
  currentOntology: cosmicCoffeeOntology,
  dataBindings: sampleBindings,
  // Default data source state — the platform ships with **no** bundled datasets;
  // every endpoint is added by the user (manual form or JSON auto-parse).
  endpoints: buildDefaultEndpoints(),

  // Initial UI State
  selectedEntityId: null,
  selectedRelationshipId: null,
  highlightedEntities: [],
  highlightedRelationships: [],
  showDataBindings: false,
  theme: initialTheme,
  darkMode: isDarkTheme(initialTheme),
  llm: loadLlmConfig(),
  aiSystemPrompt: loadAiSystemPrompt(),

  // Initial Query State
  queryInput: '',
  queryResult: null,

  // Ontology Actions
  loadOntology: (ontology, bindings = []) => {
    set({
      currentOntology: ontology,
      dataBindings: bindings,
      selectedEntityId: null,
      selectedRelationshipId: null,
      highlightedEntities: [],
      highlightedRelationships: [],
    });
  },

  resetToDefault: () => set({
    currentOntology: cosmicCoffeeOntology,
    dataBindings: sampleBindings,
    selectedEntityId: null,
    selectedRelationshipId: null,
    highlightedEntities: [],
    highlightedRelationships: [],
  }),

  exportOntology: () => {
    const { currentOntology, dataBindings } = get();
    return JSON.stringify({ ontology: currentOntology, bindings: dataBindings }, null, 2);
  },

  // Endpoint Actions
  addEndpoint: (endpoint) => {
    const id = newId();
    set((state) => ({ endpoints: [...state.endpoints, { ...endpoint, id, lastFetchStatus: 'idle' as const }] }));
    return id;
  },

  updateEndpoint: (id, patch) => {
    set((state) => ({
      endpoints: state.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  },

  removeEndpoint: (id) => {
    set((state) => ({ endpoints: state.endpoints.filter((e) => e.id !== id) }));
  },

  resetEndpoints: () => set({ endpoints: buildDefaultEndpoints() }),

  setEndpoints: (endpoints) => set({ endpoints: [...endpoints] }),

  // UI Actions
  selectEntity: (id) => set({
    selectedEntityId: id,
    selectedRelationshipId: null
  }),

  selectRelationship: (id) => set({
    selectedRelationshipId: id,
    selectedEntityId: null
  }),

  setHighlightedEntities: (ids) => set({ highlightedEntities: ids }),
  setHighlightedRelationships: (ids) => set({ highlightedRelationships: ids }),
  setHighlights: (entityIds, relIds) => set({ highlightedEntities: entityIds, highlightedRelationships: relIds }),

  toggleDataBindings: () => set((state) => ({ showDataBindings: !state.showDataBindings })),
  setTheme: (theme) => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Ignore persistence errors; still update in-memory state
    }
    set({ theme, darkMode: isDarkTheme(theme) });
  },
  toggleDarkMode: () => {
    const next: ThemeId = isDarkTheme(get().theme) ? 'light' : 'dark';
    get().setTheme(next);
  },

  // LLM Actions
  setLlmConfig: (patch) => {
    set((state) => {
      // 每次写入都做一次归一化，保证内存态与持久化态里的
      // maxTokens / temperature 始终落在厂商允许的区间内。
      const llm = sanitizeLlmConfig({ ...state.llm, ...patch });
      persistLlmConfig(llm);
      return { llm };
    });
  },

  resetLlmConfig: () => {
    const llm = { ...DEFAULT_LLM_CONFIG };
    persistLlmConfig(llm);
    set({ llm });
  },

  setAiSystemPrompt: (prompt) => {
    const normalized = (prompt ?? '').slice(0, AI_SYSTEM_PROMPT_MAX_LENGTH);
    persistAiSystemPrompt(normalized);
    set({ aiSystemPrompt: normalized });
  },

  // Query Actions
  setQueryInput: (input) => set({ queryInput: input }),
  setQueryResult: (result) => set({ queryResult: result }),
  clearHighlights: () => set({ highlightedEntities: [], highlightedRelationships: [] })
}));