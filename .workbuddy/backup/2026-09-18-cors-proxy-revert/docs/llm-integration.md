# 大模型接入与智能检索问答（LLM Integration Guide）

本平台把「本体知识图谱 + 已接入的真实数据集」作为**唯一依据**交给大模型作答，
因此回答不是泛泛的闲聊，而是可追溯到具体实体、属性、关系与数据行的检索结论。

- 入口：右上角 **模型连接** 图标（AI 芯片形状，带状态圆点）
- 回答位置：**知识图谱正下方**的「智能检索问答」控制台
- 命令面板：`⌘K` / `Ctrl+K` → 「模型连接（大模型 API）」

---

## 一、支持的厂商

所有厂商统一使用 **OpenAI 兼容协议**：`POST {接口地址}`，请求头
`Authorization: Bearer <apiKey>`，请求体 `{ model, messages, temperature, stream }`。
因此切换厂商只是换一个接口地址与模型名。

清单最后同步：**2026-09**，开源厂商普遍在持续发版，本仓库每 1-3 个月会刷新一次。

| 厂商 | 默认模型 | 推荐型号（UI 高亮） | 接口地址 | 适用说明 |
|---|---|---|---|---|
| `openai` OpenAI GPT | `gpt-5-mini` | `gpt-5` · `gpt-5-mini` · `gpt-5-nano` · `gpt-5-pro` | `https://api.openai.com/v1/chat/completions` | 综合首选；`gpt-5-pro` 最强但单价 8 倍 |
| `deepseek` DeepSeek | `deepseek-v4-flash` | **`deepseek-v4-flash`** · **`deepseek-v4-pro`** · `deepseek-chat` · `deepseek-reasoner` | `https://api.deepseek.com/chat/completions` | **V4 系列**：Flash 性价比高、Pro 强推理（1.6T/49B 激活） |
| `zhipu` 智谱 GLM | `glm-4.7` | **`glm-4.7`** · **`glm-4.7-flash`**（免费） · `glm-5` · `glm-5-turbo` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | GLM-5 对齐 Claude Opus 4.5；GLM-4.7-Flash 免费试 |
| `dashscope` 通义千问 Qwen | `qwen3.7-max` | **`qwen3.8-max`** · `qwen3.7-max` · `qwen3-max` · `qwen-plus` · `qwen-flash` | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | Qwen3.8-Max 是 2026-08 旗舰；Flash 实时高并发 |
| `moonshot` Kimi | `kimi-k3` | **`kimi-k3`** · `kimi-k2.5` · `kimi-k2-thinking` | `https://api.moonshot.cn/v1/chat/completions` | kimi-k3 是当前主推；kimi-k2 系列已 2026-05 下线 |
| `siliconflow` 硅基流动 | `deepseek-ai/DeepSeek-V4-Flash` | `deepseek-ai/DeepSeek-V4-Flash` · `-V4-Pro` · `Qwen/Qwen3-Max` | `https://api.siliconflow.cn/v1/chat/completions` | 一个 Key 调用各家开源；V4 直通 |
| `ollama` 本地 Ollama | `qwen3:8b` | `qwen3:8b` · `deepseek-v4-flash:8b` · `llama3.2:8b` | `http://localhost:11434/v1/chat/completions` | 离线可用，需先 `ollama pull <name>` |
| `custom` 自定义 | 由用户填写 | 由用户填写 | 由用户填写 | One-API / vLLM / SGLang / 公司网关 |

> 模型清单右上角 `模型连接` 弹窗中，每家厂商卡片下方会同时显示
> 「📅 清单更新：YYYY-MM」与「🔗 厂商最新模型清单」按钮（指向该厂商官方文档），
> 方便快速核对最新版本。

## 一·B 模型新鲜度说明

各家模型迭代节奏很快（DeepSeek V4-Flash 一个月更新一个 Build，Qwen 每两月升一档），
本项目 `src/data/llmProviders.ts` 中的 `lastUpdated` 字段记的是该厂商预设的最近一次同步月份。
**当 UI 显示的清单比厂商官网落后时**：

1. 翻到弹窗内 `厂商最新模型清单` 链接，点开核对当前可用模型名；
2. 直接在「模型名称」输入框内手填新模型 ID，回车即可（datalist 不强行限制）；
3. 给我们提个 PR 或在 Issue 里通知我们刷新预设。

