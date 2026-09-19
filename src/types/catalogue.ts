import type { Ontology, DataBinding } from '../data/ontology';

export interface CatalogueEntry {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  tags: string[];
  author: string;
  /**
   * 来源。`local` 表示用户在本地「导入 RDF → 存入本体库」保存的本体
   * （只存在浏览器 localStorage 里，不随 catalogue.json 分发）。
   */
  source: 'official' | 'community' | 'external' | 'local';
  /** 本地保存条目专用：保存时间（ms）。编译期条目不会有这个字段。 */
  savedAt?: number;
  ontology: Ontology;
  bindings: DataBinding[];
}

export interface Catalogue {
  generatedAt: string;
  count: number;
  entries: CatalogueEntry[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  retail: '零售',
  healthcare: '医疗健康',
  finance: '金融',
  manufacturing: '制造业',
  education: '教育',
  food: '食品饮料',
  media: '媒体出版',
  events: '活动娱乐',
  technology: '科技',
  general: '通用',
  school: '本体学校 · 从这里开始',
  fibo: 'FIBO（EDM 委员会）',
};

export const CATEGORY_COLORS: Record<string, string> = {
  retail: '#0078D4',
  healthcare: '#D13438',
  finance: '#107C10',
  manufacturing: '#FFB900',
  education: '#8764B8',
  food: '#E74C3C',
  media: '#9B59B6',
  events: '#00A9E0',
  technology: '#008272',
  general: '#6B7280',
  school: '#E67E22',
  fibo: '#1A5276',
};

/** 本地保存条目的分类与来源标识。 */
export const LOCAL_SOURCE_LABEL = '我的';
export const LOCAL_SOURCE_COLOR = '#0078D4';
