# Ontology Platform — 长期记忆

**仓库** `E:\Deployment_of_open_source_projects\Ontology_Platform`｜**默认本体** Fourth Coffee
**目标** Web 可交互本体平台：全中文；真实接入 RDF/REST/SPARQL/GraphQL；可选 LLM 做「本体+数据」检索问答。
**风格** 极简 + 中等留白 + 偏大字号；微软 Fluent 色系；颜色一律 `var(--xxx)`；弹窗居中 dim 遮罩、圆角 12–16px；中文全角标点、末尾不留空格。

## 关键路径
| 文件 | 作用 |
| --- | --- |
| `src/store/appStore.ts` | Zustand：`currentOntology`/`endpoints`/`llm`/`theme`/`aiSystemPrompt` |
| `EndpointConnector` · `InstanceBrowser` | 数据源接入 / 实例浏览 |
| `AIQueryConsole` · `LlmConnector` · `SystemPromptModal` | 智能问答 / 模型连接 / 提示词弹窗 |
| `jsonAutoImport` · `datasetFetcher` | JSON 解析纯函数层 / 行抓取 |
| `rdf/parser` · `queryEngine` | RDF 导入 / 本地检索召回 |
| `userOntologyLibrary` · `data/{ontology,llmProviders}` | 本体库「我的」 / 本体与 8 厂商预设 |

## 产品形态
**不内置任何数据集**（2026-09-18 定稿）：`dataSources.ts`、`public/sample-data/` 已删（备份 `.workbuddy/backup/`）。
面板只有「手动填写（类型下拉 **JSON 文件默认且第一**）」与「自动解析」；`buildDefaultEndpoints()` 恒 `[]`；
store 无 `addPreset`/`presetId`/`isDefault`。`InstanceBrowser` 空态仍展示**本体自带** `sampleInstances`（与数据源预设是两回事）。

**本体库「我的」= 本体 + 数据源一个包**（`StoredUserOntology.endpoints?`）：导入 RDF 后**不自动关弹窗**（要留时间点
「存入本体库」）；条目 = `CatalogueEntry` + `source:'local'` + `savedAt`，Gallery 用 `[...userEntries, ...catalogue]` 合并。
- **`saveUserOntology(ontology, bindings, endpoints?)` 的 endpoints 三态必须守住**：不传 = 不动已存的（导入路径）；
  传数组（含 `[]`）= 整体替换（数据源面板）；首次且不传 → 保持 `undefined` 而非 `[]`，否则加载会清空用户当前数据源。
- 入库剥离 `localRows`（打 `needsFileReupload`）与运行时抓取状态；`fetchEndpointRows` 见 `needsFileReupload`/`local://`
  **不发请求**，直接给中文提示。
- **时间戳双坑**：`id` 只用 `Date.now()` 会同毫秒碰撞（加随机后缀）；`savedAt` 必须单调递增（`max(now, 最大值+1)`）。
- 本地条目**加载时不要 navigate 深链**（`#/catalogue/<id>` 查不到会被 App 弹回）；直接 load + close。
- 「推送到 Microsoft Fabric」已移除（组件与 `lib/fabric.ts` 保留但未挂载）。

## 工程约定
**RDF 导入：宽容输入、严格输出**（`rdf/parser.ts`）：至少吃下 `<owl:Class rdf:about>` / `<rdfs:Class>` /
`<rdf:Description><rdf:type …owl#Class/>` / 根元素直接是 `<owl:Ontology>` / 旧式命名空间 `…/2002/07/owl`（结尾无 `#`）。
命名空间比较**先归一化**（`https→http`、去尾部 `#` `/`）；遍历用自写 `walk()`（含 root 自身）——
`getElementsByTagNameNS` 不含调用元素自身，会把「根就是 owl:Ontology」判空。Turtle/N-Triples/JSON-LD 在 DOMParser
**之前**拦截并提示「另存为 RDF/XML」。**别静默成功**：解析出 0 个类当成功比报错更困惑。

