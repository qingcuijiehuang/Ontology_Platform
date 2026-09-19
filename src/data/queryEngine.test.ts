import { describe, expect, it } from 'vitest';
import {
  processQuery,
  generateQuerySuggestions,
  selectRelevantRows,
  tokenize,
  expandCrossLingualTokens,
} from './queryEngine';
import { cosmicCoffeeOntology } from './ontology';
import type { Ontology } from './ontology';

const testOntology: Ontology = {
  name: 'Incident Management Ontology',
  description: 'Test ontology for query handling.',
  entityTypes: [
    {
      id: 'service',
      name: 'Service',
      description: 'Business or IT service being disrupted.',
      icon: '⚙️',
      color: '#E74C3C',
      properties: [
        { name: 'serviceId', type: 'string', isIdentifier: true },
      ],
    },
    {
      id: 'configurationitem',
      name: 'ConfigurationItem',
      description: 'Underlying asset or component causing the incident.',
      icon: '🧩',
      color: '#00A9E0',
      properties: [
        { name: 'ciId', type: 'string', isIdentifier: true },
      ],
    },
    {
      id: 'problem',
      name: 'Problem',
      description: 'Known error or root cause for recurring incidents.',
      icon: '⚡',
      color: '#FFB900',
      properties: [
        { name: 'problemId', type: 'string', isIdentifier: true },
        { name: 'title', type: 'string' },
      ],
    },
  ],
  relationships: [
    {
      id: 'service_supported_by_configuration_item',
      name: 'is supported by',
      from: 'service',
      to: 'configurationitem',
      cardinality: 'one-to-many',
      description: 'Service is supported by Configuration Item',
    },
  ],
};

describe('processQuery', () => {
  it('answers definition-style entity questions in English', () => {
    const response = processQuery('What is a Problem?', testOntology);

    expect(response.highlightEntities).toEqual(['problem']);
    expect(response.result).toContain('**Problem**');
    expect(response.result).toContain('Known error or root cause for recurring incidents.');
  });

  it('answers definition-style entity questions in Chinese', () => {
    const response = processQuery('什么是 Problem？', testOntology);

    expect(response.highlightEntities).toEqual(['problem']);
    expect(response.result).toContain('**Problem**');
  });

  it('answers relationship queries (Service ↔ ConfigurationItem)', () => {
    const response = processQuery('Service 如何关联到 ConfigurationItem？', testOntology);

    expect(response.highlightEntities).toEqual(
      expect.arrayContaining(['service', 'configurationitem']),
    );
    expect(response.highlightRelationships).toEqual(['service_supported_by_configuration_item']);
  });

  it('falls back gracefully when nothing matches', () => {
    const response = processQuery('Completely unknown question', testOntology);

    expect(response.highlightEntities).toEqual([]);
    expect(response.highlightRelationships).toEqual([]);
    expect(response.result).toContain('Incident Management Ontology');
    // Should never produce duplicated "Ontology" wording
    expect(response.result).not.toContain('Ontology** ontology');
  });

  it('returns a non-empty suggestions list', () => {
    const suggestions = generateQuerySuggestions(testOntology);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((s) => expect(typeof s).toBe('string'));
  });
});

describe('Chinese alias matching (Fourth Coffee)', () => {
  it('highlights Customer for 客户 / 会员 / 顾客', () => {
    expect(processQuery('什么是 客户？', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['customer']),
    );
    expect(processQuery('什么是 会员？', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['customer']),
    );
    expect(processQuery('查询 顾客', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['customer']),
    );
  });

  it('highlights Order for 订单 / 购物 / 交易', () => {
    expect(processQuery('什么是 订单？', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['order']),
    );
    expect(processQuery('最近的 购物', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['order']),
    );
  });

  it('highlights Product for 商品 / 产品 / 咖啡 / 饮品', () => {
    expect(processQuery('所有 商品', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['product']),
    );
    expect(processQuery('门店里的 咖啡', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['product', 'store']),
    );
  });

  it('highlights Store for 门店 / 店铺 / 咖啡馆', () => {
    expect(processQuery('查询 门店', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['store']),
    );
    expect(processQuery('有哪些 咖啡馆', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['store']),
    );
  });

  it('highlights Shipment for 货运 / 物流', () => {
    expect(processQuery('查询 货运', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['shipment']),
    );
    expect(processQuery('物流 状态', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['shipment']),
    );
  });

  it('highlights Supplier for 供应商 / 供货商', () => {
    expect(processQuery('查询 供应商', cosmicCoffeeOntology).highlightEntities).toEqual(
      expect.arrayContaining(['supplier']),
    );
  });
});

describe('tokenize', () => {
  it('returns English words (filtered by stopwords)', () => {
    // 'what' / 'is' / 'a' 是停用词，应被过滤；只留下 'customer'
    expect(tokenize('What is a Customer?').sort()).toEqual(['customer']);
  });

  it('emits both unigrams and bigrams for Chinese', () => {
    const toks = tokenize('铂金会员订单');
    expect(toks).toContain('铂');
    expect(toks).toContain('铂金');
    expect(toks).toContain('会员');
    expect(toks).toContain('订单');
  });

  it('filters common stopwords', () => {
    const toks = tokenize('what is a customer');
    expect(toks).not.toContain('is');
    expect(toks).not.toContain('a');
    expect(toks).not.toContain('what');
  });
});

