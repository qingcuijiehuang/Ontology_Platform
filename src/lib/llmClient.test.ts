import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBody,
  buildChatMessages,
  buildDatasetContext,
  buildOntologyContext,
  buildRequestUrl,
  chatCompletion,
  classifyError,
  DEFAULT_SYSTEM_PROMPT,
  extractApiError,
  extractContent,
  extractFinishReason,
  extractModel,
  extractReasoningContent,
  extractUsage,
  isOutputLimitError,
  isReasoningModel,
  llmErrorHint,
  streamChatCompletion,
  type GroundingDataset,
  type LlmMessage,
} from './llmClient';
import { cosmicCoffeeOntology } from '../data/ontology';
import {
  DEFAULT_LLM_CONFIG,
  DEFAULT_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  type LlmConfig,
} from '../data/llmProviders';

const config: LlmConfig = {
  ...DEFAULT_LLM_CONFIG,
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
};

const datasets: GroundingDataset[] = [
  {
    name: 'Fourth Coffee · 客户',
    kind: 'json-file',
    entityTypeId: 'customer',
    entityName: 'Customer',
    source: '数据湖仓 bronze 层',
    columnMappings: { customer_id: 'customerId', full_name: 'name' },
    rowCount: 8,
    rows: [
      { customer_id: 'CUST-001', full_name: 'Arif Ramadhan', loyalty_status: 'Gold' },
      { customer_id: 'CUST-002', full_name: 'Jaroslav Cerny', loyalty_status: 'Platinum' },
    ],
  },
];

describe('buildOntologyContext', () => {
  const context = buildOntologyContext(cosmicCoffeeOntology);

  it('包含本体名称与规模', () => {
    expect(context).toContain(cosmicCoffeeOntology.name);
    expect(context).toContain(`${cosmicCoffeeOntology.entityTypes.length} 个实体类型`);
    expect(context).toContain(`${cosmicCoffeeOntology.relationships.length} 条关系`);
  });

  it('包含实体属性与主键标记', () => {
    expect(context).toContain('customerId');
    expect(context).toContain('主键');
    expect(context).toContain('loyaltyTier');
    expect(context).toContain('枚举值');
  });

  it('包含关系方向与基数', () => {
    const rel = cosmicCoffeeOntology.relationships[0];
    expect(context).toContain(rel.name);
    expect(context).toContain(rel.cardinality);
  });
});

describe('buildDatasetContext', () => {
  it('渲染真实数据行与列映射', () => {
    const text = buildDatasetContext(datasets);
    expect(text).toContain('Fourth Coffee · 客户');
    expect(text).toContain('映射实体：Customer');
    expect(text).toContain('customer_id → customerId');
    expect(text).toContain('Arif Ramadhan');
    expect(text).toContain('总行数：8');
    // markdown 表格
    expect(text).toContain('| customer_id |');
  });

  it('未接入数据源时给出明确说明', () => {
    const text = buildDatasetContext([]);
    expect(text).toContain('未接入任何数据源');
  });

  it('遵循行数上限', () => {
    const many: GroundingDataset = {
      ...datasets[0],
      rowCount: 50,
      rows: Array.from({ length: 20 }, (_, i) => ({ customer_id: `CUST-${i}` })),
    };
    const text = buildDatasetContext([many], 3);
    expect(text).toContain('CUST-0');
    expect(text).toContain('CUST-2');
    expect(text).not.toContain('CUST-3');
  });

  it('表格单元格中的竖线被转义，避免破坏表结构', () => {
    const text = buildDatasetContext([{
      ...datasets[0],
      rows: [{ note: 'a|b' }],
    }]);
    expect(text).toContain('a\\|b');
  });

  it('抓取失败（0 行）的数据集不会注入空表', () => {
    const text = buildDatasetContext([{ ...datasets[0], rowCount: 0, rows: [] }]);
    expect(text).toContain('（无数据行）');
  });

  it('提供 question 时按相关性召回，且不做「补齐」兜底', () => {
    const many: GroundingDataset = {
      ...datasets[0],
      rowCount: 5,
      rows: [
        { customer_id: 'CUST-001', full_name: 'Arif Ramadhan', loyalty_status: 'Gold' },
        { customer_id: 'CUST-002', full_name: 'Jaroslav Cerny', loyalty_status: 'Platinum' },
        { customer_id: 'CUST-003', full_name: 'Sumber Agvaan', loyalty_status: 'Bronze' },
        { customer_id: 'CUST-008', full_name: 'Sofia Marchetti', loyalty_status: 'Platinum' },
      ],
    };
    // topN=2 → 只注入两条 Platinum，Gold/Bronze 不会被「补」进来
    const text = buildDatasetContext([many], 2, 'Platinum 客户');
    expect(text).toContain('CUST-002');
    expect(text).toContain('CUST-008');
    expect(text).not.toContain('CUST-001');
    expect(text).toContain('按问题相关性召回 2 行');
  });

  it('question 与该数据源完全无关时，0 行注入并给出说明', () => {
    const many: GroundingDataset = {
      ...datasets[0],
      rowCount: 3,
      rows: [
        { customer_id: 'CUST-001', full_name: 'Arif Ramadhan', loyalty_status: 'Gold' },
        { customer_id: 'CUST-002', full_name: 'Jaroslav Cerny', loyalty_status: 'Platinum' },
      ],
    };
    const text = buildDatasetContext([many], 120, '今天上海天气如何');
    expect(text).toContain('按问题相关性召回 0 行');
    expect(text).toContain('本次不注入任何行');
    expect(text).not.toContain('CUST-001');
  });

  it('未提供 question 时退化为原始顺序并标注', () => {
    const text = buildDatasetContext(datasets, 16);
    expect(text).toContain('原始顺序');
  });
});