这种"配置 + 检查入口"模式比「写死最新模型名再发版」更经得起迭代：
代码不需要每天追厂商发版节奏，用户看到 `lastUpdated` 自然知道数据是否太旧。

模型名称支持自由输入，不限于预设列表（面板中会给出常用模型快捷按钮）。

## 二、使用步骤

1. 点击右上角 **模型连接** 图标。
2. 选择厂商（卡片网格）；接口地址与默认模型会自动填充。
3. 填写 **API Key**（可点眼睛图标核对，面板只显示掩码 `sk-ab****klmn`）。
4. 选择或输入 **模型名称**；按需调整温度（检索问答建议 `0 ~ 0.3`）与最大输出 Token。
5. 点击 **测试连接** —— 平台会真实调用一次接口并显示耗时与模型回复。
6. 点击 **完成**，回到图谱下方的控制台直接提问。

配置保存在浏览器 `localStorage`（键名 `ontology-platform.llm-config`），
刷新页面后仍然生效；面板底部的 **重置** 会清空 Key 并恢复默认厂商。

## 三、一次提问发生了什么

```
用户提问
  │
  ├─① 本地图谱检索（不依赖大模型）
  │     queryEngine 对实体名/描述/属性/关系做相关度打分
  │     → 命中实体与关系立即在图谱上加亮，并作为「图谱命中」提示注入提示词
  │
  ├─② 数据接地 Grounding
  │     并行拉取已接入数据源的真实数据行（单个数据源最多抓取 400 行候选）
  │     再按「问题相关性」筛选：列名命中 +3/token、单元格值命中 +1/token
  │       · 有命中 → 按分数降序注入，至多 120 行/源算作兜底上限
  │       · 无命中 → 注入 0 行（不补齐、不兜底），并注明「本次不注入任何行」
  │     中文提问会自动补英文术语（延迟→delayed、货运→shipment、铂金→platinum…），
  │     避免「中文提问 × 英文数据」被判成 0 命中
  │     命中实体对应的数据源优先，最多取 6 个数据源（60 秒缓存）
  │     同时带上「源列 → 本体属性」列映射，让模型知道字段的业务含义
  │
  ├─③ 组装上下文
  │     系统提示：只能依据本体与数据集作答、严禁编造、数据不足要说明缺什么、
  │               结构化输出（先结论后依据）、使用简体中文
  │     用户消息：本体结构 + 真实数据集 markdown 表格 + 本地命中 + 用户问题
  │
  ├─④ 流式调用大模型
  │     解析 SSE（data: {...} / [DONE]），逐段渲染，支持「停止」中断
  │
  └─⑤ 展示依据
        引擎（模型名 / 本地引擎）、耗时、上下文字符数、
        依据本体、依据数据集（行数、映射实体、失败原因）、图谱命中 chips（可点击定位）
```

### 相关性召回策略（无下限 / 大上限）

注入上下文的数据行**不再按原始顺序截前 N 行**，而是按问题相关性动态决定：

| 维度 | 规则 |
|---|---|
| 打分 | 问题 token ∩ 列名（源列名 + 本体映射名）= **+3**；∩ 单元格值 = **+1** |
| 无下限 | 没有任何行命中 → **注入 0 行**，上下文里明确写「该数据源中没有与问题相关的行，本次不注入任何行」 |
| 大上限 | 命中多少给多少，仅保留一个宽松兜底上限（`ROWS_PER_ENDPOINT = 120`）防止单表撑爆上下文 |
| 抓取候选 | 单源抓 400 行（`FETCH_ROWS`）作为筛选池，避免候选池太小筛不出东西 |
| 跨语言 | 问题出现中文术语时自动补英文别名（延迟→`delayed`、货运→`shipment`、铂金→`platinum`…），解决「中文提问 × 英文数据」的 0 命中 |

> 为什么无下限：早先的实现会在命中不足时用原始顺序「补齐 N 行」，
> 结果是无关行被塞进上下文，稀释了有效信息、也容易带偏模型。
> 现在的取舍是「宁可不给数据，也不给噪声」——模型看到
> 「本次不注入任何行」会明确回答「该数据源中没有与问题相关的记录」，
> 而不是编造，也不会误判成「这张表是空的」。

可在 `src/components/AIQueryConsole.tsx` 顶部调整 `MAX_ENDPOINTS` / `ROWS_PER_ENDPOINT` / `FETCH_ROWS`
三个常量，控制数据源个数、单源注入上限与候选池大小。

