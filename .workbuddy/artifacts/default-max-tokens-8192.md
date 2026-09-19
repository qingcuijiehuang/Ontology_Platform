# 默认「最大输出 Token」上调到 8192

## 改动
| 文件 | 变更 |
| --- | --- |
| `src/data/llmProviders.ts` | `DEFAULT_OUTPUT_TOKENS` 1200 → **8192**（= `MAX_OUTPUT_TOKENS`）；`DEFAULT_LLM_CONFIG.maxTokens` 改为引用该常量；常量定义上移到配置之前 |
| `src/data/llmProviders.ts` | 新增旧默认值平滑升级：`LEGACY_OUTPUT_TOKEN_DEFAULTS = [1200]` + `upgradeLegacyOutputTokens()`，在 `sanitizeLlmConfig` 中生效 |
| `src/lib/llmClient.ts` | 注释更新（放大重试的定位改为「覆盖用户手动调小的场景」） |
| `docs/llm-integration.md` | 两处「建议 2048–4096」改为「默认 8192，仅当目标模型上限较小才下调」；补「空正文自愈」条目 |
| `src/data/llmProviders.test.ts` | 新增 2 组用例：旧值 1200 平滑升级 / 默认值等于上限 |

## 关键设计
- **存量配置平滑升级**：老用户 localStorage 里存着旧默认值 1200 时，读取即自动升级到 8192；
  用户自己填过的值（如 2048 / 4096）原样保留，不会被顶掉。
- 默认值给满后，「答案被截断」的概率降低；若目标模型自身输出上限较小（如 4096）而报 400，
  既有的「去掉输出上限参数自动重试一次」仍会兜住。

## 验证
- `npx tsc -b` ✅ · eslint ✅ · **34 文件 / 674 测试全绿** ✅ · `npm run build` ✅