**主题：默认浅色**：`getInitialTheme()` 在「无存储」「脏值」下一律回落 `light`，只迁移 `darkMode === 'true'`
（警惕 `Number('') === 0`：空值 ≠ 0）。`.light-theme` 必须**同时**挂 `:root`（index.html 首屏脚本）与
`.app-container`（`themeClass()`）——**这两处是一对，改一个必须改另一个**。`THEME_OPTIONS` 里**「浅色」必须排首位**
（菜单与键盘循环都遍历该数组，只改一处）。画布 = 纯色 `--graph-bg`，**底色必须不透明**。
回归锁：`appStore.theme.test.ts` + `a11y/graphCanvasTheme.test.ts`。

**本地 JSON 接入**：靠 `DataEndpoint.localRows` + `localFileName`，**不要用 `data:` URL**；前提是 **`endpoints` 未持久化**
（写进 localStorage 就得换 IndexedDB）。`pickRows` 必须同时吃下 `{data:[…]}`（REST）与 `{data:{字段:[…]}}`（GraphQL）。
`jsonAutoImport.ts` 纯函数、不碰 DOM：列名先归一化（`customer_id` ≡ `customerId` ≡ `Customer ID`）再比属性名
（同名 3 / 包含 1.5 / 主键 +1）；**实体识别门槛 ≥2 列且 ≥4 分**，达不到返回 `null` 让人选；列映射按分降序**贪心分配**；
「映射覆盖率」等**在 UI 侧实时算**。**分桶图 JSON**（`{objects:{实体名:[行…]}, relationships:[…]}`）必须**按桶展开**，
否则走单对象兜底 → 1 行 3 列无效数据。桶容器键 `objects`/`entities`/`instances`/`nodes`（**故意不含 `data`**）；
桶名完全同名 6 / 包含 3 分，贪心一实体一桶；**桶名像实体名却匹配不上时禁止退化成列名硬猜**。一桶 = 一数据源，同名原地刷新。
**jsdom 的 `File` 没有 `.text()`** → 统一走 `FileReader`。

**LLM 参数**：持久化数值必须**三处归一化**（读 localStorage / 写配置 / 构造请求前，见 `sanitizeLlmConfig`）。
健康检查与真实请求**必须同参**，否则「测试通过、功能失败」。参数类 400/422 可一次性降级重试；**401/429/5xx 不重试**。
`max_tokens` 收敛 `[1, 8192]`；OpenAI `gpt-5*`/`o` 系列用 `max_completion_tokens`。

**智能问答 · 多轮 + 系统提示词**：`buildChatMessages` 支持 `systemPrompt?`（**整体替换** `DEFAULT_SYSTEM_PROMPT`）
与 `history?`（过滤非法角色/空内容）；本体+数据接地照常注入 user 消息。store `aiSystemPrompt`（空串=默认，≤8000 字符）；
按钮「提示词」在面板头右侧、模型 chip 左边。多轮只带**最近 3 轮且 `engine==='llm'`** 的问答（本地降级结论会误导模型）；
归档时机在 handleAsk 开头。

**检索召回：无下限 / 大上限**（`selectRelevantRows`）：打分 = 问题 token ∩ 列名 +3 / ∩ 单元格值 +1，
**没命中返回 0 行，绝不补齐**；**严禁加「人人有份」的兜底加分**，否则 `0 行` 语义失效。
中文提问 × 英文数据靠 `CROSS_LINGUAL_TERMS` + `expandCrossLingualTokens()`。

**跨域 / 私有网关**（2026-09-18 曾整套实现「本地 CORS 代理」，同日**按用户要求全部回退**，备份在
`.workbuddy/backup/2026-09-18-cors-proxy-revert/`）。留下的**事实性结论**（与带不带代理无关）：
- `Failed to fetch` 是**响应到达 JS 之前**的失败，前端拿不到状态码、**也无法绕过**；**`curl` 正常 ≠ 浏览器正常**。
- 自建网关普遍不放行 CORS：`OPTIONS` → **403 且无 `Access-Control-Allow-Origin`**，而 `POST` 本体正常。
- 代理前缀是**手填**的：`127.0.0.1:8787` 拼出来**不是绝对 URL**、`localhost:8787` 会被当成 scheme 为 `localhost:` 的地址
  —— 两者都只抛 `Failed to fetch`，**报错完全不指向原因**。展示地址必须与请求构造**共用同一个拼接函数**
  （裸拼接会少中间那个 `/`，显示与实际不符，排障时反被带偏）。