### 面板高度可拖动

控制台默认高度由内容撑开（答案多长、面板多高）。如果觉得一次能看到的内容不够，
拖动控制台上沿那条**水平分隔条**即可把面板调高：

- 拖动范围 `150px ~ 视口高度 − 300px`，上限保证图谱区不会被挤到看不见；
- 面板一旦被拖动过就切为固定高度，超出部分在面板内部滚动（`.ai-console-body` 自带 `overflow-y: auto`）；
- **双击分隔条**或按 `Home` 复位，回到「内容自适应高度」；
- 尺寸记在 `localStorage` 的 `wb_panel_size_ai-console-height`，刷新后保留；
- 窄屏（≤900px）不分栏，面板回到自适应。

实现见 `src/hooks/usePanelResize.ts`（与右侧栏宽度共用同一套拖拽逻辑）。

### 降级策略

| 场景 | 行为 |
|---|---|
| 未配置模型 | 直接返回本地检索引擎结论，并提示「接入模型可获得基于数据集的自然语言回答」 |
| 大模型调用失败 | 展示错误原因 + 中文排查建议，同时保留本地检索结论，保证始终有输出 |
| 输出上限参数被拒绝（400/422） | 自动去掉 `max_tokens` 重试一次，由厂商使用默认值，用户无感 |
| 数据源拉取失败 | 该数据源在「依据数据集」中标红显示失败原因，其余数据源与本体照常注入 |
| 某数据源与问题无关 | 该源注入 0 行，「依据数据集」chip 显示 `0 行`，上下文中注明「本次不注入任何行」 |
| 正在生成 | 显示「停止」按钮，可随时中断；回答区带光标动画 |

## 四、跨域（CORS）实测结论

浏览器直连大模型接口需要厂商放行跨域。本次实测结果（`OPTIONS` 预检）：

| 接口 | 是否放行 | 说明 |
|---|---|---|
| `api.openai.com` | ✅ | `Access-Control-Allow-Origin` 回显请求来源 |
| `api.deepseek.com` | ✅ | 允许 `authorization, content-type` |
| `open.bigmodel.cn` | ✅ | 允许 `POST` |
| `dashscope.aliyuncs.com` | ✅ | `Access-Control-Allow-Origin: *` |
| `api.moonshot.cn` | ✅ | 允许 `authorization,content-type` |
| `api.siliconflow.cn` | ✅ | `Access-Control-Allow-Headers: *` |
| 自建网关 / One-API / new-api / 自研 Caddy-Nginx 反代 | ❌ **通常不放行** | 实测常见表现：`OPTIONS` 直接 **403** 且响应无 `Access-Control-Allow-Origin`（只处理 `POST`）。此时浏览器必抛 `Failed to fetch`，**只能在客户端走本地代理** |

因此**无需自建后端**即可在浏览器中直连上述厂商。
注意：实际可用性还取决于你所在网络能否访问该域名（例如 OpenAI 在部分网络下不可达）。

### 私有网关 / 内网模型 / 跨域被拦截时

#### 先判断是哪一种失败

浏览器直连私有网关失败时抛的都是同一句 `TypeError: Failed to fetch`，
但**原因完全不同**，处理方式也完全不同：

| 现象（实测） | 真正原因 | 处理 |
|---|---|---|
| `OPTIONS` 预检返回 **403**，且响应不带 `Access-Control-Allow-Origin` | 网关**没开 CORS**。预检在响应到达 JS 之前就被拒，页面里拿不到状态码 | **必须走本地代理**（下方方案），客户端无法绕过 |
| `OPTIONS` 正常但 `POST` 无 CORS 头 | 网关只给预检放行、没给实际响应放行 | 同上 |
| 直连 `curl` 正常、浏览器失败 | 同上（`curl` 不做 CORS 检查，不能用来判定） | 同上 |
| 域名解析不了 / 超时 | 网络不可达（内网地址、需要 VPN） | 先解决网络；本地模型改用 Ollama |

自查命令：

```bash
curl -i -X OPTIONS "https://你的网关/v1/chat/completions" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
# 期望 2xx + Access-Control-Allow-Origin；返回 403 且无该头 → 网关未开 CORS
```

#### 方案 A：用仓库内置的本地 CORS 代理（推荐）

