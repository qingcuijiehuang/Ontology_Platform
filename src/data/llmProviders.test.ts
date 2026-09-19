import { describe, expect, it } from 'vitest';
import {
  allPresetModels,
  DEFAULT_LLM_CONFIG,
  DEFAULT_OUTPUT_TOKENS,
  describeLlm,
  findProvider,
  isLlmConfigured,
  LLM_PROVIDERS,
  maskApiKey,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  normalizeMaxTokens,
  normalizeTemperature,
  resolveChatEndpoint,
  sanitizeLlmConfig,
  withProxy,
  type LlmConfig,
} from './llmProviders';

const baseConfig: LlmConfig = {
  ...DEFAULT_LLM_CONFIG,
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-test-1234567890',
  model: 'deepseek-chat',
};

describe('LLM 厂商预设', () => {
  it('覆盖市面常用厂商且 id 唯一', () => {
    const ids = LLM_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 需求明确要求支持 gpt / deepseek / glm
    expect(ids).toContain('openai');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('zhipu');
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  it('每个预设都有名称、接口地址与模型（自定义项除外）', () => {
    for (const p of LLM_PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.vendor.length).toBeGreaterThan(0);
      if (p.id === 'custom') continue;
      expect(() => new URL(p.baseUrl)).not.toThrow();
      expect(p.baseUrl).toMatch(/chat\/completions$/);
      expect(p.defaultModel.length).toBeGreaterThan(0);
      expect(p.models).toContain(p.defaultModel);
    }
  });

  it('每个非 custom 厂商都有 featuredModels 且 default 在其中（保证 UI「推荐」组能选中默认）', () => {
    for (const p of LLM_PROVIDERS) {
      if (p.id === 'custom') continue;
      expect(p.featuredModels.length).toBeGreaterThan(0);
      expect(p.featuredModels).toContain(p.defaultModel);
    }
  });

  it('DeepSeek 主推 deepseek-v4-flash / deepseek-v4-pro（用户明确要求 2026-09 最新型号）', () => {
    const ds = findProvider('deepseek');
    expect(ds).toBeTruthy();
    expect(ds!.featuredModels).toContain('deepseek-v4-flash');
    expect(ds!.featuredModels).toContain('deepseek-v4-pro');
    // V4 系列不应再是 v3 的别名
    expect(ds!.featuredModels).not.toContain('deepseek-v3');
  });

  it('OpenAI 主推 gpt-5 系列', () => {
    const oai = findProvider('openai');
    expect(oai!.featuredModels).toContain('gpt-5');
    expect(oai!.featuredModels).toContain('gpt-5-mini');
    // 已经下线的 gpt-5-chat-latest 不能再放在推荐位
    expect(oai!.featuredModels).not.toContain('gpt-5-chat-latest');
  });

  it('智谱 GLM 同时包含 5 系列与 4.7', () => {
    const glm = findProvider('zhipu');
    expect(glm!.models).toContain('glm-5');
    expect(glm!.models).toContain('glm-4.7');
    expect(glm!.models).toContain('glm-4.7-flash');
  });

  it('每个云端厂商都已经标注 lastUpdated（用户看到时知道清单新鲜度）', () => {
    for (const p of LLM_PROVIDERS) {
      if (p.id === 'custom') continue;
      expect(p.lastUpdated).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('allPresetModels 包含 featuredModels + models，去重保序', () => {
    const ds = findProvider('deepseek')!;
    const merged = allPresetModels(ds);
    // 不重复
    expect(new Set(merged).size).toBe(merged.length);
    // featured 在前
    expect(merged.slice(0, ds.featuredModels.length)).toEqual([...ds.featuredModels]);
    // 包含了 models
    for (const m of ds.models) expect(merged).toContain(m);
  });

  it('默认配置指向一个真实存在的预设', () => {
    expect(findProvider(DEFAULT_LLM_CONFIG.providerId)).toBeTruthy();
    expect(DEFAULT_LLM_CONFIG.model.length).toBeGreaterThan(0);
  });

  it('本地 Ollama 不要求 API Key，云端厂商要求 Key', () => {
    expect(findProvider('ollama')?.requiresKey).toBe(false);
    expect(findProvider('openai')?.requiresKey).toBe(true);
    expect(findProvider('deepseek')?.requiresKey).toBe(true);
    expect(findProvider('zhipu')?.requiresKey).toBe(true);
  });

  it('所有预设地址均以 https 开头（除本地 Ollama / 自定义）', () => {
    for (const p of LLM_PROVIDERS) {
      if (p.id === 'ollama' || p.id === 'custom') continue;
      expect(p.baseUrl.startsWith('https://')).toBe(true);
    }
  });
});

describe('isLlmConfigured', () => {
  it('缺少 Key 时云端厂商视为未配置', () => {
    expect(isLlmConfigured({ ...baseConfig, apiKey: '' })).toBe(false);
    expect(isLlmConfigured({ ...baseConfig, apiKey: '   ' })).toBe(false);
  });

  it('配置完整时视为可用', () => {
    expect(isLlmConfigured(baseConfig)).toBe(true);
  });

  it('缺少接口地址或模型名时不可用', () => {
    expect(isLlmConfigured({ ...baseConfig, baseUrl: '' })).toBe(false);
    expect(isLlmConfigured({ ...baseConfig, model: '' })).toBe(false);
    expect(isLlmConfigured(null)).toBe(false);
  });

  it('本地 Ollama 允许无 Key', () => {
    const ollama = findProvider('ollama');
    expect(isLlmConfigured({
      ...baseConfig,
      providerId: 'ollama',
      baseUrl: ollama!.baseUrl,
      model: ollama!.defaultModel,
      apiKey: '',
    })).toBe(true);
  });
});

describe('maskApiKey', () => {
  it('保留首尾便于识别，中间打码', () => {
    const masked = maskApiKey('sk-abcdefghijklmn');
    expect(masked.startsWith('sk-ab')).toBe(true);
    expect(masked.endsWith('klmn')).toBe(true);
    expect(masked).toContain('****');
    expect(masked).not.toContain('cdefghij');
  });

  it('空 Key 返回空字符串', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('   ')).toBe('');
  });

  it('短 Key 也能安全掩码', () => {
    expect(maskApiKey('short')).toBe('sh****');
  });
});

describe('resolveChatEndpoint', () => {
  it('已含 /chat/completions 时原样返回', () => {
    expect(resolveChatEndpoint('https://api.openai.com/v1/chat/completions'))
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('以版本号结尾时补 /chat/completions', () => {
    expect(resolveChatEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(resolveChatEndpoint('https://open.bigmodel.cn/api/paas/v4'))
      .toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });

  it('仅填域名时补 /v1/chat/completions', () => {
    expect(resolveChatEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('容忍末尾斜杠与空格', () => {
    expect(resolveChatEndpoint('  https://api.moonshot.cn/v1/  ')).toBe('https://api.moonshot.cn/v1/chat/completions');
  });

  it('空地址返回空字符串', () => {
    expect(resolveChatEndpoint('')).toBe('');
  });
});

describe('withProxy', () => {
  it('拼接代理前缀', () => {
    expect(withProxy('https://api.openai.com/v1/chat/completions', 'http://localhost:8787'))
      .toBe('http://localhost:8787/https://api.openai.com/v1/chat/completions');
  });

  it('未配置代理时原样返回', () => {
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    expect(withProxy(endpoint, '')).toBe(endpoint);
    expect(withProxy(endpoint, undefined)).toBe(endpoint);
  });
});

describe('describeLlm', () => {
  it('输出厂商与模型', () => {
    expect(describeLlm(baseConfig)).toBe('DeepSeek · deepseek-chat');
  });

  it('未选择模型时明确提示', () => {
    expect(describeLlm({ ...baseConfig, model: '' })).toContain('未选择模型');
  });

  it('空配置返回未配置文案', () => {
    expect(describeLlm(null)).toBe('未配置模型');
  });
});

// 回归：「测试连接成功、提问却报 400 max_tokens 越界」。
// 根因是 max_tokens 来自 localStorage 却没做校验；这里锁死归一化行为。
describe('normalizeMaxTokens', () => {
  it('缺失值一律回落到兜底值（而不是被当成 0）', () => {
    expect(normalizeMaxTokens(undefined)).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens(null)).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens('')).toBe(DEFAULT_OUTPUT_TOKENS);
  });

  it('非有限数与非法字符串回落到兜底值', () => {
    expect(normalizeMaxTokens(NaN)).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens(Infinity)).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens('abc')).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens({})).toBe(DEFAULT_OUTPUT_TOKENS);
  });

  it('0 与负数回落到兜底值（0 会被 DeepSeek 等厂商拒绝）', () => {
    expect(normalizeMaxTokens(0)).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens(-100)).toBe(DEFAULT_OUTPUT_TOKENS);
  });

  it('超大值夹到上限，保证落在厂商允许区间内', () => {
    expect(normalizeMaxTokens(1_000_000)).toBe(MAX_OUTPUT_TOKENS);
    // DeepSeek 上限 393216，收敛后的值一定在其区间内
    expect(normalizeMaxTokens(393_217)).toBeLessThanOrEqual(393_216);
  });

  it('合法值保持原样，返回值恒为区间内的整数', () => {
    expect(normalizeMaxTokens(2048)).toBe(2048);
    expect(normalizeMaxTokens('2048')).toBe(2048);
    expect(normalizeMaxTokens(4096.7)).toBe(4096);
    for (const input of [0, -1, null, 'abc', 1_000_000]) {
      const out = normalizeMaxTokens(input);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
      expect(out).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    }
  });
});

describe('normalizeTemperature', () => {
  it('夹到 [0, 2] 区间', () => {
    expect(normalizeTemperature(99)).toBe(2);
    expect(normalizeTemperature(-1)).toBe(0);
    expect(normalizeTemperature(0.2)).toBe(0.2);
  });

  it('空值与非法值回落到 0.2', () => {
    expect(normalizeTemperature(null)).toBe(0.2);
    expect(normalizeTemperature('')).toBe(0.2);
    expect(normalizeTemperature('abc')).toBe(0.2);
    expect(normalizeTemperature(undefined)).toBe(0.2);
  });
});

describe('sanitizeLlmConfig', () => {
  it('修复 localStorage 里的历史脏数据', () => {
    const healed = sanitizeLlmConfig({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/chat/completions',
      maxTokens: 0,
      temperature: 99,
      apiKey: null,
      model: undefined,
    } as unknown as Partial<LlmConfig>);
    expect(healed.maxTokens).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(healed.temperature).toBe(2);
    expect(healed.apiKey).toBe('');
    expect(healed.model).toBe('');
    expect(healed.providerId).toBe('deepseek');
  });

  it('空入参回落到默认配置', () => {
    expect(sanitizeLlmConfig(null)).toEqual(DEFAULT_LLM_CONFIG);
    expect(sanitizeLlmConfig(undefined)).toEqual(DEFAULT_LLM_CONFIG);
  });

  it('存量配置里的旧默认值 1200 会被平滑升级到新默认值', () => {
    // 用户从未手动改过输入框 → localStorage 里留着旧默认值，应随平台一起升级
    expect(sanitizeLlmConfig({ maxTokens: 1200 }).maxTokens).toBe(DEFAULT_OUTPUT_TOKENS);
    // 用户自己填过的值原样保留
    expect(sanitizeLlmConfig({ maxTokens: 2048 }).maxTokens).toBe(2048);
    expect(sanitizeLlmConfig({ maxTokens: 4096 }).maxTokens).toBe(4096);
  });
});

describe('默认输出额度', () => {
  it('默认值与上限一致（8192），避免思考型模型因额度太小返回空正文', () => {
    expect(DEFAULT_OUTPUT_TOKENS).toBe(MAX_OUTPUT_TOKENS);
    expect(DEFAULT_LLM_CONFIG.maxTokens).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(normalizeMaxTokens(undefined)).toBe(MAX_OUTPUT_TOKENS);
  });
});