**UI 细节**：可撤销的状态标签要做成**按钮**（「已接入」点击即断开，hover 换红色「断开」；分组同理）。顶栏 action 区不换行，
**图标按钮定宽（34–40px）、文字按钮宽度随文案走**；`≤900px` 隐藏走汉堡菜单，`≤1200px` 压缩 gap/图标/padding；
入口顺序 **模型连接 → 接入数据源**。「把 A 放到 B 左边」= 调整 JSX 子元素先后，**不要用 `order`/`row-reverse`**
（可访问性顺序会与视觉顺序脱钩）；断言用 `compareDocumentPosition`。「模型连接」按钮：未配置 = 中性底，
已配置 = 实心 `--ms-green` + 白字，**没有状态点**。`usePanelResize.ts` 需 `resolveStartSize`；正向一侧默认 `reverse: true`；
持久化校验「有限正数」；图谱类组件配 `ResizeObserver` 主动 `cy.resize()` + `cy.fit()`。
71 条 `catalogue/**/metadata.json` 的 `name`/`description` 已中文化；改完必须 `npm run catalogue:build`；
分类标签统一走 `CATEGORY_LABELS`。

## 已知踩坑
- ⚠️ **根 tsconfig 是纯 references：`npx tsc --noEmit` 什么都不查** → 验证类型必须 `npx tsc -b`（或 `npm run build`）。
- **同一文件在一条消息里发多个 Edit 会竞态丢写**（工具报成功但没落盘）→ 同文件多次编辑**必须串行**，改完 `grep` 复核。
  大批量替换更稳：写 Python 脚本做「匹配数必须 ==1 否则整体退出」的确定性替换。坑：用「起止标记」切区间会
  **连带吃掉上一段的 `});`** → 改完必跑 eslint 看 parsing error。
- **删 JSX 块易留孤立开标签**：tsc 不报、eslint 报 parsing error。
- **测试里同步断言会跑在重渲染之前**（zustand + React 19）→ 用 `findByText`；按钮可访问名可能撞车
  （`.ai-console-toggle` 含「检索」→ 改取 `.ai-send-btn`）。
- 备份测试文件进仓库目录会被 vitest 扫到 → 改名 `*.bak`。
- **全量 `npx vitest run` 可跑**（2026-09-18 回退后：**34 文件 / 665 测试全绿**）。`compile-catalogue.test.ts` 会
  `execSync` 起子进程（4–12s），vitest 默认 5s 超时**必然抖动**，已给该 `it()` 加 `60_000`。
- **沙箱**：`readFileSync(new URL(...))` 报 `The URL must be of scheme file` → 用 `resolve(process.cwd(), …)`；
  Node https 出网会抖动（TLS 被断）而同一时刻 `curl` 正常 → 网络验证**必须用本地上游**做确定性断言；
  `(cmd &)` 起的后台进程随工具调用结束被回收 → 起进程 / 断言 / 清理要在**同一次调用内**完成；
  **Playwright / Chromium 起不来**（静默拦截）→ 渲染类验证写成 vitest 静态断言。
- `src/lib/router.ts` 有 3 处**预存** `no-case-declarations` eslint 错误（未修，不影响 build）。
- **id 注记工具会往 HTML 属性值里注入 `data-page-node-id`**（认不出 `href` 里的内联 SVG）→ parse5 报
  `missing-whitespace-between-attributes`。内联 SVG 的 data URI 必须**整体 URL 编码**，属性值外层用单引号；
  复检用 `require('parse5').parse(html, { onParseError })`（**tsc / vitest 都不解析 .html**）。
- **DBpedia SPARQL** 当前网络超时 → 改用 Wikidata（咖啡 P31=Q8486、咖啡馆 Q30022、咖啡公司 Q4830453+P452=Q8486）。

## 公网部署
localStorage 里的 LLM Key 不会外发，但页面公网任何人可打开：Demo 用预设空 Key；生产建议加最小 server 代理网关。