本项目自带一个**零依赖**的本地代理 `scripts/llm-proxy.mjs`，专门补上缺失的 CORS 响应头。

**`npm run dev` 已默认把它一起启动** —— 连不上自建网关时绝大多数情况不是配置错，而是
代理压根没起（填完前缀就以为完事了）。用 `LLM_PROXY_DISABLE=true` 可关掉这段自动启动；
端口被占用不算失败，会按「已有代理在跑，直接用」处理并正常退出。

也可以让它单独常驻：

```bash
npm run llm:proxy        # 监听 http://127.0.0.1:8787
```

然后在「模型连接 → 高级：跨域代理与私有网关」里点**「填入本地代理」**（会自动填
`http://127.0.0.1:8787`），再点**「检测代理」**确认代理确实在跑。平台会把最终地址拼成
`${代理前缀}${接口地址}`：

```
代理前缀：http://127.0.0.1:8787
最终请求：http://127.0.0.1:8787/https://你的网关/v1/chat/completions
```

#### 两层防呆（都来自真实事故）

**① 前缀自动归一化。** 代理前缀是手填的，下面两种最常见写法过去都会让请求**静默地**
变成 `Failed to fetch`，而报错完全不指向真实原因：

| 你填的 | 过去会发生什么 | 现在 |
|---|---|---|
| `127.0.0.1:8787` | 拼出来不是绝对 URL，`fetch` 抛 Invalid URL | 自动补成 `http://127.0.0.1:8787` |
| `localhost:8787` | 被 URL 解析器当成 scheme 为 `localhost:` 的地址，fetch 只认 http/https | 同上 |
| `http://127.0.0.1:8787/llm` | 拼到代理上不存在的路由 | 输入框下方**当场提示**「不要带路径」 |

界面上的「实际请求 …」展示的就是真正会请求的地址（与请求构造共用同一个函数）。

**② 失败自动诊断。** 请求以网络类错误失败且已配代理时，平台会**自动探测**代理的
`/__health` 并给出确定结论，而不是只回一句「网络请求失败」：

| 自动结论 | 含义 | 你该做什么 |
|---|---|---|
| 已自动检测：无法连接 http://127.0.0.1:8787… | 代理没启动 / 端口不符 | 跑 `npm run llm:proxy`，或直接 `npm run dev` |
| 已自动检测：本地代理正常（…），但仍请求失败 | 代理这一侧没问题 | 核对「接口地址」「模型名称」「API Key」 |
| 代理前缀只支持 http:// 或 https://… | 协议写错 | 按提示改成 `http://主机:端口` |
| 代理前缀不要带路径… | 前缀多写了路径 | 只填到端口 |

> 为什么必须自动：浏览器对「CORS 被拦」与「服务连不上」都只抛一句
> `TypeError: Failed to fetch`，状态码与报错原文一概拿不到。这句话同时对应
> 「代理没起 / 前缀写错 / Key 不对 / 网关路径不对」四种成因，修法各不相同 ——
> 由代码探测后给结论，比让用户自己去点「检测代理」猜一次可靠得多。

可配置项：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | **只绑定回环地址**，不要把带 Key 的转发通道暴露到局域网 |
| `LLM_PROXY_ALLOW` | 空（放行任意上游） | 上游域名白名单，逗号分隔，如 `api.qingcuicore.com` |

代理的行为边界：

- 转发 `GET/POST/PUT/PATCH/DELETE`，**SSE 逐段直通**（强制 `accept-encoding: identity`、
  显式关闭缓冲，否则流式会变成一次性吐出）；
- 预检回显 `Access-Control-Request-Headers` —— 少回一个 `authorization` 就会重演原网关的失败；
- 丢弃上游自带的 CORS 头，避免出现重复值被浏览器判为非法；
- 剥离 `origin` / `referer` 后再转发，绕开部分网关的防盗链校验；
- **不保存任何 Key**，只是把浏览器的 `Authorization` 原样转发。

一键复验（起代理 + 打本地上游 + 探测真实网关）：

```bash
node verify-llm-proxy.mjs
```

#### 方案 B：自建反向代理

已有 Nginx / Caddy / Cloudflare Worker 时可自行加 CORS 头，把代理前缀指向它即可。
注意 Nginx 默认会对 `text/event-stream` 做缓冲，需要显式关闭：

