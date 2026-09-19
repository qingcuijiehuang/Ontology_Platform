import { describe, it, expect } from 'vitest';
import {
  MAX_IMPORT_ROWS,
  assignBucketEntities,
  autoMapColumns,
  collectColumns,
  fileNameToEndpointName,
  guessEntityType,
  matchEntityByBucketName,
  normalizeKey,
  parseImportFile,
  parseJsonForImport,
} from './jsonAutoImport';
import { cosmicCoffeeOntology, type Ontology } from '../data/ontology';

const ORDER = cosmicCoffeeOntology.entityTypes.find((e) => e.id === 'order')!;

describe('normalizeKey — 列名归一化', () => {
  it('把 snake_case / camelCase / 空格 / 连字符 收敛到同一种写法', () => {
    const expected = 'customerid';
    expect(normalizeKey('customer_id')).toBe(expected);
    expect(normalizeKey('customerId')).toBe(expected);
    expect(normalizeKey('Customer ID')).toBe(expected);
    expect(normalizeKey('customer-id')).toBe(expected);
    expect(normalizeKey('CUSTOMER.ID')).toBe(expected);
  });
});

describe('collectColumns — 列名收集', () => {
  it('按出现频次降序，同频次保持首次出现顺序', () => {
    const rows = [
      { a: 1, b: 2 },
      { b: 3, c: 4 },
      { b: 5, a: 6 },
    ];
    // b 出现 3 次；a 2 次；c 1 次
    expect(collectColumns(rows)).toEqual(['b', 'a', 'c']);
  });

  it('列数超过上限时截断', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 80; i += 1) wide[`col_${i}`] = i;
    expect(collectColumns([wide], 10)).toHaveLength(10);
  });
});

describe('guessEntityType — 实体识别', () => {
  it('订单表头识别为 order', () => {
    const guess = guessEntityType(
      ['order_id', 'order_timestamp', 'order_total', 'order_status', 'payment_type'],
      cosmicCoffeeOntology.entityTypes,
    );
    expect(guess?.entityTypeId).toBe('order');
  });

  it('客户表头识别为 customer', () => {
    const guess = guessEntityType(
      ['customer_id', 'full_name', 'email_address', 'loyalty_status', 'registration_date'],
      cosmicCoffeeOntology.entityTypes,
    );
    expect(guess?.entityTypeId).toBe('customer');
  });

  it('完全不相关的表头不硬猜（返回 null）', () => {
    const guess = guessEntityType(['temperature', 'humidity', 'wind_speed'], cosmicCoffeeOntology.entityTypes);
    expect(guess).toBeNull();
  });

  it('只命中一列也达不到门槛', () => {
    const guess = guessEntityType(['customer_id'], cosmicCoffeeOntology.entityTypes);
    expect(guess).toBeNull();
  });
});

describe('autoMapColumns — 列映射', () => {
  it('snake_case 列名映射到 camelCase 属性', () => {
    const mappings = autoMapColumns(['order_id', 'order_total', 'order_status'], ORDER);
    expect(mappings).toEqual({
      order_id: 'orderId',
      order_total: 'total',
      order_status: 'status',
    });
  });

  it('一个属性不会被两列同时占用', () => {
    const mappings = autoMapColumns(['order_id', 'orderId', 'order_total'], ORDER);
    const targets = Object.values(mappings);
    expect(new Set(targets).size).toBe(targets.length);
    // 先到先得：得分相同时按列的出现顺序分配
    expect(mappings.order_id).toBe('orderId');
    expect(mappings.orderId).toBeUndefined();
  });

  it('传 undefined 实体时返回空映射', () => {
    expect(autoMapColumns(['order_id'], undefined)).toEqual({});
  });
});

