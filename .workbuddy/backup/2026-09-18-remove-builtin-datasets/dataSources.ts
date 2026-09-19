/**
 * Fourth Coffee — 数据源接入案例集
 * ---------------------------------------------------------------------------
 * 本文件把「第一个示例本体 Fourth Coffee（6 个实体 / 7 条关系）」接入真实数据所需的
 * 数据源配置固化下来，作为项目自带的可选案例，分三类：
 *
 *  1. 内置样本数据集（category: 'sample'）
 *     随项目分发的本地 JSON 文件（public/sample-data/fourth-coffee/*.json），
 *     每个实体类型一份，开箱即用、离线可访问。
 *     **默认不自动接入** —— 用户在「接入数据源」面板里按需勾选，
 *     以免自带的示例数据混进用户自己的数据集（见 DEFAULT_ENDPOINT_PRESETS）。
 *     字段刻意使用真实源系统的列名（如 customer_id / full_name），
 *     配合 columnMappings 演示「源系统列 → 本体属性」的映射关系。
 *
 *  2. 公开 REST / GraphQL 服务（category: 'rest' | 'graphql'）
 *     真实联网拉取 JSON，用于演示接入任意外部接口。
 *
 *  3. 公开 RDF / SPARQL 端点（category: 'sparql'）
 *     对真实三元组存储（Wikidata / DBpedia）执行 SPARQL 查询，
 *     预设查询已按 Fourth Coffee 的实体语义（商品 / 门店 / 供应商）编写。
 *
 * 所有预设均可通过「接入数据源」面板一键接入（单个 / 整组），
 * 也可在 appStore 里用 `resetEndpoints()` 清空全部数据源。
 */
import type { EndpointKind } from '../store/appStore';

export type DataSourceCategory = 'sample' | 'rest' | 'sparql' | 'graphql';

export interface DataSourcePreset {
  /** 稳定标识，用于去重与展示。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 数据源类型。 */
  kind: EndpointKind;
  /** 数据源地址（内置样本数据会按 Vite base 解析为站点内相对地址）。 */
  url: string;
  /** 一句话说明这份数据是什么、有多少条。 */
  description: string;
  /** 所属分类，用于面板分组。 */
  category: DataSourceCategory;
  /** 该数据源映射到的 Fourth Coffee 实体类型 id。 */
  entityTypeId?: string;
  /** 源系统列名 → 本体属性名。 */
  columnMappings?: Record<string, string>;
  /** SPARQL / GraphQL 端点的预设查询。 */
  query?: string;
  /** 是否为项目内置的官方样本案例（用于标注「内置」徽标与排序）。 */
  isDefault?: boolean;
  /** 需要提示用户的注意事项（例如公共端点限流）。 */
  note?: string;
}

/** 分类元信息，供面板分组与排序使用。 */
export const CATEGORY_META: Record<
  DataSourceCategory,
  { label: string; description: string; order: number }
> = {
  sample: {
    label: '内置样本数据集',
    description: '随项目分发的本地 JSON 数据，开箱即用、离线可访问，按需接入',
    order: 0,
  },
  rest: {
    label: '公开 REST API',
    description: '真实联网拉取 JSON 数据，需目标服务允许跨域（CORS）',
    order: 1,
  },
  sparql: {
    label: '公开 RDF / SPARQL 端点',
    description: '对真实三元组存储执行 SPARQL 查询并解析 SPARQL JSON 结果',
    order: 2,
  },
  graphql: {
    label: '公开 GraphQL 服务',
    description: '通过 GraphQL 查询真实数据，自动解析 data 字段',
    order: 3,
  },
};

/** 内置样本数据所在目录（相对 public/）。 */
const SAMPLE_DATA_DIR = 'sample-data/fourth-coffee';

/** 把 public 资源相对路径解析为当前部署 base 下的可访问地址。 */
function assetUrl(relativePath: string): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL && env.BASE_URL.length > 0 ? env.BASE_URL : '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\//, '')}`;
}

function sample(url: string): string {
  return assetUrl(`${SAMPLE_DATA_DIR}/${url}`);
}

// ── 公开端点 ────────────────────────────────────────────────────────────────

/** Wikidata：咖啡品类与其产地国（映射到 Product）。 */
const WIKIDATA_COFFEE_PRODUCTS = `SELECT ?product ?productLabel ?originLabel WHERE {
  ?product wdt:P31 wd:Q8486 .
  OPTIONAL { ?product wdt:P495 ?origin . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
} LIMIT 50`;

/** Wikidata：世界各地的咖啡馆及其所在城市（映射到 Store）。 */
const WIKIDATA_COFFEE_SHOPS = `SELECT ?store ?storeLabel ?cityLabel WHERE {
  ?store wdt:P31/wdt:P279* wd:Q30022 .
  ?store wdt:P131 ?city .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
} LIMIT 50`;

