/**
 * 复现并验证「测试连接成功、提问却报 400 max_tokens 越界」这一 bug 的修复。
 *
 * 场景（用户实际遇到）：
 *   - 厂商：DeepSeek，错误原文 `Invalid max_tokens value, the valid range of
 *     max_tokens is [1, 393216]`（393216 正是 DeepSeek 官方文档给出的上限）
 *   - 根因：`max_tokens` 取自 localStorage 且从未校验，脏值（0 / null / 字符串 /
 *     超大数字）会被原样发给厂商；而旧的 `testConnection` 硬编码 maxTokens: 32，
 *     所以测试永远通过，掩盖了问题。
 *
 * 本脚本用 mock fetch 跑真实的 chatCompletion 调用链，逐条断言修复后的行为。
 * 用法：npx tsx verify-llm-max-tokens-fix.mjs
 */
import assert from 'node:assert/strict';
import {
  normalizeMaxTokens,
  normalizeTemperature,
  sanitizeLlmConfig,
  DEFAULT_LLM_CONFIG,
  DEFAULT_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
} from './src/data/llmProviders.ts';
import {
  buildBody,
  chatCompletion,
  classifyError,
  isOutputLimitError,
  isReasoningModel,
  LlmError,
} from './src/lib/llmClient.ts';

const DEEPSEEK_ERROR =
  'Invalid max_tokens value, the valid range of max_tokens is [1, 393216]';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

console.log('=== LLM max_tokens 越界 bug 修复验证 ===\n');

// ── 1. 数值归一化 ───────────────────────────────────────────────────────────
console.log('1) normalizeMaxTokens 把脏值收敛到合法区间');
const dirtyCases = [
  [0, DEFAULT_OUTPUT_TOKENS, '0（旧版默认，厂商拒绝）'],
  [-5, DEFAULT_OUTPUT_TOKENS, '负数'],
  [null, DEFAULT_OUTPUT_TOKENS, 'null'],
  [undefined, DEFAULT_OUTPUT_TOKENS, 'undefined'],
  ['abc', DEFAULT_OUTPUT_TOKENS, '非数字字符串'],
  [NaN, DEFAULT_OUTPUT_TOKENS, 'NaN'],
  [Infinity, DEFAULT_OUTPUT_TOKENS, 'Infinity'],
  [1000000, MAX_OUTPUT_TOKENS, '超大值（用户手输）'],
  [393217, MAX_OUTPUT_TOKENS, '刚刚越过 DeepSeek 上限'],
  ['2048', 2048, '数字字符串'],
  [4096.7, 4096, '小数被截断'],
  [1200, 1200, '合法值保持不变'],
];
for (const [input, expected, label] of dirtyCases) {
  check(`${String(input)} → ${expected}（${label}）`, () => {
    const out = normalizeMaxTokens(input);
    assert.equal(out, expected);
    assert.ok(Number.isInteger(out), '必须是整数');
    assert.ok(out >= MIN_OUTPUT_TOKENS && out <= MAX_OUTPUT_TOKENS, '必须落在合法区间');
  });
}

check('normalizeTemperature 夹到 [0,2]，空值/非法值回落 0.2', () => {
  assert.equal(normalizeTemperature(NaN), 0.2);
  assert.equal(normalizeTemperature(null), 0.2, 'null 必须回落兜底值而不是被当成 0');
  assert.equal(normalizeTemperature(undefined), 0.2);
  assert.equal(normalizeTemperature(''), 0.2, '空字符串必须回落兜底值');
  assert.equal(normalizeTemperature('abc'), 0.2);
  assert.equal(normalizeTemperature(99), 2);
  assert.equal(normalizeTemperature(-1), 0);
  assert.equal(normalizeTemperature(0.2), 0.2);
});

// ── 2. 配置清洗（localStorage 自愈） ────────────────────────────────────────
console.log('\n2) sanitizeLlmConfig 修复 localStorage 里的历史脏数据');
check('maxTokens=0 + temperature=99 + 非字符串字段 → 全部收敛', () => {
  const healed = sanitizeLlmConfig({
    providerId: 'deepseek',
    maxTokens: 0,
    temperature: 99,
    apiKey: null,
    model: undefined,
    baseUrl: 'https://api.deepseek.com/chat/completions',
  });
  assert.equal(healed.maxTokens, DEFAULT_OUTPUT_TOKENS);
  assert.equal(healed.temperature, 2);
  assert.equal(healed.apiKey, '');
  assert.equal(healed.model, '');
  assert.equal(healed.providerId, 'deepseek');
});

check('null / undefined 入参回落到默认配置', () => {
  assert.deepEqual(sanitizeLlmConfig(null), DEFAULT_LLM_CONFIG);
  assert.deepEqual(sanitizeLlmConfig(undefined), DEFAULT_LLM_CONFIG);
});

// ── 3. 请求体构造 ───────────────────────────────────────────────────────────
console.log('\n3) buildBody 永远不把非法 max_tokens 发出去');
const baseConfig = { ...DEFAULT_LLM_CONFIG, apiKey: 'sk-test' };
const msgs = [{ role: 'user', content: 'hi' }];

check('默认配置 → max_tokens = 1200', () => {
  const body = JSON.parse(buildBody(baseConfig, { config: baseConfig, messages: msgs }, false));
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.stream, false);
});

check('脏配置 maxTokens=0 → 发出去的是 1200，绝不是 0', () => {
  const dirty = { ...baseConfig, maxTokens: 0 };
  const body = JSON.parse(buildBody(dirty, { config: dirty, messages: msgs }, false));
  assert.equal(body.max_tokens, 1200);
  assert.ok(body.max_tokens >= 1);
});