describe('parseJsonForImport — 端到端解析', () => {
  it('对象数组：解析出行、列、实体与映射', () => {
    const text = JSON.stringify([
      { order_id: 'SO-1', order_total: 12.5, order_status: 'Pending' },
      { order_id: 'SO-2', order_total: 30, order_status: 'Preparing' },
    ]);
    const result = parseJsonForImport(text, 'orders.json', cosmicCoffeeOntology);

    expect(result.rows).toHaveLength(2);
    expect(result.columns).toEqual(['order_id', 'order_total', 'order_status']);
    expect(result.entityTypeId).toBe('order');
    expect(result.columnMappings.order_id).toBe('orderId');
    expect(result.truncated).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('兼容 items / rows / results / data 包装', () => {
    const rows = [{ customer_id: 'C-1', full_name: 'Alice' }, { customer_id: 'C-2', full_name: 'Bob' }];
    for (const wrap of ['items', 'rows', 'results', 'data']) {
      const result = parseJsonForImport(JSON.stringify({ [wrap]: rows }), `${wrap}.json`, cosmicCoffeeOntology);
      expect(result.rows).toHaveLength(2);
      expect(result.entityTypeId).toBe('customer');
    }
  });

  it('兼容 GraphQL 风格的 data → 数组字段', () => {
    const text = JSON.stringify({ data: { orders: [{ order_id: 'SO-9', order_total: 1 }] } });
    const result = parseJsonForImport(text, 'gql.json', cosmicCoffeeOntology);
    expect(result.rows).toHaveLength(1);
    expect(result.entityTypeId).toBe('order');
  });

  it('单个对象也能作为一行接入', () => {
    const result = parseJsonForImport('{"order_id":"SO-1","order_total":9}', 'one.json', cosmicCoffeeOntology);
    expect(result.rows).toHaveLength(1);
    expect(result.entityTypeId).toBe('order');
  });

  it('SPARQL JSON 结果（results.bindings）也能解析', () => {
    const text = JSON.stringify({
      results: { bindings: [{ order_id: { value: 'SO-1' }, order_total: { value: '3' } }] },
    });
    const result = parseJsonForImport(text, 'sparql.json', cosmicCoffeeOntology);
    expect(result.rows).toHaveLength(1);
    expect(result.entityTypeId).toBe('order');
  });

  it('带 BOM 的文件也能解析', () => {
    const result = parseJsonForImport('\uFEFF[{"order_id":"SO-1","order_total":1}]', 'bom.json', cosmicCoffeeOntology);
    expect(result.rows).toHaveLength(1);
  });

  it('超过上限时截断并给出提示', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => ({ order_id: `SO-${i}`, order_total: i }));
    const result = parseJsonForImport(JSON.stringify(rows), 'big.json', cosmicCoffeeOntology);

    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.truncated).toBe(5);
    expect(result.warnings.join()).toContain(`已截取前 ${MAX_IMPORT_ROWS} 行`);
  });

  it('识别不出实体时不报错，只是 entityTypeId 为 null', () => {
    const result = parseJsonForImport('[{"foo":"a","bar":"b"}]', 'unknown.json', cosmicCoffeeOntology);
    expect(result.entityTypeId).toBeNull();
    expect(result.columnMappings).toEqual({});
  });
});

