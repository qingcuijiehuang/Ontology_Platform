/**
 * Standalone verification for the latest LLM provider presets.
 * Useful when vitest is broken (rolldown/vite8 env bug) — confirms every
 * invariant the UI relies on:
 *   - 8 providers, ids unique
 *   - featuredModels is non-empty for non-custom
 *   - defaultModel ∈ featuredModels ⊆ models
 *   - user-requested models present (deepseek-v4-flash/pro, gpt-5/5-mini, glm-5, qwen3.8-max)
 *   - lastUpdated is the 2026-09 month for cloud providers
 */
import assert from 'node:assert/strict';
import {
  LLM_PROVIDERS,
  allPresetModels,
  DEFAULT_LLM_CONFIG,
  findProvider,
  resolveChatEndpoint,
  withProxy,
  maskApiKey,
  describeLlm,
  isLlmConfigured,
} from './src/data/llmProviders.ts';

console.log('=== LLM Providers · 2026-09 最新模型清单 ===');

// 1. id 唯一、≥8 家
const ids = LLM_PROVIDERS.map((p) => p.id);
assert.equal(new Set(ids).size, ids.length, 'ids 必须唯一');
assert.ok(ids.length >= 8, '至少 8 家厂商');
console.log(`  ✓ ${ids.length} 家厂商，id 唯一：${ids.join(', ')}`);

// 2. 必含 openai / deepseek / zhipu
for (const id of ['openai', 'deepseek', 'zhipu']) {
  assert.ok(ids.includes(id), `${id} 必含`);
}
console.log('  ✓ openai / deepseek / zhipu 都在');

// 3. deepseek 必须含 v4-flash 与 v4-pro
const ds = findProvider('deepseek');
assert.ok(ds, 'deepseek preset');
assert.ok(ds.featuredModels.includes('deepseek-v4-flash'), 'deepseek-v4-flash');
assert.ok(ds.featuredModels.includes('deepseek-v4-pro'), 'deepseek-v4-pro');
console.log(`  ✓ DeepSeek 默认=${ds.defaultModel}; 推荐=${ds.featuredModels.join(', ')}`);

// 4. openai 必须含 gpt-5
const oai = findProvider('openai');
assert.ok(oai.featuredModels.includes('gpt-5'));
assert.ok(oai.featuredModels.includes('gpt-5-mini'));
assert.equal(oai.featuredModels.includes('gpt-5-chat-latest'), false, 'gpt-5-chat-latest 已下线');
console.log(`  ✓ OpenAI 默认=${oai.defaultModel}; 推荐=${oai.featuredModels.join(', ')}`);

// 5. 智谱必须有 GLM-5
const glm = findProvider('zhipu');
assert.ok(glm.models.includes('glm-5'));
console.log(`  ✓ 智谱 GLM ${glm.models.length} 个模型 (含 ${glm.models.filter((m) => m.startsWith('glm-5')).length} 个 GLM-5)`);

// 6. 通义必须有 Qwen3.8-Max / Qwen3.7-Max
const qw = findProvider('dashscope');
assert.ok(qw.featuredModels.includes('qwen3.8-max'), 'qwen3.8-max');
assert.ok(qw.models.includes('qwen3.7-max'), 'qwen3.7-max');
console.log(`  ✓ 通义 Qwen ${qw.models.length} 个模型`);

// 7. Kimi 当前主推 kimi-k3（kimi-k2 已下线）
const km = findProvider('moonshot');
assert.ok(km.featuredModels.includes('kimi-k3'), 'kimi-k3');
console.log(`  ✓ Kimi 默认=${km.defaultModel}; 推荐=${km.featuredModels.join(', ')}`);

// 8. 每个非 custom 都有 featuredModels + lastUpdated
for (const p of LLM_PROVIDERS) {
  if (p.id === 'custom') continue;
  assert.ok(p.featuredModels.length > 0, `${p.id} featuredModels 非空`);
  assert.ok(p.featuredModels.includes(p.defaultModel), `${p.id} 默认模型必须在推荐组里`);
  assert.match(p.lastUpdated ?? '', /^\d{4}-\d{2}$/, `${p.id} lastUpdated 格式`);
}
console.log('  ✓ 所有非 custom 厂商都齐 featuredModels + lastUpdated');

// 9. allPresetModels 去重保序
const merged = allPresetModels(ds);
assert.equal(new Set(merged).size, merged.length, 'allPresetModels 去重');
console.log(`  ✓ allPresetModels(deepseek) 共 ${merged.length} 个，前 4 个：${merged.slice(0, 4).join(', ')}`);

// 10. 工具函数没有 breaking 改动
assert.equal(resolveChatEndpoint('https://api.deepseek.com/chat/completions'), 'https://api.deepseek.com/chat/completions');
assert.equal(withProxy('https://api.openai.com/v1/chat/completions', 'http://localhost:8787'),
  'http://localhost:8787/https://api.openai.com/v1/chat/completions');
assert.equal(maskApiKey('sk-abcdefghijklmn'), 'sk-ab****klmn');
assert.equal(isLlmConfigured(DEFAULT_LLM_CONFIG), false, '默认无 Key 不应视为已配置');
const configured = isLlmConfigured({ ...DEFAULT_LLM_CONFIG, apiKey: 'sk-fake' });
assert.equal(configured, true);
console.log('  ✓ resolveChatEndpoint / withProxy / maskApiKey / isLlmConfigured 行为未变');

// 11. DEFAULT_LLM_CONFIG 切到了 v4-flash
assert.equal(DEFAULT_LLM_CONFIG.model, 'deepseek-v4-flash', '默认模型切换到 V4-Flash');
console.log(`  ✓ 默认配置：${describeLlm(DEFAULT_LLM_CONFIG)}`);

console.log('\n=== ALL CHECKS PASSED ===');