```nginx
location /llm/ {
    proxy_pass https://你的网关/;
    proxy_buffering off;                 # 不关会让流式输出变成一次性返回
    add_header Access-Control-Allow-Origin  $http_origin always;
    add_header Access-Control-Allow-Headers "authorization, content-type" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    if ($request_method = OPTIONS) { return 204; }
}
```

#### 方案 C：直接选「自定义（OpenAI 兼容）」

把接口地址写成自建网关（One-API、vLLM、Ollama+OpenAI 兼容层、公司内网网关等）。
若该网关已放行 CORS，则无需任何代理。

> **注意：https 页面 + http 代理会被「混合内容」拦截。**
> 本地开发（`http://localhost`）不会暴露这个问题，页面部署到 https 后才会出现。
> 浏览器把 `localhost` / `127.0.0.1` 视为潜在可信来源，因此本地代理不受影响；
> 但若代理填的是局域网 IP 或其它域名的 http 地址，部署后会被直接拦掉 ——
> 弹窗会在这种情况下显式警告。

## 五、安全与隐私

- **Key 只存在浏览器**：保存在 `localStorage`，不会上传到本平台的任何服务器。
- **数据流向**：提问时，本体结构、已接入数据集的样本行、以及你的问题会随请求
  发送给你所选择的模型厂商。若数据敏感，请选择本地 Ollama 或私有网关。
- **不预置真实隐私数据**：仓库内置的样本数据均为演示数据（客户 / 订单 / 商品等），
  不含真实个人信息。
- **Key 不进入构建产物**：模型配置保存在运行时 `localStorage`，不参与打包。
- 公开部署的页面任何人都能访问，但**不会**带上你自己的 Key ——
  每个使用者需要在自己的浏览器里配置。

## 六、常见错误与排查

| 提示 | 含义 | 处理 |
|---|---|---|
| 鉴权失败（401/403） | Key 错误 / 过期 / 额度用尽 | 到厂商控制台重新生成 Key |
| 接口或模型不存在（404） | 地址或模型名不匹配 | 核对厂商文档；可用「测试连接」快速验证 |
| 参数被拒绝（400/422） | 模型名不被该接口接受，或参数越界（最常见是 `max_tokens`） | 核对模型名；把「最大输出 Token」调小后重试（见下方专项说明） |
| 触发限流（429） | 请求过频 | 稍后重试，或改用 `glm-4.7-flash` / `gpt-5-mini` 等 |
| 厂商服务异常（5xx） | 上游故障 | 稍后重试或切换厂商 |
| 网络请求失败（跨域/不可达） | 网关未放行 CORS，或域名不可达。**该失败发生在响应到达 JS 之前，页面里拿不到状态码** | 跑 `npm run llm:proxy`（或直接 `npm run dev`）并在「高级」里点「填入本地代理」 |
| 代理已配置但请求仍失败 | 平台会**自动探测代理**并给出确定结论 | 看提示里的「已自动检测：…」：说连不上就去启动代理，说代理正常就去核对接口地址 / 模型名 / Key |
| 代理前缀填写有误 | 协议不是 http(s)，或误带了路径 | 按提示改；漏写 `http://` 会被自动补全，无需手动修 |
| 无法连接本地代理 | 代理进程已退出 | 重新 `npm run llm:proxy`，或换端口后重填前缀 |
| 请求超时 | 模型过慢或数据行过多 | 换更快的模型；减少注入行数（`ROWS_PER_ENDPOINT`） |
| 模型返回空内容 | 上游异常 | 重试或更换模型 |

### 专项：`Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`

这是最容易踩、也最容易误判的一类报错，因为**它不会在「测试连接」时暴露**。

- **原因**：`max_tokens` 的值来自浏览器 `localStorage`。如果历史数据里存了
  `0` / `null` / 字符串 / 超出模型上限的数字，就会被原样发给厂商并返回 400。
  各厂商上限不同（例如 DeepSeek 是 393216，多数模型只有 4096–8192）。
- **为什么测试连接发现不了**：早期版本的「测试连接」把 `max_tokens` 写死成 32，
  测试的是另一套参数，因此出现「测试成功、提问失败」的假阳性。