describe('parseJsonForImport — 错误提示', () => {
  const err = (text: string, name = 'bad.json') => {
    try {
      parseJsonForImport(text, name, cosmicCoffeeOntology);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  it('空文件', () => {
    expect(err('   ')).toContain('文件是空的');
  });

  it('不是 JSON 的文本给出可执行提示', () => {
    const message = err('id,name\n1,Alice');
    expect(message).toContain('不是合法的 JSON');
    expect(message).toContain('另存为 JSON');
  });

  it('JSON Lines 会被提示改成标准数组', () => {
    expect(err('{"a":1}\n{"a":2}')).toContain('标准数组');
  });

  it('空数组', () => {
    expect(err('[]')).toContain('没有解析出任何数据行');
  });

  it('全是空对象（没有字段）', () => {
    expect(err('[{},{},{}]')).toContain('没有任何字段');
  });
});

describe('fileNameToEndpointName', () => {
  it('去掉 .json 扩展名', () => {
    expect(fileNameToEndpointName('2026-09 订单明细.json')).toBe('2026-09 订单明细');
    expect(fileNameToEndpointName('orders.JSON')).toBe('orders');
  });

  it('没有扩展名时保持原样', () => {
    expect(fileNameToEndpointName('orders')).toBe('orders');
    // 只有 .json 结尾才剥离，`.json.bak` 不是可导入格式
    expect(fileNameToEndpointName('orders.json.bak')).toBe('orders.json.bak');
  });
});

// ── 多实体分桶图 ────────────────────────────────────────────────────────────

/** 含 Requirement / SubRequirement / TestCase 的最小本体，用来验证桶名匹配。 */
const AUTO_ONTOLOGY: Ontology = {
  name: 'Automotive Embedded',
  description: '测试用本体',
  entityTypes: [
    {
      id: 'requirement',
      name: 'Requirement',
      description: '',
      icon: 'FileText',
      color: '#0078D4',
      properties: [
        { name: 'requirement_id', type: 'string', isIdentifier: true },
        { name: 'title', type: 'string' },
        { name: 'status', type: 'string' },
      ],
    },
    {
      id: 'sub_requirement',
      name: 'SubRequirement',
      description: '',
      icon: 'FileText',
      color: '#5C2D91',
      properties: [
        { name: 'sub_requirement_id', type: 'string', isIdentifier: true },
        { name: 'parent_id', type: 'string' },
      ],
    },
    {
      id: 'test_case',
      name: 'TestCase',
      description: '',
      icon: 'CheckSquare',
      color: '#107C10',
      properties: [
        { name: 'test_case_id', type: 'string', isIdentifier: true },
        { name: 'name', type: 'string' },
        { name: 'status', type: 'string' },
      ],
    },
  ],
  relationships: [],
};

/** 一份典型的分桶图文件：两个实体桶 + 一条关系三元组。 */
const GRAPH_PAYLOAD = {
  metadata: { domain: 'Automotive Embedded Software', scenario: 'Central Gateway ECU (CGW)' },
  objects: {
    Requirement: [
      { requirement_id: 'REQ-1', title: '报文路由', status: 'approved' },
      { requirement_id: 'REQ-2', title: '诊断会话', status: 'draft' },
    ],
    Sub_Requirement: [{ sub_requirement_id: 'SUB-1', parent_id: 'REQ-1' }],
  },
  relationships: [
    {
      from_type: 'Sub_Requirement',
      from_id: 'SUB-1',
      relation: 'refines',
      to_type: 'Requirement',
      to_id: 'REQ-1',
    },
  ],
};

describe('matchEntityByBucketName — 桶名匹配实体', () => {
  it('完全同名（忽略 snake_case / 大小写差异）命中', () => {
    expect(matchEntityByBucketName('TestCase', AUTO_ONTOLOGY.entityTypes)?.entityTypeId).toBe('test_case');
    expect(matchEntityByBucketName('test_case', AUTO_ONTOLOGY.entityTypes)?.entityTypeId).toBe('test_case');
  });

  it('桶名比实体名长时按包含关系命中', () => {
    expect(matchEntityByBucketName('Requirement_Document', AUTO_ONTOLOGY.entityTypes)?.entityTypeId)
      .toBe('requirement');
  });

  it('精确同名优先于包含关系', () => {
    // Sub_Requirement 与 SubRequirement 精确相等，不该被 Requirement 的包含关系抢走
    expect(matchEntityByBucketName('Sub_Requirement', AUTO_ONTOLOGY.entityTypes)?.entityTypeId)
      .toBe('sub_requirement');
  });

  it('完全对不上的桶名返回 null', () => {
    expect(matchEntityByBucketName('Coverage_Report', AUTO_ONTOLOGY.entityTypes)).toBeNull();
  });
});

describe('assignBucketEntities — 桶到实体的分配', () => {
  it('同一实体不会被两个桶重复占用（高分桶优先）', () => {
    const assigned = assignBucketEntities(
      [
        { name: 'Final_Test_Case', columns: [] },
        { name: 'Test_Case', columns: [] },
      ],
      AUTO_ONTOLOGY.entityTypes,
    );
    // 即便 Final_Test_Case 排在前面，精确同名的 Test_Case 仍然优先拿到实体
    expect(assigned[1].entityTypeId).toBe('test_case');
    expect(assigned[1].entitySource).toBe('bucket');
    expect(assigned[0].entityTypeId).toBeNull();
  });

  it('桶名像实体名却匹配不上本体时，不再用列名硬猜别的实体', () => {
    // 若退回列名猜测，status / name 会让它误配成 TestCase
    const [assigned] = assignBucketEntities(
      [{ name: 'Test_Execution', columns: ['execution_id', 'status', 'name'] }],
      AUTO_ONTOLOGY.entityTypes,
    );
    expect(assigned.entityTypeId).toBeNull();
    expect(assigned.entitySource).toBeNull();
  });

  it('通用容器名（rows）仍然允许按列名猜测', () => {
    const [assigned] = assignBucketEntities(
      [{ name: 'rows', columns: ['requirement_id', 'title', 'status'] }],
      AUTO_ONTOLOGY.entityTypes,
    );
    expect(assigned.entityTypeId).toBe('requirement');
    expect(assigned.entitySource).toBe('columns');
  });
});

describe('parseImportFile — 多实体分桶图', () => {
  it('按桶展开行 / 列 / 实体 / 列映射，并抽出关系表与 metadata', () => {
    const result = parseImportFile(JSON.stringify(GRAPH_PAYLOAD), 'automotive.json', AUTO_ONTOLOGY);

    expect(result.kind).toBe('graph');
    if (result.kind !== 'graph') return;

    expect(result.containerKey).toBe('objects');
    expect(result.buckets.map((b) => b.name)).toEqual(['Requirement', 'Sub_Requirement']);
    expect(result.totalRows).toBe(3);
    expect(result.buckets[0].entityTypeId).toBe('requirement');
    expect(result.buckets[0].columnMappings.requirement_id).toBe('requirement_id');
    expect(result.buckets[1].entityTypeId).toBe('sub_requirement');
    expect(result.relationshipKey).toBe('relationships');
    expect(result.relationshipRows).toHaveLength(1);
    expect(result.relationshipColumns).toEqual(['from_type', 'from_id', 'relation', 'to_type', 'to_id']);
    expect(result.metadata.scenario).toBe('Central Gateway ECU (CGW)');
    expect(result.warnings).toEqual([]);
  });

  it('当前本体里没有对应实体时，桶依然保留、只是不映射', () => {
    const result = parseImportFile(JSON.stringify(GRAPH_PAYLOAD), 'automotive.json', cosmicCoffeeOntology);
    expect(result.kind).toBe('graph');
    if (result.kind !== 'graph') return;

    expect(result.buckets).toHaveLength(2);
    expect(result.buckets.every((b) => b.entityTypeId === null)).toBe(true);
    expect(result.totalRows).toBe(3);
  });

  it('桶里只有标量时跳过该桶并给出提示', () => {
    const text = JSON.stringify({
      objects: {
        tags: ['a', 'b'],
        Requirement: [{ requirement_id: 'REQ-1', title: 'x', status: 's' }],
      },
    });
    const result = parseImportFile(text, 'mixed.json', AUTO_ONTOLOGY);
    expect(result.kind).toBe('graph');
    if (result.kind !== 'graph') return;

    expect(result.buckets.map((b) => b.name)).toEqual(['Requirement']);
    expect(result.warnings.join()).toContain('tags');
  });

  it('单个桶也算分桶图（不必凑够两个）', () => {
    const result = parseImportFile(
      JSON.stringify({ objects: { Requirement: [{ requirement_id: 'REQ-1' }] } }),
      'one-bucket.json',
      AUTO_ONTOLOGY,
    );
    expect(result.kind).toBe('graph');
  });

  it('桶内行数超上限时逐桶截断', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 2 }, (_, i) => ({ requirement_id: `REQ-${i}` }));
    const result = parseImportFile(JSON.stringify({ objects: { Requirement: rows } }), 'big.json', AUTO_ONTOLOGY);

    expect(result.kind).toBe('graph');
    if (result.kind !== 'graph') return;
    expect(result.buckets[0].rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.buckets[0].truncated).toBe(2);
    expect(result.warnings.join()).toContain(`已截取前 ${MAX_IMPORT_ROWS} 行`);
  });

  it('{ data: { 某字段: [...] } } 不会被误判成分桶图', () => {
    const text = JSON.stringify({ data: { orders: [{ order_id: 'SO-1', order_total: 1 }] } });
    expect(parseImportFile(text, 'gql.json', cosmicCoffeeOntology).kind).toBe('flat');
  });

  it('objects 是数组时不算分桶图，退回普通对象解析', () => {
    const text = JSON.stringify({ objects: [{ order_id: 'SO-1', order_total: 3 }] });
    const result = parseImportFile(text, 'weird.json', cosmicCoffeeOntology);
    expect(result.kind).toBe('flat');
    if (result.kind !== 'flat') return;
    expect(result.rows).toHaveLength(1);
  });

  it('扁平行专用入口遇到分桶图会提示改用分桶导入', () => {
    expect(() => parseJsonForImport(JSON.stringify(GRAPH_PAYLOAD), 'automotive.json', AUTO_ONTOLOGY))
      .toThrow(/多实体分桶/);
  });
});
