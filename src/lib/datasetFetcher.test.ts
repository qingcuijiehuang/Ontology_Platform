import { describe, expect, it } from 'vitest';
import {
  buildFetchUrl,
  buildSparqlSelect,
  fetchEndpointRows,
  formatCell,
  isLocalEndpoint,
  localSourceLabel,
  pickRows,
} from './datasetFetcher';
import { cosmicCoffeeOntology } from '../data/ontology';
import type { DataEndpoint } from '../store/appStore';

const makeEndpoint = (patch: Partial<DataEndpoint>): DataEndpoint => ({
  id: 'ep_test',
  kind: 'rest',
  name: '测试数据源',
  url: 'https://example.com/data.json',
  ...patch,
});

describe('pickRows', () => {
  it('直接返回数组行', () => {
    expect(pickRows([{ a: 1 }, { a: 2 }])).toHaveLength(2);
  });

  it('解析 SPARQL JSON bindings', () => {
    const payload = { results: { bindings: [{ s: { value: 'x' } }] } };
    expect(pickRows(payload)).toEqual([{ s: { value: 'x' } }]);
  });

  it('解析 GraphQL data 包装', () => {
    const payload = { data: { countries: [{ code: 'CN' }] } };
    expect(pickRows(payload)).toEqual([{ code: 'CN' }]);
  });

  it('解析 REST 常见的 data 数组包装', () => {
    expect(pickRows({ data: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
  });

  it('解析 items / rows 包装', () => {
    expect(pickRows({ items: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(pickRows({ rows: [{ b: 2 }] })).toEqual([{ b: 2 }]);
  });

  it('遵守行数上限', () => {
    expect(pickRows(Array.from({ length: 100 }, (_, i) => ({ i })), 5)).toHaveLength(5);
  });

  it('非对象输入返回空数组', () => {
    expect(pickRows('text')).toEqual([]);
    expect(pickRows(null)).toEqual([]);
  });
});

describe('formatCell', () => {
  it('处理空值与基本类型', () => {
    expect(formatCell(null)).toBe('—');
    expect(formatCell(undefined)).toBe('—');
    expect(formatCell(12)).toBe('12');
    expect(formatCell(true)).toBe('true');
    expect(formatCell('abc')).toBe('abc');
  });

  it('解包 SPARQL binding', () => {
    expect(formatCell({ value: 'Seattle', type: 'literal' })).toBe('Seattle');
  });
});

describe('buildFetchUrl', () => {
  it('REST 直接使用原地址', () => {
    const ep = makeEndpoint({ kind: 'rest', url: 'https://api.example.com/users' });
    expect(buildFetchUrl(ep, cosmicCoffeeOntology)).toBe('https://api.example.com/users');
  });

  it('SPARQL 注入预设查询与 format=json', () => {
    const ep = makeEndpoint({
      kind: 'sparql',
      url: 'https://query.wikidata.org/sparql',
      query: 'SELECT * WHERE { ?s ?p ?o } LIMIT 1',
    });
    const url = buildFetchUrl(ep, cosmicCoffeeOntology);
    expect(url.startsWith('https://query.wikidata.org/sparql?query=')).toBe(true);
    expect(url).toContain('format=json');
    expect(decodeURIComponent(url.split('query=')[1].split('&')[0])).toContain('SELECT *');
  });

  it('GraphQL 通过 ?query= 传递', () => {
    const ep = makeEndpoint({
      kind: 'graphql',
      url: 'https://countries.trevorblades.com/graphql',
      query: '{countries{code}}',
    });
    expect(buildFetchUrl(ep, cosmicCoffeeOntology)).toContain('?query=%7Bcountries%7Bcode%7D%7D');
  });

  it('SPARQL 未声明查询时使用兜底 SELECT', () => {
    const ep = makeEndpoint({ kind: 'sparql', url: 'https://dbpedia.org/sparql' });
    expect(buildFetchUrl(ep, cosmicCoffeeOntology)).toContain('SELECT');
    expect(buildSparqlSelect(cosmicCoffeeOntology)).toContain('LIMIT 30');
  });

  it('已带查询参数的地址不再重复拼接', () => {
    const ep = makeEndpoint({ kind: 'sparql', url: 'https://example.org/sparql?query=abc' });
    expect(buildFetchUrl(ep, cosmicCoffeeOntology)).toBe('https://example.org/sparql?query=abc');
  });
});

describe('fetchEndpointRows', () => {
  it('请求失败时返回 error 而不是抛出异常', async () => {
    const result = await fetchEndpointRows(
      makeEndpoint({ url: 'http://127.0.0.1:1/definitely-unreachable' }),
      cosmicCoffeeOntology,
      { timeoutMs: 1500 },
    );
    expect(result.rows).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('本地 JSON 文件的数据源不发网络请求，直接返回内存里的行', async () => {
    const rows = [{ order_id: 'SO-1' }, { order_id: 'SO-2' }, { order_id: 'SO-3' }];
    const ep = makeEndpoint({
      kind: 'json-file',
      // 故意给一个不可达地址：一旦真的发起请求，这个用例必然超时失败
      url: 'local://orders.json',
      localRows: rows,
      localFileName: 'orders.json',
    });

    const result = await fetchEndpointRows(ep, cosmicCoffeeOntology, { timeoutMs: 100 });

    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual(rows);
    expect(result.elapsedMs).toBe(0);
    expect(result.url).toBe('本地文件：orders.json');
  });

  it('本地数据源同样遵守 maxRows 上限', async () => {
    const ep = makeEndpoint({
      kind: 'json-file',
      url: 'local://big.json',
      localRows: Array.from({ length: 50 }, (_, i) => ({ i })),
      localFileName: 'big.json',
    });
    const result = await fetchEndpointRows(ep, cosmicCoffeeOntology, { maxRows: 5 });
    expect(result.rows).toHaveLength(5);
  });

  it('从本体库恢复、行数据未随库存放的本地文件源：不发请求，给出可执行的中文提示', async () => {
    // needsFileReupload 状态（localRows 已被剥离）
    const restored = await fetchEndpointRows(
      makeEndpoint({
        kind: 'json-file',
        url: 'local://orders.json',
        localFileName: 'orders.json',
        needsFileReupload: true,
      }),
      cosmicCoffeeOntology,
      { timeoutMs: 100 },
    );
    expect(restored.rows).toEqual([]);
    expect(restored.error).toContain('重新上传');

    // 退一步：即便没有标记，只要地址是 local:// 也不该真去 fetch
    const legacy = await fetchEndpointRows(
      makeEndpoint({ kind: 'json-file', url: 'local://legacy.json', localFileName: 'legacy.json' }),
      cosmicCoffeeOntology,
      { timeoutMs: 100 },
    );
    expect(legacy.rows).toEqual([]);
    expect(legacy.error).toContain('重新上传');
  });
});

describe('isLocalEndpoint / localSourceLabel', () => {
  it('只有带 localRows 的端点才算本地数据源', () => {
    expect(isLocalEndpoint(makeEndpoint({ localRows: [] }))).toBe(true);
    expect(isLocalEndpoint(makeEndpoint({}))).toBe(false);
    // 从本体库恢复、待重新上传文件的本地文件源也算本地数据源
    expect(isLocalEndpoint(makeEndpoint({ needsFileReupload: true }))).toBe(true);
  });

  it('展示文案优先用文件名，缺失时回落到数据源名称', () => {
    expect(localSourceLabel(makeEndpoint({ name: '订单', localFileName: 'orders.json' })))
      .toBe('本地文件：orders.json');
    expect(localSourceLabel(makeEndpoint({ name: '订单' }))).toBe('本地文件：订单');
  });
});
