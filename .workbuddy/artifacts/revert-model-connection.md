# 回退：模型连接 · 本地 CORS 代理整套改动

**结论**：已把「模型连接」相关改动整体回退到**你没有让我改模型连接之前**的版本，全套验证通过。
改前原件已整批备份，随时可恢复。

## 回退了什么

时间线：今天下午共两批改动，都是围绕「模型连接连不上自建网关」——

1. **本地 CORS 代理**（`scripts/llm-proxy.mjs` + `npm run llm:proxy`）
2. **代理配了仍连不上**的客户端修复（前缀归一化 / 失败自动诊断 / dev 自动拉起代理）

两批现已全部撤掉。

| 类型 | 对象 |
| --- | --- |
| 🗑️ 删除 | `scripts/llm-proxy.mjs`、`scripts/llm-proxy.test.ts`、`verify-llm-proxy.mjs`、`src/components/LlmConnector.test.tsx`、`src/components/AIQueryConsole.test.tsx` |
| ↩️ 回退 | `package.json`（去 `llm:proxy`）、`vite.config.ts`（去 `llmCorsProxyPlugin`）、`src/data/llmProviders.ts`、`src/lib/llmClient.ts`、`src/components/LlmConnector.tsx`、`src/components/AIQueryConsole.tsx`、`src/styles/app.css` |
| 📄 文档回退 | `README.md`、`TODO.md`、`docs/llm-integration.md` |
| 🔒 备份 | `.workbuddy/backup/2026-09-18-cors-proxy-revert/`（测试文件改名 `.bak`，避免被 vitest 扫到） |

## 「模型连接」弹窗现在的样子

回到最朴素的形态：**高级：跨域代理与私有网关** 折叠区里只留一个「代理前缀（可选）」输入框。
原来那些新增物全部撤掉——「已开启」徽标、前缀写法校验提示、「填入本地代理」/「检测代理」按钮、
`npm run llm:proxy` 命令块、探测结果、「混合内容」警告；错误提示也不再按「是否已配代理」分流，
恢复为你当时看到的那句原文：*可在「模型设置」中填写自建代理前缀（如 http://localhost:8787）*。

`npm run dev` 也不再自动拉起代理（vite 配置里的那段插件已移除）。

## 保留的两处（避免白送 bug 回来）

- 「实际请求地址」仍复用 `withProxy` 拼接，**没有**退回裸拼字符串——否则弹窗又会显示
  `…:8787https://…` 这种少一个 `/` 的假地址，排障时反被带偏。
- `withProxy` 自身保留 trim + 去尾部斜杠（不恢复协议自动补全那套）。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | ✅ 无错误 |
| `npx eslint`（改动文件） | ✅ 干净（`src/lib/router.ts` 3 处报错是仓库预存的，与本次无关） |
| `npx vitest run` | ✅ **34 文件 / 665 测试全绿**（正好回到跨域改动之前的用例数） |
| `npm run build`（含 embed） | ✅ 全链路通过 |

## 一个需要知道的副作用

自建网关 `https://api.qingcuicore.com/v1` **本身没有开 CORS**（预检 `OPTIONS` 直接 403
且不带 `Access-Control-Allow-Origin`），浏览器端拿不到状态码也无法绕过。回退后，
**用 `gpt-5.6-sol` 直连它会重新变成连不上**。

要真正解决，得在网关侧放行 CORS（若用 Caddy，加一段 `header` 即可），或者自己起一个带
CORS 的反代把地址填进「代理前缀」。想直接恢复这次回退的内容，说一声即可从备份还原。