check('脏配置 maxTokens=999999 → 夹到 8192（仍落在 [1, 393216] 内）', () => {
  const dirty = { ...baseConfig, maxTokens: 999999 };
  const body = JSON.parse(buildBody(dirty, { config: dirty, messages: msgs }, false));
  assert.equal(body.max_tokens, MAX_OUTPUT_TOKENS);
  assert.ok(body.max_tokens <= 393216);
});

check('maxTokens=null 的配置 → 不会序列化成 null', () => {
  const dirty = { ...baseConfig, maxTokens: null };
  const body = JSON.parse(buildBody(dirty, { config: dirty, messages: msgs }, false));
  assert.equal(body.max_tokens, 1200);
});

check('gpt-5 推理模型 → 用 max_completion_tokens，不带 max_tokens', () => {
  assert.equal(isReasoningModel('gpt-5'), true);
  assert.equal(isReasoningModel('gpt-5-mini'), true);
  assert.equal(isReasoningModel('o3-mini'), true);
  assert.equal(isReasoningModel('deepseek-v4-flash'), false);
  assert.equal(isReasoningModel('kimi-k3'), false);
  const cfg = { ...baseConfig, providerId: 'openai', model: 'gpt-5-mini' };
  const body = JSON.parse(buildBody(cfg, { config: cfg, messages: msgs }, false));
  assert.equal(body.max_completion_tokens, 1200);
  assert.equal('max_tokens' in body, false, '推理模型不应带 max_tokens');
});

check('omitOutputLimit=true → 完全不带输出上限参数', () => {
  const body = JSON.parse(
    buildBody(baseConfig, { config: baseConfig, messages: msgs }, false, true),
  );
  assert.equal('max_tokens' in body, false);
  assert.equal('max_completion_tokens' in body, false);
  assert.equal(body.model, baseConfig.model);
});

// ── 4. 错误识别与归类 ───────────────────────────────────────────────────────
console.log('\n4) 错误识别与归类');
check('能认出用户截图里的 DeepSeek 报错', () => {
  assert.equal(isOutputLimitError(DEEPSEEK_ERROR), true);
});
check('能认出 OpenAI / 阿里百炼 / 中文措辞', () => {
  assert.equal(isOutputLimitError("Unsupported parameter: 'max_tokens' is not supported with this model."), true);
  assert.equal(isOutputLimitError('Range of max_tokens should be [1, 8192]'), true);
  assert.equal(isOutputLimitError('maximum output tokens must be greater than 0'), true);
});
check('不会误判无关错误', () => {
  assert.equal(isOutputLimitError('Unauthorized'), false);
  assert.equal(isOutputLimitError(''), false);
  assert.equal(isOutputLimitError('Rate limit exceeded'), false);
});
check('400 → bad-request（而不是笼统的 unknown）', () => {
  const err = classifyError(400, DEEPSEEK_ERROR);
  assert.ok(err instanceof LlmError);
  assert.equal(err.code, 'bad-request');
  assert.equal(err.status, 400);
  assert.equal(classifyError(401, 'x').code, 'auth');
  assert.equal(classifyError(429, 'x').code, 'rate-limit');
});

// ── 5. 端到端：mock fetch 跑真实调用链 ──────────────────────────────────────
console.log('\n5) 端到端：mock fetch 验证自动重试');

const realFetch = globalThis.fetch;

async function withMockFetch(handler, fn) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const entry = { url, body: JSON.parse(init.body) };
    calls.push(entry);
    return handler(entry, calls.length);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

await checkAsync('首次被 400 拒绝 → 自动去掉 max_tokens 重试并成功', async () => {
  let sawBadValue = false;
  await withMockFetch(
    (entry, n) => {
      if (n === 1) {
        // 模拟厂商校验：这里收到的值若为空或不在 [1,393216] 内就报错
        const v = entry.body.max_tokens;
        if (typeof v !== 'number' || v < 1 || v > 393216) sawBadValue = true;
        return new Response(JSON.stringify({ error: { message: DEEPSEEK_ERROR } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '连通' } }],
          model: 'deepseek-v4-flash',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async (calls) => {
      const cfg = { ...baseConfig, maxTokens: 0 }; // 故意给一个脏值
      const res = await chatCompletion({ config: cfg, messages: msgs });
      assert.equal(res.content, '连通');
      assert.equal(calls.length, 2, '应当在 400 后重试一次');
      assert.equal(sawBadValue, false, '第一次请求就不该发出非法 max_tokens');
      assert.equal(calls[0].body.max_tokens, 1200, '第一次应已被归一化为 1200');
      assert.equal('max_tokens' in calls[1].body, false, '重试时应省略该参数');
    },
  );
});

await checkAsync('鉴权失败（401）不重试，直接归类为 auth', async () => {
  await withMockFetch(
    () =>
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const cfg = { ...baseConfig, apiKey: 'sk-wrong' };
      await assert.rejects(
        () => chatCompletion({ config: cfg, messages: msgs }),
        (err) => err instanceof LlmError && err.code === 'auth',
      );
      assert.equal(calls.length, 1, '鉴权失败不应重试');
    },
  );
});

await checkAsync('正常配置（1200）一次成功，不产生多余请求', async () => {
  await withMockFetch(
    () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const res = await chatCompletion({ config: baseConfig, messages: msgs });
      assert.equal(res.content, 'ok');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.max_tokens, 1200);
    },
  );
});

if (process.exitCode) {
  console.error(`\n=== 有失败项（已通过 ${passed} 项）===`);
} else {
  console.log(`\n=== ${passed} 项检查全部通过 ===`);
}