describe('buildChatMessages', () => {
  const messages = buildChatMessages({
    question: '金牌会员的订单总额是多少？',
    ontology: cosmicCoffeeOntology,
    datasets,
    localHits: ['实体：Customer — 6 个属性'],
  });

  it('产出 system + user 两条消息', () => {
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('系统提示要求只依据本体与数据集作答', () => {
    expect(messages[0].content).toContain('只能依据');
    expect(messages[0].content).toContain('严禁编造');
  });

  it('用户消息同时包含本体、数据集、本地命中与问题', () => {
    const user = messages[1].content;
    expect(user).toContain(cosmicCoffeeOntology.name);
    expect(user).toContain('Fourth Coffee · 客户');
    expect(user).toContain('Arif Ramadhan');
    expect(user).toContain('本地图谱检索引擎的命中');
    expect(user).toContain('金牌会员的订单总额是多少？');
  });

  it('未提供数据集时提示缺少实例数据', () => {
    const msgs = buildChatMessages({
      question: '有哪些客户？',
      ontology: cosmicCoffeeOntology,
      datasets: [],
    });
    expect(msgs[1].content).toContain('未接入任何数据源');
  });
});

describe('buildChatMessages · 系统提示词与多轮历史', () => {
  const base = {
    question: '订单总额是多少？',
    ontology: cosmicCoffeeOntology,
    datasets,
  };

  it('默认使用内置系统提示词', () => {
    const msgs = buildChatMessages(base);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('传入自定义系统提示词时整体替换默认提示词', () => {
    const msgs = buildChatMessages({
      ...base,
      systemPrompt: '你是一名严谨的数据审计员，所有结论必须给出计算过程。',
    });
    expect(msgs[0].content).toBe('你是一名严谨的数据审计员，所有结论必须给出计算过程。');
    // 接地上下文不受影响，仍然注入用户消息
    expect(msgs[msgs.length - 1].content).toContain(cosmicCoffeeOntology.name);
    expect(msgs[msgs.length - 1].content).toContain('订单总额是多少？');
  });

  it('空字符串 / 纯空白的自定义提示词回退为默认', () => {
    expect(buildChatMessages({ ...base, systemPrompt: '   ' })[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(buildChatMessages({ ...base, systemPrompt: '' })[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('多轮历史按顺序插入在 system 与本轮用户消息之间', () => {
    const history: LlmMessage[] = [
      { role: 'user', content: '什么是 Requirement_Document？' },
      { role: 'assistant', content: 'Requirement_Document 是记录需求的实体。' },
      { role: 'user', content: '它如何关联 Feature？' },
      { role: 'assistant', content: '通过 requires 关系关联。' },
    ];
    const msgs = buildChatMessages({ ...base, history });
    expect(msgs).toHaveLength(1 + 4 + 1);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: '什么是 Requirement_Document？' });
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[3].role).toBe('user');
    expect(msgs[4].role).toBe('assistant');
    // 本轮问题始终是最后一条
    expect(msgs[msgs.length - 1].role).toBe('user');
    expect(msgs[msgs.length - 1].content).toContain('订单总额是多少？');
  });

  it('过滤非法历史消息（system 角色 / 空内容）', () => {
    const history: LlmMessage[] = [
      { role: 'system', content: '注入垃圾指令' },
      { role: 'user', content: '   ' },
      { role: 'user', content: '合法的问题' },
      { role: 'assistant', content: '合法的回答' },
    ];
    const msgs = buildChatMessages({ ...base, history });
    // system(1) + 合法 2 条 + 本轮 user(1)
    expect(msgs).toHaveLength(4);
    expect(msgs[1]).toEqual({ role: 'user', content: '合法的问题' });
  });
});

describe('响应解析', () => {
  it('解析标准 OpenAI 响应', () => {
    expect(extractContent({ choices: [{ message: { content: '你好' } }] })).toBe('你好');
  });

  it('解析流式 delta 分片', () => {
    expect(extractContent({ choices: [{ delta: { content: '片' } }] })).toBe('片');
  });

  it('解析分段内容数组', () => {
    expect(extractContent({
      choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }],
    })).toBe('AB');
  });

  it('结构不符时返回空字符串', () => {
    expect(extractContent(null)).toBe('');
    expect(extractContent({})).toBe('');
    expect(extractContent({ choices: [] })).toBe('');
  });

  it('解析模型名与用量', () => {
    const payload = { model: 'deepseek-chat', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    expect(extractModel(payload)).toBe('deepseek-chat');
    expect(extractUsage(payload)).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(extractUsage({})).toBeUndefined();
  });

  it('兼容多种错误结构', () => {
    expect(extractApiError({ error: { message: 'bad key' } })).toBe('bad key');
    expect(extractApiError({ error: 'rate limited' })).toBe('rate limited');
    expect(extractApiError({ message: 'oops' })).toBe('oops');
    expect(extractApiError({})).toBeNull();
  });
});

describe('classifyError / llmErrorHint', () => {
  it('按状态码归类', () => {
    expect(classifyError(401, 'x').code).toBe('auth');
    expect(classifyError(403, 'x').code).toBe('auth');
    expect(classifyError(404, 'x').code).toBe('not-found');
    expect(classifyError(429, 'x').code).toBe('rate-limit');
    expect(classifyError(503, 'x').code).toBe('server');
  });

  it('保留原始状态码', () => {
    expect(classifyError(429, 'too many').status).toBe(429);
  });

  it('每种错误码都有中文排查建议', () => {
    const codes = ['not-configured', 'auth', 'not-found', 'rate-limit', 'server', 'bad-request', 'cors', 'network', 'timeout', 'empty', 'aborted', 'unknown'] as const;
    for (const code of codes) {
      expect(llmErrorHint(code).length).toBeGreaterThan(5);
    }
  });

  it('400/422 归类为 bad-request（参数被拒绝），而不是笼统的 unknown', () => {
    expect(classifyError(400, 'max_tokens').code).toBe('bad-request');
    expect(classifyError(422, 'x').code).toBe('bad-request');
  });
});

// 回归：「测试连接成功、提问却报 400 max_tokens 越界」。
describe('isOutputLimitError', () => {
  it('识别 DeepSeek 原文（用户实际遇到的报错）', () => {
    expect(isOutputLimitError(
      'Invalid max_tokens value, the valid range of max_tokens is [1, 393216]',
    )).toBe(true);
  });

  it('识别 OpenAI 与阿里百炼的措辞', () => {
    expect(isOutputLimitError("Unsupported parameter: 'max_tokens' is not supported with this model.")).toBe(true);
    expect(isOutputLimitError('Range of max_tokens should be [1, 8192]')).toBe(true);
  });

  it('不误判无关错误', () => {
    expect(isOutputLimitError('Unauthorized')).toBe(false);
    expect(isOutputLimitError('Rate limit exceeded')).toBe(false);
    expect(isOutputLimitError('')).toBe(false);
  });
});

describe('isReasoningModel', () => {
  it('识别需要 max_completion_tokens 的 OpenAI 推理类模型', () => {
    expect(isReasoningModel('gpt-5')).toBe(true);
    expect(isReasoningModel('gpt-5-mini')).toBe(true);
    expect(isReasoningModel('o3-mini')).toBe(true);
  });

  it('其它厂商模型沿用 max_tokens', () => {
    expect(isReasoningModel('deepseek-v4-flash')).toBe(false);
    expect(isReasoningModel('glm-4.7')).toBe(false);
    expect(isReasoningModel('kimi-k3')).toBe(false);
    expect(isReasoningModel('')).toBe(false);
  });
});

describe('buildBody', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];
  const bodyOf = (override: Partial<LlmConfig>, omit = false) => {
    const cfg = { ...config, ...override };
    return JSON.parse(buildBody(cfg, { config: cfg, messages }, false, omit));
  };

  it('正常配置带上合法 max_tokens 与 temperature', () => {
    const body = bodyOf({});
    expect(body.max_tokens).toBe(DEFAULT_LLM_CONFIG.maxTokens);
    expect(body.temperature).toBe(DEFAULT_LLM_CONFIG.temperature);
    expect(body.stream).toBe(false);
    expect(body.model).toBe(config.model);
  });

  it('脏 maxTokens（0 / null / 超大）不会原样发出去', () => {
    expect(bodyOf({ maxTokens: 0 }).max_tokens).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(bodyOf({ maxTokens: null as unknown as number }).max_tokens).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(bodyOf({ maxTokens: 1_000_000 }).max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it('推理类模型改用 max_completion_tokens', () => {
    const body = bodyOf({ providerId: 'openai', model: 'gpt-5-mini' });
    expect(body.max_completion_tokens).toBe(DEFAULT_LLM_CONFIG.maxTokens);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('omitOutputLimit=true 时完全不带输出上限参数', () => {
    const body = bodyOf({}, true);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('max_completion_tokens');
  });
});

describe('buildRequestUrl', () => {
  it('默认直连厂商接口', () => {
    expect(buildRequestUrl(config)).toBe('https://api.deepseek.com/chat/completions');
  });

  it('可叠加代理前缀', () => {
    expect(buildRequestUrl({ ...config, proxyBaseUrl: 'http://localhost:8787' }))
      .toBe('http://localhost:8787/https://api.deepseek.com/chat/completions');
  });

  it('地址不完整时自动补齐路径', () => {
    expect(buildRequestUrl({ ...config, baseUrl: 'https://api.deepseek.com' }))
      .toBe('https://api.deepseek.com/v1/chat/completions');
  });
});

describe('extractFinishReason / extractReasoningContent', () => {
  it('解析 finish_reason', () => {
    expect(extractFinishReason({ choices: [{ finish_reason: 'length' }] })).toBe('length');
    expect(extractFinishReason({ choices: [{ finish_reason: 'stop' }] })).toBe('stop');
    expect(extractFinishReason({ choices: [] })).toBeUndefined();
    expect(extractFinishReason(null)).toBeUndefined();
  });

  it('解析思考内容（message 与 delta 两种形状）', () => {
    expect(extractReasoningContent({ choices: [{ message: { reasoning_content: '思考中…', content: null } }] })).toBe('思考中…');
    expect(extractReasoningContent({ choices: [{ delta: { reasoning_content: '推理' } }] })).toBe('推理');
    expect(extractReasoningContent({ choices: [{ delta: { content: '正文' } }] })).toBe('');
  });
});

describe('llmErrorHint · empty-length', () => {
  it('给出调大输出额度的可操作建议', () => {
    const hint = llmErrorHint('empty-length');
    expect(hint).toContain('思考');
    expect(hint).toContain('最大输出 Token');
  });
});

describe('思考耗尽输出额度 → 自动放大重试', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const reasoningExhaustedPayload = {
    model: 'deepseek-v4-flash',
    choices: [
      {
        finish_reason: 'length',
        message: { role: 'assistant', content: null, reasoning_content: '（推理过程，把额度全部用完）' },
      },
    ],
  };

  const sseBody = (events: unknown[]) =>
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';

  it('chatCompletion：空正文 + finish_reason=length → 放大 max_tokens 重试一次并成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(reasoningExhaustedPayload), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '最终回答' } }] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatCompletion({
      config: { ...config, maxTokens: 1200 },
      messages: [{ role: 'user', content: '问题' }],
    });

    expect(result.content).toBe('最终回答');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(retryBody.max_tokens).toBe(Math.min(1200 * 4, MAX_OUTPUT_TOKENS));
  });

  it('chatCompletion：已放大过仍为空 → 抛 empty-length，且不再重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(reasoningExhaustedPayload), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = chatCompletion({
      config: { ...config, maxTokens: 1200 },
      messages: [{ role: 'user', content: '问题' }],
      expandedOutputLimit: true,
    });
    await expect(promise).rejects.toMatchObject({ code: 'empty-length' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('streamChatCompletion：思考分片后正文为空（finish_reason=length）→ 放大重试并产出正文', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        sseBody([
          { choices: [{ delta: { reasoning_content: '思考' } }] },
          { choices: [{ delta: {}, finish_reason: 'length' }] },
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        sseBody([
          { choices: [{ delta: { content: '流式' } }] },
          { choices: [{ delta: { content: '回答' }, finish_reason: 'stop' }] },
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    const lastFulls: string[] = [];
    const result = await streamChatCompletion({
      config: { ...config, maxTokens: 1200 },
      messages: [{ role: 'user', content: '问题' }],
      onDelta: (_d, full) => lastFulls.push(full),
    });

    expect(result.content).toBe('流式回答');
    expect(lastFulls[lastFulls.length - 1]).toBe('流式回答');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(retryBody.max_tokens).toBe(Math.min(1200 * 4, MAX_OUTPUT_TOKENS));
  });

  it('正文正常时行为不变：finish_reason=length 但有内容不触发重试', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '被截断但有内容' } }],
      }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatCompletion({
      config: { ...config, maxTokens: 1200 },
      messages: [{ role: 'user', content: '问题' }],
    });
    expect(result.content).toBe('被截断但有内容');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