/** Wikidata：咖啡行业公司及其所属国家（映射到 Supplier）。 */
const WIKIDATA_COFFEE_COMPANIES = `SELECT ?supplier ?supplierLabel ?countryLabel WHERE {
  ?supplier wdt:P31/wdt:P279* wd:Q4830453 ;
            wdt:P452 wd:Q8486 .
  OPTIONAL { ?supplier wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
} LIMIT 50`;

/** DBpedia：带明确产地的饮品条目（映射到 Product）。 */
const DBPEDIA_BEVERAGES = `PREFIX dbo: <http://dbpedia.org/ontology/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?product ?productLabel ?originLabel WHERE {
  ?product a dbo:Beverage ;
           rdfs:label ?productLabel ;
           dbo:origin ?origin .
  OPTIONAL { ?origin rdfs:label ?originLabel . FILTER(lang(?originLabel) = "en") }
  FILTER(lang(?productLabel) = "en")
} LIMIT 50`;

// ── 案例集本体 ──────────────────────────────────────────────────────────────

export const FOURTH_COFFEE_DATASOURCES: DataSourcePreset[] = [
  // ── 一、内置样本数据集（6 个，与本体 6 个实体一一对应，按需接入） ──────────
  {
    id: 'fc-sample-customers',
    name: 'Fourth Coffee · 客户',
    kind: 'json-file',
    url: sample('customers.json'),
    description: '数据湖仓 bronze 层客户主数据，8 条记录，含会员等级与生命周期价值',
    category: 'sample',
    entityTypeId: 'customer',
    columnMappings: {
      customer_id: 'customerId',
      full_name: 'name',
      email_address: 'email',
      loyalty_status: 'loyaltyTier',
      registration_date: 'joinDate',
      lifetime_value: 'totalSpend',
    },
    isDefault: true,
  },
  {
    id: 'fc-sample-orders',
    name: 'Fourth Coffee · 订单',
    kind: 'json-file',
    url: sample('orders.json'),
    description: '数据湖仓 silver 层订单流水，10 条记录，含状态、支付方式与关联客户门店',
    category: 'sample',
    entityTypeId: 'order',
    columnMappings: {
      order_id: 'orderId',
      order_timestamp: 'timestamp',
      order_total: 'total',
      order_status: 'status',
      payment_type: 'paymentMethod',
    },
    isDefault: true,
  },
  {
    id: 'fc-sample-products',
    name: 'Fourth Coffee · 商品',
    kind: 'json-file',
    url: sample('products.json'),
    description: '语义模型 Products 表，10 条记录，含品类、单价、产地与是否有机',
    category: 'sample',
    entityTypeId: 'product',
    columnMappings: {
      ProductKey: 'productId',
      ProductName: 'name',
      ProductCategory: 'category',
      UnitPrice: 'price',
      OriginCountry: 'origin',
      IsOrganic: 'isOrganic',
    },
    isDefault: true,
  },
  {
    id: 'fc-sample-stores',
    name: 'Fourth Coffee · 门店',
    kind: 'json-file',
    url: sample('stores.json'),
    description: '数据湖仓 bronze 层门店主数据，6 条记录，覆盖西雅图 / 波特兰 / 温哥华等地',
    category: 'sample',
    entityTypeId: 'store',
    columnMappings: {
      store_id: 'storeId',
      store_name: 'name',
      city: 'city',
      state_code: 'state',
      opened_on: 'openDate',
      seat_capacity: 'capacity',
    },
    isDefault: true,
  },
  {
    id: 'fc-sample-suppliers',
    name: 'Fourth Coffee · 供应商',
    kind: 'json-file',
    url: sample('suppliers.json'),
    description: '数据湖仓 bronze 层供应商主数据，5 条记录，含产地国与可持续认证',
    category: 'sample',
    entityTypeId: 'supplier',
    columnMappings: {
      supplier_id: 'supplierId',
      supplier_name: 'name',
      country_name: 'country',
      certification_type: 'certification',
      quality_rating: 'rating',
    },
    isDefault: true,
  },
  {
    id: 'fc-sample-shipments',
    name: 'Fourth Coffee · 货运',
    kind: 'json-file',
    url: sample('shipments.json'),
    description: '数据湖仓 bronze 层货运单，6 条记录，含发运 / 到货日期与在途状态',
    category: 'sample',
    entityTypeId: 'shipment',
    columnMappings: {
      shipment_id: 'shipmentId',
      dispatch_date: 'dispatchDate',
      arrival_date: 'arrivalDate',
      shipment_status: 'status',
      weight_kg: 'weight',
    },
    isDefault: true,
  },

  // ── 二、公开 REST API ─────────────────────────────────────────────────────
  {
    id: 'fc-rest-coffee-hot',
    name: '咖啡饮品 API · 热饮',
    kind: 'rest',
    url: 'https://api.sampleapis.com/coffee/hot',
    description: '公开咖啡饮品数据集，23 款热饮，含配方与描述，映射到商品实体',
    category: 'rest',
    entityTypeId: 'product',
    columnMappings: { title: 'name' },
  },
  {
    id: 'fc-rest-coffee-iced',
    name: '咖啡饮品 API · 冰饮',
    kind: 'rest',
    url: 'https://api.sampleapis.com/coffee/iced',
    description: '公开咖啡饮品数据集，6 款冰饮，映射到商品实体',
    category: 'rest',
    entityTypeId: 'product',
    columnMappings: { title: 'name' },
  },

  // ── 三、公开 RDF / SPARQL 端点 ────────────────────────────────────────────
  {
    id: 'fc-sparql-wd-products',
    name: 'Wikidata · 咖啡品类与产地',
    kind: 'sparql',
    url: 'https://query.wikidata.org/sparql',
    description: '查询 Wikidata 中所有咖啡品类及其产地国，映射到商品实体',
    category: 'sparql',
    entityTypeId: 'product',
    query: WIKIDATA_COFFEE_PRODUCTS,
    note: '公共端点有频率限制，连续请求可能返回 429。',
  },
  {
    id: 'fc-sparql-wd-stores',
    name: 'Wikidata · 咖啡馆（按城市）',
    kind: 'sparql',
    url: 'https://query.wikidata.org/sparql',
    description: '查询世界各地的咖啡馆及其所在城市，映射到门店实体',
    category: 'sparql',
    entityTypeId: 'store',
    query: WIKIDATA_COFFEE_SHOPS,
    note: '公共端点有频率限制，连续请求可能返回 429。',
  },
  {
    id: 'fc-sparql-wd-suppliers',
    name: 'Wikidata · 咖啡行业公司',
    kind: 'sparql',
    url: 'https://query.wikidata.org/sparql',
    description: '查询以咖啡为行业的公司及其所属国家，映射到供应商实体',
    category: 'sparql',
    entityTypeId: 'supplier',
    query: WIKIDATA_COFFEE_COMPANIES,
    note: '公共端点有频率限制，连续请求可能返回 429。',
  },
  {
    id: 'fc-sparql-dbpedia-beverages',
    name: 'DBpedia · 饮品与产地',
    kind: 'sparql',
    url: 'https://dbpedia.org/sparql',
    description: '查询 DBpedia 中带明确产地的饮品条目，映射到商品实体',
    category: 'sparql',
    entityTypeId: 'product',
    query: DBPEDIA_BEVERAGES,
    note: 'DBpedia 公共端点在国内访问可能较慢或超时。',
  },

  // ── 四、公开 GraphQL 服务 ────────────────────────────────────────────────
  {
    id: 'fc-graphql-countries',
    name: 'Countries GraphQL · 国家与币种',
    kind: 'graphql',
    url: 'https://countries.trevorblades.com/graphql',
    description: '查询全球国家及其首都 / 币种，可用于校验供应商的国家字段，映射到供应商实体',
    category: 'graphql',
    entityTypeId: 'supplier',
    query: '{countries{code name capital currency}}',
    columnMappings: { name: 'country' },
  },
];

