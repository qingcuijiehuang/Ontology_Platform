/**
 * 端到端验证：图谱高亮 + 「无下限 / 大上限」相关性召回
 * ---------------------------------------------------------------------------
 * 跑法：`npx tsx verify-retrieval-2026-09.mjs`
 * 不依赖 vitest/vite，绕过 rolldown entry 解析崩溃的环境问题。
 *
 * 2026-09 第二版变更：
 *  1. selectRelevantRows 取消 minKeep 下限 —— 没命中就是 0 行；
 *  2. 上限放大（调用方传大 topN，实际由命中决定）；
 *  3. 新增中英术语桥，让中文提问能召回英文数据行；
 *  4. 移除了「被映射的列 +0.5」兜底分（它会让每行都得正分）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cosmicCoffeeOntology } from './src/data/ontology.ts';
import {
  processQuery,
  selectRelevantRows,
  tokenize,
  expandCrossLingualTokens,
} from './src/data/queryEngine.ts';
import { buildDatasetContext, buildChatMessages, DEFAULT_ROWS_PER_DATASET } from './src/lib/llmClient.ts';

const DATA_DIR = resolve(process.cwd(), 'public/sample-data/fourth-coffee');

function loadRows(file) {
  const json = JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8'));
  return json.rows;
}

const customers = loadRows('customers.json');
const orders = loadRows('orders.json');
const products = loadRows('products.json');
const suppliers = loadRows('suppliers.json');
const shipments = loadRows('shipments.json');

// 与 dataSources.ts 中预设保持一致的列映射
const M = {
  customers: {
    customer_id: 'customerId',
    full_name: 'name',
    email_address: 'email',
    loyalty_status: 'loyaltyTier',
    registration_date: 'joinDate',
    lifetime_value: 'totalSpend',
  },
  orders: {
    order_id: 'orderId',
    order_timestamp: 'timestamp',
    order_total: 'total',
    order_status: 'status',
    payment_type: 'paymentMethod',
  },
  products: {
    ProductKey: 'productId',
    ProductName: 'name',
    ProductCategory: 'category',
    UnitPrice: 'price',
    OriginCountry: 'origin',
    IsOrganic: 'isOrganic',
  },
  suppliers: {
    supplier_id: 'supplierId',
    supplier_name: 'name',
    country_name: 'country',
    certification_type: 'certification',
    quality_rating: 'rating',
  },
  shipments: {
    shipment_id: 'shipmentId',
    dispatch_date: 'dispatchDate',
    arrival_date: 'arrivalDate',
    shipment_status: 'status',
    weight_kg: 'weight',
  },
};

let passed = 0;
let failed = 0;

function check(label, predicate, detail = '') {
  if (predicate) {
    passed += 1;
    console.log(`  \u2713 ${label}${detail ? ' \u2014 ' + detail : ''}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${label}${detail ? ' \u2014 ' + detail : ''}`);
  }
}

console.log('\n=== 0. 常量：上限很大 / 无下限 ===');
{
  check('DEFAULT_ROWS_PER_DATASET 是宽松上限（>= 100）', DEFAULT_ROWS_PER_DATASET >= 100, `实际 ${DEFAULT_ROWS_PER_DATASET}`);
}

console.log('\n=== 1. processQuery 中文同义词匹配（图谱高亮） ===');
{
  const cases = [
    { q: '什么是客户？', expect: ['customer'] },
    { q: '查询订单', expect: ['order'] },
    { q: '门店列表', expect: ['store'] },
    { q: '供应商资质', expect: ['supplier'] },
    { q: '货运状态', expect: ['shipment'] },
    { q: '咖啡产品', expect: ['product'] },
    { q: 'Platinum 会员', expect: ['customer'] },
    { q: '客户与订单如何关联', expect: ['customer', 'order'] },
  ];
  for (const c of cases) {
    const got = processQuery(c.q, cosmicCoffeeOntology).highlightEntities;
    check(`「${c.q}」 \u2192 高亮 [${c.expect.join(', ')}]`, c.expect.every((id) => got.includes(id)), `实际 [${got.join(', ')}]`);
  }
}

console.log('\n=== 2. selectRelevantRows 新语义：无下限、不补齐 ===');
{
  check('完全无关的问题 \u2192 0 行', selectRelevantRows(orders, '今天上海天气怎么样', M.orders, 120).length === 0);
  check('空问题 \u2192 0 行', selectRelevantRows(orders, '', M.orders, 120).length === 0);
  check('纯停用词问题 \u2192 0 行', selectRelevantRows(orders, '什么是 的', M.orders, 120).length === 0);
  check('rows 为空 \u2192 0 行', selectRelevantRows([], 'Completed', M.orders, 120).length === 0);

  const tiny = [
    { sku: 'A-1', note: 'organic beans' },
    { sku: 'A-2', note: 'plain beans' },
    { sku: 'A-3', note: 'organic tea' },
  ];
  const one = selectRelevantRows(tiny, 'organic', undefined, 120);
  check('命中 2 行就只给 2 行（不补齐）', one.length === 2, `实际 ${one.length} 行：${one.map((r) => r.sku).join(', ')}`);

  const all = selectRelevantRows(orders, '订单', M.orders, 120);
  check('上限生效但足够大：10 条订单全部召回', all.length === 10, `实际 ${all.length} 行`);
  const capped = selectRelevantRows(orders, '订单', M.orders, 3);
  check('topN 变小时确实被截断到 3 行', capped.length === 3, `实际 ${capped.length} 行`);
}

console.log('\n=== 3. 跨语言桥：中文提问 \u2192 英文数据行 ===');
{
  const toks = expandCrossLingualTokens('延迟的货运', tokenize('延迟的货运'));
  check("tokenize+扩展 含 'delayed'", toks.includes('delayed'));
  check("tokenize+扩展 含 'shipment'", toks.includes('shipment'));

  const delayed = selectRelevantRows(shipments, '哪些货运延误了', M.shipments, 120);
  check('「哪些货运延误了」召回货运表', delayed.length > 0, `实际 ${delayed.length} 行`);
  check('延迟的 SHIP-005 排最前', delayed[0]?.shipment_id === 'SHIP-005', `实际首行 ${delayed[0]?.shipment_id}`);

  const gift = expandCrossLingualTokens('礼品卡支付的订单', tokenize('礼品卡支付的订单'));
  check("多词别名拆分：'gift' / 'card' 都在", gift.includes('gift') && gift.includes('card'));
}

console.log('\n=== 4. 三道测试题的实际召回 ===');
{
  // Q1: Platinum 会员的订单
  const q1 = selectRelevantRows(orders, '两位 Platinum 最高等级会员的订单分别有哪些', M.orders, DEFAULT_ROWS_PER_DATASET);
  const platinum = new Set(customers.filter((c) => c.loyalty_status === 'Platinum').map((c) => c.customer_id));
  const q1Hit = q1.filter((r) => platinum.has(r.customer_id));
  check('Q1: 召回 Platinum 客户订单（CUST-002 两条 + CUST-008 一条）', q1Hit.length === 3, `实际 ${q1Hit.length} 条：${q1Hit.map((r) => r.order_id).join(', ')}`);
  check('Q1: 不再受「前 8 行」限制，ORD-2026-1009 也能进上下文', q1.some((r) => r.order_id === 'ORD-2026-1009'));

  // Q2: 在途 / 延迟货运
  const q2 = selectRelevantRows(shipments, '处于 In Transit 或 Delayed 的货运有几条', M.shipments, DEFAULT_ROWS_PER_DATASET);
  const q2Hit = q2.filter((r) => r.shipment_status === 'In Transit' || r.shipment_status === 'Delayed');
  check('Q2: 召回 3 条 In Transit / Delayed 货运', q2Hit.length === 3, `实际 ${q2Hit.map((r) => r.shipment_id).join(', ')}`);

  // Q3: 商品产地 ↔ 供应商国家
  const q3 = selectRelevantRows(products, '商品的产地 origin 能否对应到供应商国家 country', M.products, DEFAULT_ROWS_PER_DATASET);
  const supplierCountries = new Set(suppliers.map((s) => s.country_name));
  const matched = q3.filter((r) => supplierCountries.has(r.OriginCountry));
  check('Q3: 召回能匹配供应商国家的商品行（Guatemala 有两款）', matched.length === 6, `实际匹配 ${matched.length} 行（${matched.map((r) => r.OriginCountry).join(', ')}）`);
  check('Q3: 匹配不上的产地（Costa Rica / China / France）也在召回内，便于模型给出否定结论', ['Costa Rica', 'China', 'France'].every((c) => q3.some((r) => r.OriginCountry === c)));
}

console.log('\n=== 5. buildDatasetContext — 元信息与 0 行说明 ===');
{
  const base = {
    name: 'Fourth Coffee · 客户',
    kind: 'json-file',
    entityTypeId: 'customer',
    entityName: 'Customer',
    source: 'Data Lakehouse (bronze)',
    columnMappings: M.customers,
  };

  const withQ = buildDatasetContext([{ ...base, rowCount: customers.length, rows: customers }], DEFAULT_ROWS_PER_DATASET, 'Platinum 客户');
  check('提供 question 时标注「按问题相关性召回」', withQ.includes('按问题相关性召回'));
  check('Platinum 行排在 Gold 行之前', withQ.indexOf('CUST-002') < withQ.indexOf('CUST-001'));

  const noQ = buildDatasetContext([{ ...base, rowCount: customers.length, rows: customers }]);
  check('未提供 question 时标注「原始顺序」', noQ.includes('原始顺序'));

  const zero = buildDatasetContext([{ ...base, rowCount: customers.length, rows: customers }], DEFAULT_ROWS_PER_DATASET, '今天上海天气怎么样');
  check('0 行注入时给出明确说明', zero.includes('本次不注入任何行'), `含「召回 0 行」=${zero.includes('按问题相关性召回 0 行')}`);
  check('0 行注入时不出现任何客户数据', !zero.includes('CUST-001'));
}

console.log('\n=== 6. buildChatMessages — question 透传到上下文 ===');
{
  const ds = [
    {
      name: 'Fourth Coffee · 客户',
      kind: 'json-file',
      entityTypeId: 'customer',
      entityName: 'Customer',
      columnMappings: M.customers,
      rowCount: customers.length,
      rows: customers,
    },
  ];
  const msgs = buildChatMessages({ question: '铂金会员是谁？', ontology: cosmicCoffeeOntology, datasets: ds });
  const user = msgs[1].content;
  check('system 提示词存在', msgs[0].content.includes('只能依据'));
  check('system 提示词说明了「本次不注入任何行」的语义', msgs[0].content.includes('不注入任何行'));
  check('user 包含召回标签', user.includes('按问题相关性召回'));
  check('user 包含问题原文', user.includes('铂金会员是谁？'));
  check('user 包含 Platinum 客户 CUST-002', user.includes('CUST-002'));
  check('默认上限下 8 个客户全部进入上下文', ['CUST-001', 'CUST-002', 'CUST-003', 'CUST-004', 'CUST-005', 'CUST-006', 'CUST-007', 'CUST-008'].every((id) => user.includes(id)));
}

console.log('\n=== 7. tokenize ===');
{
  const t1 = tokenize('Platinum 客户订单');
  check('含 platinum', t1.includes('platinum'));
  check('含中文 bigram「客户」', t1.includes('客户'));
  check('含中文 bigram「订单」', t1.includes('订单'));

  const t2 = tokenize('查询所有的咖啡产品');
  check('过滤停用词「的」', !t2.includes('的'));
  check('保留「咖啡」「产品」', t2.includes('咖啡') && t2.includes('产品'));
}

console.log(`\n=== ${passed + failed} 项检查：${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.error('\u274c 有失败项');
  process.exit(1);
}
console.log('\u2705 全部通过');
