import { beforeEach, describe, expect, it } from 'vitest';
import {
  countReuploadEndpoints,
  listUserOntologies,
  removeUserOntology,
  saveUserOntology,
  toRuntimeEndpoints,
} from './userOntologyLibrary';
import type { Ontology } from '../data/ontology';
import type { DataEndpoint } from '../store/appStore';

const makeOntology = (name: string): Ontology => ({
  name,
  description: `${name} 的描述`,
  entityTypes: [
    {
      id: 'e1',
      name: '实体一',
      description: '',
      icon: '📦',
      color: '#0078D4',
      properties: [{ name: 'id', type: 'string', isIdentifier: true }],
    },
  ],
  relationships: [],
});

const KEY = 'ontology-platform.user-ontology-library';

beforeEach(() => {
  window.localStorage.clear();
});

describe('userOntologyLibrary — 本体库本地保存区', () => {
  it('初始为空列表', () => {
    expect(listUserOntologies()).toEqual([]);
  });

  it('保存后可列出，条目带 local 来源与作者「我」', () => {
    const { entries } = saveUserOntology(makeOntology('汽车网关本体'), []);

    expect(entries).toHaveLength(1);
    expect(listUserOntologies()).toHaveLength(1);
    const entry = listUserOntologies()[0];
    expect(entry.name).toBe('汽车网关本体');
    expect(entry.source).toBe('local');
    expect(entry.author).toBe('我');
    expect(entry.id).toMatch(/^local\//);
    expect(entry.ontology.entityTypes).toHaveLength(1);
  });

  it('同名覆盖：再次保存同名本体不产生重复条目，且保留原 id', () => {
    const first = saveUserOntology(makeOntology('同一份本体'), []);
    const firstId = first.entry.id;

    const updated = makeOntology('同一份本体');
    updated.entityTypes = [...updated.entityTypes, ...updated.entityTypes];
    const second = saveUserOntology(updated, []);

    expect(listUserOntologies()).toHaveLength(1);
    expect(second.entry.id).toBe(firstId);
    expect(second.entry.ontology.entityTypes).toHaveLength(2);
  });

  it('不同名各占一条，列表按保存时间倒序', () => {
    saveUserOntology(makeOntology('本体A'), []);
    saveUserOntology(makeOntology('本体B'), []);

    const entries = listUserOntologies();
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('本体B');
    expect(entries[1].name).toBe('本体A');
  });

  it('removeUserOntology 按 id 删除，其余保留', () => {
    const { entry } = saveUserOntology(makeOntology('待删除'), []);
    saveUserOntology(makeOntology('保留'), []);

    const rest = removeUserOntology(entry.id);
    expect(rest.map((e) => e.name)).toEqual(['保留']);
  });

  it('数据真实落在 localStorage，刷新（重新读取）后仍在', () => {
    saveUserOntology(makeOntology('持久化检查'), []);

    const raw = window.localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toHaveLength(1);
    expect(listUserOntologies()[0].name).toBe('持久化检查');
  });

  it('localStorage 里的坏数据不会让读取崩溃', () => {
    window.localStorage.setItem(KEY, '{ not json');
    expect(listUserOntologies()).toEqual([]);

    window.localStorage.setItem(KEY, JSON.stringify([42, { name: 'x' }, null]));
    expect(listUserOntologies()).toEqual([]);
  });
});

describe('userOntologyLibrary — 数据源随本体一起存入本体库', () => {
  const restEndpoint: DataEndpoint = {
    id: 'ep_1',
    kind: 'rest',
    name: '客户接口',
    url: 'https://api.example.com/customers',
    entityTypeId: 'customer',
    columnMappings: { customer_id: 'customerId', full_name: 'name' },
    lastFetchStatus: 'ok',
    lastFetchedAt: 1_700_000_000_000,
    lastError: '上次的临时错误',
  };

  const localFileEndpoint: DataEndpoint = {
    id: 'ep_2',
    kind: 'json-file',
    name: '本地订单文件',
    url: 'local://orders.json',
    localRows: [{ orderId: 'A-1' }, { orderId: 'A-2' }],
    localFileName: 'orders.json',
  };

  it('保存后可在条目上读回数据源', () => {
    const { entry } = saveUserOntology(makeOntology('带数据源的本体'), [], [restEndpoint]);

    expect(entry.endpoints).toHaveLength(1);
    const stored = listUserOntologies()[0].endpoints![0];
    expect(stored.name).toBe('客户接口');
    expect(stored.columnMappings).toEqual({ customer_id: 'customerId', full_name: 'name' });
    expect(stored.entityTypeId).toBe('customer');
  });

  it('剥离运行时抓取状态（成功/失败/时间戳），只留配置', () => {
    saveUserOntology(makeOntology('剥离状态'), [], [restEndpoint]);
    const stored = listUserOntologies()[0].endpoints![0];

    expect(stored.lastFetchStatus).toBeUndefined();
    expect(stored.lastFetchedAt).toBeUndefined();
    expect(stored.lastError).toBeUndefined();
  });

  it('本地 JSON 文件的行数据不入库，只留 needReupload 标记与文件名', () => {
    saveUserOntology(makeOntology('本地文件'), [], [localFileEndpoint]);
    const stored = listUserOntologies()[0].endpoints![0];

    expect(stored.localRows).toBeUndefined();
    expect(stored.localFileName).toBe('orders.json');
    expect(stored.needsFileReupload).toBe(true);
    expect(countReuploadEndpoints(listUserOntologies()[0].endpoints)).toBe(1);
  });

  it('toRuntimeEndpoints 恢复为可用的运行时形态（状态重置为 idle）', () => {
    const runtime = toRuntimeEndpoints([{ ...localFileEndpoint, needsFileReupload: true }]);

    expect(runtime).toHaveLength(1);
    expect(runtime[0].lastFetchStatus).toBe('idle');
    expect(runtime[0].lastError).toBeUndefined();
    expect(runtime[0].needsFileReupload).toBe(true);
  });

  it('不传 endpoints 时保留已存的数据源（先存本体、后补数据源不会互相覆盖）', () => {
    const { entry } = saveUserOntology(makeOntology('同一份本体'), [], [restEndpoint]);
    expect(entry.endpoints).toHaveLength(1);

    // 从「导入 / 导出本体」再次保存同名本体（不带数据源参数）
    saveUserOntology(makeOntology('同一份本体'), []);

    const stored = listUserOntologies()[0];
    expect(listUserOntologies()).toHaveLength(1);
    expect(stored.endpoints).toHaveLength(1);
    expect(stored.endpoints![0].name).toBe('客户接口');
  });

  it('显式传空数组会真的清空数据源（删掉数据源后再存要生效）', () => {
    saveUserOntology(makeOntology('要清空的'), [], [restEndpoint]);
    saveUserOntology(makeOntology('要清空的'), [], []);

    expect(listUserOntologies()[0].endpoints).toEqual([]);
  });

  it('只存本体（不传 endpoints）时条目不带 endpoints，加载时就不会误清空现有数据源', () => {
    const { entry } = saveUserOntology(makeOntology('只有本体'), []);

    expect(entry.endpoints).toBeUndefined();
    expect(listUserOntologies()[0].endpoints).toBeUndefined();
  });

  it('同名覆盖保留原 id，数据源随之更新', () => {
    const first = saveUserOntology(makeOntology('同一份本体'), [], [restEndpoint]);
    const second = saveUserOntology(makeOntology('同一份本体'), [], [restEndpoint, localFileEndpoint]);

    expect(second.entry.id).toBe(first.entry.id);
    expect(listUserOntologies()).toHaveLength(1);
    expect(listUserOntologies()[0].endpoints).toHaveLength(2);
  });
});