/**
 * 内置样本数据集（category: 'sample'，6 个，与 Fourth Coffee 本体 6 个实体一一对应）。
 *
 * 它们只是「可选的示例」，不再随平台自动接入 —— 仅供摘要在面板里展示数量、
 * 以及文档 / 测试引用，真正的接入动作由用户在面板中触发。
 */
export const SAMPLE_PRESETS: DataSourcePreset[] = FOURTH_COFFEE_DATASOURCES.filter(
  (p) => p.category === 'sample',
);

/**
 * 首次打开平台时**自动接入**的数据源案例。
 *
 * 当前恒为空 —— 平台不再默认接入任何 Fourth Coffee 数据集，
 * 打开后「已接入的数据源」列表是空的，由用户自己从下方案例集里挑，
 * 或上传自己的 JSON 文件。这样就避免了自带的咖啡示例数据
 * 混进用户自己要用的数据集里。
 *
 * 若想恢复「开箱即用」的默认案例，把下面的 `[]` 换回：
 *   FOURTH_COFFEE_DATASOURCES.filter((p) => p.category === 'sample')
 */
export const DEFAULT_ENDPOINT_PRESETS: DataSourcePreset[] = [];

/** 按分类分组，供面板渲染（组内保持定义顺序）。 */
export function groupPresetsByCategory(
  presets: DataSourcePreset[] = FOURTH_COFFEE_DATASOURCES,
): { category: DataSourceCategory; meta: (typeof CATEGORY_META)[DataSourceCategory]; presets: DataSourcePreset[] }[] {
  return (Object.keys(CATEGORY_META) as DataSourceCategory[])
    .sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order)
    .map((category) => ({
      category,
      meta: CATEGORY_META[category],
      presets: presets.filter((p) => p.category === category),
    }))
    .filter((group) => group.presets.length > 0);
}