- **本项目已经做的加固**：
  1. **参数归一化**：`src/data/llmProviders.ts` 的 `normalizeMaxTokens` /
     `normalizeTemperature` / `sanitizeLlmConfig` 会把任意脏值收敛到
     `[1, 8192]`，并在读取 `localStorage` 与写入配置时各执行一次，脏数据自愈；
  2. **请求体兜底**：`buildBody` 发送前再归一化一次，绝不把非法值发出去；
  3. **自动重试**：若厂商仍因输出上限参数报 400/422，客户端会自动**去掉该参数
     重试一次**，由厂商使用自己的默认值，保证提问仍然拿得到回答；
  4. **测试与真实请求一致**：`testConnection` 不再覆盖 `maxTokens`，改用与真实
     提问完全相同的参数，杜绝假阳性；
  5. **推理模型适配**：OpenAI `gpt-5` / `o` 系列在 Chat Completions 上要求
     `max_completion_tokens`，客户端会自动改用该字段名。
- **你可以怎么做**：在「模型连接」里把「最大输出 Token」设为 `2048–4096` 即可
  覆盖绝大多数模型；输入框已限制在 `1–8192`，超范围会被自动收敛。

## 七、成本与效果建议

- **智谱 `glm-4.7-flash`（免费）/ OpenAI `gpt-5-mini` / DeepSeek `deepseek-v4-flash`**
  适合日常检索问答；
- 温度设为 `0 ~ 0.3`，降低幻觉；本平台提示词已要求「只依据上下文作答」；
- 上下文大小由「数据源数量 × 注入行数」决定，控制台会显示**上下文字符数**，
  过大时可减少接入的数据源，或改动 `src/components/AIQueryConsole.tsx` 中的
  `MAX_ENDPOINTS` / `ROWS_PER_ENDPOINT`；
- `deepseek-reasoner` / `gpt-5-pro` 会输出思维链、耗时更长，但对多步推理类问题更稳；
- 「最大输出 Token」建议 `2048–4096`：既能容纳完整回答，又不会因为超过某些模型的
  输出上限而触发 400。

## 八、相关代码位置

| 文件 | 职责 |
|---|---|
| `src/data/llmProviders.ts` | 厂商预设、`LlmConfig`、地址归一化、**代理前缀归一化与写法校验（`normalizeProxyBase` / `proxyPrefixIssue` / `withProxy`）**、配置校验、Key 掩码、**参数归一化（`normalizeMaxTokens` / `normalizeTemperature` / `sanitizeLlmConfig`）** |
| `src/lib/llmClient.ts` | 本体/数据集上下文构建、消息装配、**请求体构造与输出上限兜底（`buildBody`）**、**参数类错误自动重试**、**网络失败的代理自动诊断（`diagnoseProxyFailure`）**、代理探测（`probeProxy`）、混合内容判定、流式与非流式调用、错误分类 |
| `src/lib/datasetFetcher.ts` | 数据源抓取（SPARQL/GraphQL/REST/JSON）与行解析，与「实例浏览」共用 |
| `src/components/LlmConnector.tsx` | 模型连接弹窗与右上角入口图标 |
| `src/components/AIQueryConsole.tsx` | 图谱下方的检索问答控制台（含可拖动高度） |
| `src/hooks/usePanelResize.ts` | 通用拖拽分栏 hook：右栏宽度 + 问答面板高度，夹取 / 持久化 / 复位 / 键盘微调 |
| `src/data/queryEngine.ts` | 本地图谱检索引擎（命中排序 + 降级回答） |
| `scripts/llm-proxy.mjs` | **零依赖本地 CORS 代理**：补预检与 `Access-Control-*`、SSE 直通、`/__health` 健康检查（`npm run llm:proxy`）；端口被占用时按「已有代理在跑」友好退出 |
| `vite.config.ts` | `llmCorsProxyPlugin`：**dev 期自动拉起本地代理**（`apply: 'serve'`，dev server 关闭时回收子进程；`LLM_PROXY_DISABLE=true` 可关） |
| `scripts/llm-proxy.test.ts` | 代理回归测试：URL 还原、白名单、CORS 头、端到端预检/转发/SSE 逐段、npm 脚本名与代理默认地址一致性 |
| `verify-llm-max-tokens-fix.mjs` | `npx tsx` 独立脚本：用 mock fetch 复现并验证 `max_tokens` 越界修复 |
| `verify-llm-proxy.mjs` | `node` 独立脚本：起代理 → 打本地上游（确定性）→ 探测真实网关，一键复验跨域修复 |
