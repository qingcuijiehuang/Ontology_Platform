import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, buildDefaultEndpoints } from './appStore';

describe('endpoints in the app store（平台不内置任何数据集）', () => {
  beforeEach(() => {
    useAppStore.getState().resetEndpoints();
  });

  it('首次加载不接入任何数据源', () => {
    const { endpoints } = useAppStore.getState();
    expect(endpoints).toHaveLength(0);
  });

  it('buildDefaultEndpoints 恒为空数组，且每次调用结果一致', () => {
    expect(buildDefaultEndpoints()).toEqual([]);
    expect(buildDefaultEndpoints()).toEqual(buildDefaultEndpoints());
  });

  it('addEndpoint 追加用户手动接入的数据源', () => {
    const id = useAppStore.getState().addEndpoint({
      kind: 'json-file',
      name: '我的数据',
      url: 'https://example.com/data.json',
    });
    expect(id).toBeTruthy();

    const endpoints = useAppStore.getState().endpoints;
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].kind).toBe('json-file');
    expect(endpoints[0].name).toBe('我的数据');
  });

  it('resetEndpoints 清空全部数据源，回到空白初始状态', () => {
    useAppStore.getState().addEndpoint({ kind: 'rest', name: '临时接口', url: 'https://example.com/api' });
    useAppStore.getState().addEndpoint({ kind: 'sparql', name: '临时仓库', url: 'https://example.com/sparql' });
    expect(useAppStore.getState().endpoints).toHaveLength(2);

    useAppStore.getState().resetEndpoints();
    expect(useAppStore.getState().endpoints).toHaveLength(0);
  });

  it('removeEndpoint 按 id 精确删除', () => {
    const keep = useAppStore.getState().addEndpoint({ kind: 'rest', name: '保留', url: 'https://a.example.com' });
    const drop = useAppStore.getState().addEndpoint({ kind: 'rest', name: '删除', url: 'https://b.example.com' });

    useAppStore.getState().removeEndpoint(drop);

    const ids = useAppStore.getState().endpoints.map((e) => e.id);
    expect(ids).toEqual([keep]);
  });
});
