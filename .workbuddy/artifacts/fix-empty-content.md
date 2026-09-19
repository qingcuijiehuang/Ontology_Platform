# 修复「模型返回空内容」

## 现象
智能检索问答使用 DeepSeek · deepseek-v4-flash 回答较长问题时，报错：
「模型返回空内容：请重试，或更换模型。」

## 根因
- deepseek-v4-flash 属于**混合思考模型**：回答前会先把输出额度花在 `reasoning_content`（推理过程）上，正文才写入 `content`。
- 平台默认「最大输出 Token」只有 **1200**。问题较长时推理就把额度用尽，模型返回 `content` 为空 + `finish_reason=length`。
- 前端把这种情况笼统归类为「返回空内容」，提示没有可操作性。

## 修复（2026-09-18）
改动文件：`src/lib/llmClient.ts`、`src/components/AIQueryConsole.tsx`、`src/lib/llmClient.test.ts`

1. 识别「思考耗尽额度」：新增 `extractFinishReason` / `extractReasoningContent`，判定「正文为空 + finish_reason=length」。
2. **自动放大额度重试一次**：新上限 = min(原值 × 4, 8192)，如 1200 → 4800；非流式与流式（含流式回退 JSON 分支）均覆盖；内部标记防止无限重试。
3. 重试仍失败时给出新错误码 `empty-length`，提示「把最大输出 Token 调大（建议 4096–8192）」，并在问答面板亮出「模型设置 →」入口。
4. 思考过程（reasoning_content）不会混入回答 UI。

## 验证
- `npx tsc -b` ✅ · eslint ✅ · **34 文件 / 672 测试全绿**（新增 6 条，含自动重试端到端）✅ · `npm run build` ✅

## 用户侧建议
- 修复后一般无需手动操作（会自动重试）。若问题特别长仍失败，到「模型连接」把「最大输出 Token」调到 4096–8192。
