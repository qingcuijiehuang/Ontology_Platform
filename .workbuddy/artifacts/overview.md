# 模型连接连不上自建网关 —— 排查与修复

## 结论先说

**代理脚本本身没问题**，问题在客户端三处。实测代理链路完全正常：

| 探测 | 结果 |
|---|---|
| `OPTIONS /v1/chat/completions` 经代理 | **204** + `Access-Control-Allow-Origin` 回显 ✅ |
| `GET /__health` | 200 `{"ok":true,"service":"llm-cors-proxy"}` ✅ |
| `POST` 转发到 `api.qingcuicore.com` | **401**（网关正常拒绝无效 Key），CORS 头已补齐 ✅ |

**你的即时操作**：重启 `npm run dev`。现在它会把代理一起起起来，不用再单独开一个终端。

> 注意：你当前那个 dev server 进程是改动前启动的，不会热更新 vite 配置 —— 必须重启才会拿到自动启动代理的行为。

## 三处根因

### ① 代理前缀漏写协议 → 静默失败（真 bug）

这是最隐蔽的一条。下面两种写法都只抛 `Failed to fetch`，**报错完全不指向原因**：

| 你填的 | 实际会发生什么 |
|---|---|
| `127.0.0.1:8787` | 拼出来不是绝对 URL，`fetch` 抛 `Invalid URL` |
| `localhost:8787` | 被 URL 解析器当成 scheme 为 `localhost:` 的地址（fetch 只认 http/https） |

**修法**：`normalizeProxyBase` 统一补 `http://`，`withProxy` 复用同一份逻辑（原来两处各写一份，容易漂移）；
新增 `proxyPrefixIssue` 校验协议与「误带路径」，在输入框下方当场提示。

### ② 失败提示没有信息量

原提示只让用户「自己去点检测代理」。这句话同时对应四种成因（代理没起 / 前缀写错 / Key 不对 /
网关路径不对），修法各不相同。

**修法**：新增 `diagnoseProxyFailure` —— 先查写法（不碰网络），再敲一次 `/__health`，直接给确定结论：

| 自动结论 | 你该做什么 |
|---|---|
| 已自动检测：无法连接 http://127.0.0.1:8787… | 跑 `npm run dev` 或 `npm run llm:proxy` |
| 已自动检测：本地代理正常（…），但仍请求失败 | 核对接口地址 / 模型名 / API Key |
| 代理前缀只支持 http:// 或 https://… | 按提示改成 `http://主机:端口` |
| 代理前缀不要带路径… | 只填到端口 |

**一次探测两处复用**（问答控制台的提示 + 「检测代理」面板），否则会出现「测试连接说连不上、
检测代理说正常」的自相矛盾。

### ③ 根因：代理压根没启动

绝大多数情况就是这条 —— 填完前缀就以为完事了。

**修法**：`vite.config.ts` 新增 `llmCorsProxyPlugin`（`apply: 'serve'`），`npm run dev` 顺手拉起代理。

一个实现细节值得记：**回收子进程不能挂在 `server.httpServer` 的 `close` 上**。vite 重启 dev server
（改 vite.config / .env）会先 close 再重跑 `configureServer`，若在 close 时就杀掉子进程，新起的那个可能
撞上尚未释放的端口、以「端口被占用」退出 —— 结果是重启后反而没有代理在跑。改为只在
`process.once('exit')` 回收（Ctrl+C 也走这条）。
端口被占用**不算失败**：退出码 0 + 「已有代理在运行，直接用即可」。

## 顺带修掉一个展示 bug

弹窗里的「实际请求地址」是裸拼接 `${proxy}${endpoint}`，**少了中间那个 `/`**，渲染出
`http://127.0.0.1:8787https://…` —— 显示的地址跟真正请求的不是一回事，排障时反被它带偏。
改为复用 `withProxy`，显示即实际。（这个是靠新建的测试断言 URL 形状才暴露的。）

## 验证

- `tsc -b` ✅ ｜ **37 文件 / 720 测试全绿**（新增 21 条）｜ 改动文件 eslint 干净 ｜ `npm run build` ✅
- `node verify-llm-proxy.mjs` 全部通过：本地上游 8 项确定性断言 + 真实网关 401 转发成功
- 实测 `npm run dev` 后 8787 自动监听，经代理预检返回 204

## 建议

若该网关要给多人用，最好在网关侧（Caddy）直接开 CORS，一次配置省掉每个使用者都得起代理；
本地代理的定位是自己机器上的临时通道。
