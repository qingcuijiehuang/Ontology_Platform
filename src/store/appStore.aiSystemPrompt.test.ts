import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 系统提示词持久化的回归锁：
// - 默认（无存储 / 脏值）为空字符串 = 使用内置默认提示词；
// - setAiSystemPrompt 写入 localStorage（JSON 字符串），刷新后仍生效；
// - 超长内容截断到上限，防止把请求上下文撑爆。

async function loadStore() {
  vi.resetModules();
  return await import('./appStore');
}

const STORAGE_KEY = 'ontology-platform.ai-system-prompt';

describe('智能问答系统提示词（aiSystemPrompt）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('默认值为空字符串（= 使用内置默认提示词）', async () => {
    const { useAppStore } = await loadStore();
    expect(useAppStore.getState().aiSystemPrompt).toBe('');
  });

  it('setAiSystemPrompt 写入内存并持久化到 localStorage', async () => {
    const { useAppStore } = await loadStore();
    useAppStore.getState().setAiSystemPrompt('你是一名数据审计员。');
    expect(useAppStore.getState().aiSystemPrompt).toBe('你是一名数据审计员。');

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toBe('你是一名数据审计员。');
  });

  it('重新加载后从 localStorage 恢复', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify('自定义提示词'));
    const { useAppStore } = await loadStore();
    expect(useAppStore.getState().aiSystemPrompt).toBe('自定义提示词');
  });

  it('存储脏值（非字符串 JSON）安全回落为空', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{"oops": 1}');
    const { useAppStore } = await loadStore();
    expect(useAppStore.getState().aiSystemPrompt).toBe('');
  });

  it('超长提示词截断到上限', async () => {
    const { useAppStore, AI_SYSTEM_PROMPT_MAX_LENGTH } = await loadStore();
    const longPrompt = '测'.repeat(AI_SYSTEM_PROMPT_MAX_LENGTH + 500);
    useAppStore.getState().setAiSystemPrompt(longPrompt);
    expect(useAppStore.getState().aiSystemPrompt.length).toBe(AI_SYSTEM_PROMPT_MAX_LENGTH);
  });

  it('传空字符串即恢复默认提示词', async () => {
    const { useAppStore } = await loadStore();
    useAppStore.getState().setAiSystemPrompt('自定义');
    useAppStore.getState().setAiSystemPrompt('');
    expect(useAppStore.getState().aiSystemPrompt).toBe('');
  });
});