describe('selectRelevantRows', () => {
  const orders = [
    { order_id: 'ORD-1', customer_id: 'CUST-1', status: 'Completed', total: 12.5 },
    { order_id: 'ORD-2', customer_id: 'CUST-2', status: 'Pending', total: 7.0 },
    { order_id: 'ORD-3', customer_id: 'CUST-3', status: 'In Transit', total: 9.5 },
    { order_id: 'ORD-4', customer_id: 'CUST-1', status: 'Completed', total: 15.0 },
    { order_id: 'ORD-5', customer_id: 'CUST-2', status: 'Delayed', total: 18.0 },
  ];
  const mappings = { order_id: 'orderId', customer_id: 'customerId', status: 'status', total: 'total' };

  it('ranks rows whose cell values match query tokens higher', () => {
    const picked = selectRelevantRows(orders, 'In Transit shipment', mappings, 3);
    expect(picked.map((r) => r.order_id)).toContain('ORD-3');
    expect(picked.length).toBeLessThanOrEqual(3);
  });

  it('列名命中时该列的所有行都算命中（打分 +3 / token）', () => {
    const picked = selectRelevantRows(orders, 'orderId', mappings, 3);
    // 每行都能通过映射列 order_id → orderId 命中，取满 topN
    expect(picked.length).toBe(3);
  });

  it('【无下限】完全无命中时返回 0 行，不做兜底补齐', () => {
    const picked = selectRelevantRows(orders, 'xyzzy no match', mappings, 3);
    expect(picked).toEqual([]);
  });

  it('【无下限】只命中 1 行时只返回 1 行，不再补足到 N 行', () => {
    const picked = selectRelevantRows(orders, 'Delayed', mappings, 10);
    expect(picked.length).toBe(1);
    expect(picked[0].order_id).toBe('ORD-5');
  });

  it('topN 仍然作为上限生效', () => {
    const picked = selectRelevantRows(orders, 'Completed', mappings, 2);
    expect(picked.length).toBe(2);
    expect(picked.map((r) => r.order_id)).toEqual(['ORD-1', 'ORD-4']);
  });

  it('空问题无法判断相关性 → 返回 0 行', () => {
    expect(selectRelevantRows(orders, '', mappings, 2)).toEqual([]);
  });

  it('全是停用词的问题 → 返回 0 行', () => {
    expect(selectRelevantRows(orders, '什么是 的', mappings, 2)).toEqual([]);
  });

  it('返回空数组当 rows 为空或 topN <= 0', () => {
    expect(selectRelevantRows([], 'anything', mappings, 5)).toEqual([]);
    expect(selectRelevantRows(orders, 'Completed', mappings, 0)).toEqual([]);
  });

  it('matches Chinese tokens against Chinese cell values', () => {
    const chinese = [
      { name: '金星店', city: '上海' },
      { name: '火星店', city: '北京' },
      { name: '金星二号店', city: '广州' },
    ];
    const picked = selectRelevantRows(chinese, '金星店', undefined, 2);
    expect(picked[0].name).toBe('金星店');
    expect(picked.length).toBe(2);
  });

  it('跨语言桥：中文提问能召回英文数据行', () => {
    const picked = selectRelevantRows(orders, '延迟的订单', mappings, 3);
    // '延迟' → delayed 命中 ORD-5；'订单' → order 命中 order_id 列（全行并列 +3）
    expect(picked[0].order_id).toBe('ORD-5');
  });

  it('跨语言桥：货运状态词也能召回，且精确命中的行排最前', () => {
    const shipments = [
      { shipment_id: 'SHIP-1', status: 'Delivered' },
      { shipment_id: 'SHIP-2', status: 'In Transit' },
      { shipment_id: 'SHIP-3', status: 'Delayed' },
    ];
    const picked = selectRelevantRows(shipments, '哪些货运延误了', undefined, 5);
    // '货运' → shipment 命中 shipment_id 列（该表全部行 +3）；'延误' → delayed 命中 SHIP-3（再 +1）
    expect(picked[0].shipment_id).toBe('SHIP-3');
    expect(picked.length).toBe(3);
  });

  it('跨语言桥：完全不相关的提问仍然 0 行', () => {
    const shipments = [
      { shipment_id: 'SHIP-1', status: 'Delivered' },
      { shipment_id: 'SHIP-2', status: 'In Transit' },
    ];
    expect(selectRelevantRows(shipments, '今天天气怎么样', undefined, 5)).toEqual([]);
  });
});

describe('expandCrossLingualTokens', () => {
  it('把问题中出现的中文术语补上英文别名', () => {
    const toks = expandCrossLingualTokens('延迟的货运', tokenize('延迟的货运'));
    expect(toks).toContain('delayed');
    expect(toks).toContain('shipment');
  });

  it('多词别名会拆成单词，便于与列值部分匹配', () => {
    const toks = expandCrossLingualTokens('礼品卡支付的订单', tokenize('礼品卡支付的订单'));
    expect(toks).toContain('gift');
    expect(toks).toContain('card');
  });

  it('问题里没出现的术语不会被注入', () => {
    const toks = expandCrossLingualTokens('有哪些订单', tokenize('有哪些订单'));
    expect(toks).not.toContain('delayed');
    expect(toks).not.toContain('platinum');
  });

  it('保留原有 token，只做加法', () => {
    const base = tokenize('铂金会员');
    const toks = expandCrossLingualTokens('铂金会员', base);
    for (const t of base) expect(toks).toContain(t);
    expect(toks).toContain('platinum');
  });
});