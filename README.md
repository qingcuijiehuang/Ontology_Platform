# 本体平台 · Ontology Platform

> **免责与说明**：本项目由 AI 辅助编程开发；基于 MIT 许可的开源项目
> [`microsoft/Ontology-Playground`](https://github.com/microsoft/Ontology-Playground) 二次开发。
> 本仓库在原版基础上做了大量定制：**全中文界面**、**真实数据源接入**、**大模型接地问答**、
> **本地本体库**、**默认浅色主题**等。原版英文说明保留在 [`README.en.md`](README.en.md)。

一个**纯静态、零后端**的 Web 本体（Ontology）工作台：导入 RDF/OWL、接入你自己
的真实数据源（REST / SPARQL / GraphQL / JSON 文件）、在交互式图谱里浏览与编辑本体，
并用大模型针对「本体 + 真实数据」做有依据的检索问答。

![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## 目录

- [它是什么](#它是什么)
- [快速开始](#快速开始)
- [核心功能](#核心功能)
- [路由一览](#路由一览)
- [内置官方本体](#内置官方本体)
- [npm 脚本](#npm-脚本)
- [环境变量](#环境变量)
- [数据存储与隐私](#数据存储与隐私)
- [部署](#部署)
- [项目结构](#项目结构)
- [测试与质量](#测试与质量)
- [文档索引](#文档索引)
- [技术栈](#技术栈)
- [常见问题](#常见问题)
- [贡献 · 许可 · 商标](#贡献--许可--商标)

---

## 它是什么

本体平台把「本体（知识图谱）」和「真实数据」放在同一个界面里：

| 环节 | 说明 |
| --- | --- |
| **看** | Cytoscape 交互式图谱，点击节点在检视器里查看实体、属性、关系与实例 |
| **接** | 把 REST 接口、SPARQL 端点、GraphQL 服务或本地 JSON 文件接入为数据源，并映射到本体属性 |
| **问** | 用自然语言提问，系统把本体结构 + 命中的真实数据行组装成上下文，交给大模型流式作答 |
| **改** | 全屏可视化设计器，从零创建或编辑本体，实时预览、撤销重做、导出 RDF/XML |
| **学** | 「本体学院」13 门课程、61 篇正文文章，含交互式测验与可嵌入的实时图谱 |

几个明确的产品取向：

- **平台不内置任何数据集**。所有实例数据都来自用户自己接入的数据源，
  打开项目时「已接入的数据源」列表是空的，需要自己上传或填写地址。
- **全中文界面**。导航、按钮、提示、目录与课程条目均已中文化；
  本体/实体/属性的**名称保持 RDF 原文**，因此加载、搜索、导出不受影响。
- **默认浅色主题**，可在顶栏切换深色 / 极光 / 绯红。
- **数据不出浏览器**。除你自己配置的大模型请求外，页面不向任何服务器发送数据。

---

## 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20+）
- npm ≥ 9

### 安装与启动

```bash
git clone <本仓库地址>
cd Ontology_Platform
npm install
npm run dev
```

打开 http://localhost:5173 即可。默认载入的本体是 **Fourth Coffee**。

### 生产构建

```bash
npm run build
```

构建流水线依次执行：编译本体目录 → 编译学习内容 → 类型检查 → 打包应用 →
打包嵌入组件，产物输出到 `build/`（其中嵌入组件在 `build/embed/ontology-embed.js`）。

```bash
npm run preview   # 本地预览构建产物
```

### 跑测试

```bash
npm test              # 单次全量
npm run test:watch    # 监听模式
npm run test:a11y     # 只跑无障碍 / 主题对比度相关
```

> ⚠️ **类型检查请用 `npx tsc -b`**。根 `tsconfig.json` 是纯 project references 配置，
> 直接跑 `npx tsc --noEmit` 什么都不会检查，会给出「类型没问题」的假象。

---

## 核心功能

### 一、数据源接入（真实数据）

「接入数据源」面板只提供两种方式，数据全部来自用户自己：

1. **自动解析**：上传或拖入一份本地 JSON 文件，系统自动解析数据行、识别列名、
   **猜测对应的本体实体**并**自动生成列映射**，确认后接入。识别不准时可手动切换实体，
   映射会实时重算。
2. **手动填写**：填入数据源地址接入，类型默认为 **JSON 文件**，也支持
   REST API / SPARQL / GraphQL。

**支持的数据形态**

- 对象数组，以及 `items` / `rows` / `results` / `data` 包装 → REST 常见的 `{ data: [...] }`；
- GraphQL 的 `{ data: { 字段: [...] } }` 嵌套包装；
- SPARQL JSON 的 `results.bindings`；
- 单个对象，带 BOM 的文件也能解析。

**多实体分桶图（`objects` + `relationships`）**

本体导出 / 图数据库 dump 常见的形态是「一桶一张表」：

```json
{ "metadata": {}, "objects": { "TestCase": [ /* 行 */ ] }, "relationships": [ /* 三元组 */ ] }
```

这类文件**按桶展开**，而不是被当成「一行数据」：

- 预览里列出每个实体桶（行数 / 列数 / 匹配到的本体实体），可逐个勾选要接入哪些桶；
- **一个桶 = 一个数据源**，名称形如 `文件名 · 桶名`；
- 桶名优先与本体实体名匹配（`Test_Case` ≡ `TestCase`，`Requirement_Document` 也能命中
  `Requirement`），且一个实体只会被一个桶占用；桶名明显是实体名却匹配不上时
  **不会**退化成列名硬猜，避免把「测试用例」误映射到毫不相干的实体；
- `relationships` 可单独勾选，接成一个关系数据源（`文件名 · relationships`）；
- 重复上传同一份文件时**原地刷新**对应数据源，不会堆出重复项。

**其他约束**

- 数据只存在浏览器内存里，**不上传任何服务器**，因此离线可用、也不受 CORS 限制；
  代价是刷新后需重新上传（与手动添加的数据源一致）。
- 单文件上限 8 MB、最多保留 5000 行，超出会截断并在预览里明确提示。
- 非 JSON 内容（CSV / JSON Lines / 纯文本）会给出可执行的中文提示，而不是静默失败。

接入的数据会在右侧「实例浏览」中以表格展示，并按数据源声明的**列映射**把源系统字段
翻译成对应的本体属性，同时被智能问答自动引用。

详见 [数据源接入指南](docs/default-data-sources.md)。

### 二、智能检索问答（大模型接地问答）

图谱下方的检索问答控制台，一次提问的完整链路：

1. **本地图谱检索**：先用内置检索引擎对本体做相关度排序，命中的实体与关系**立刻在图谱上加亮**（这一层不依赖大模型）；
2. **数据接地**：并行拉取已接入数据源的真实数据行，按问题相关性召回（**没有命中就注入 0 行，绝不拿无关数据凑数**），连同「源列 → 本体属性」映射一起注入提示词；
3. **大模型作答**：以流式方式调用所选厂商的 `/chat/completions`，回答下方列出「依据本体 / 依据数据集 / 图谱命中」与耗时、上下文字符数。

**能力与细节**

| 能力 | 说明 |
| --- | --- |
| 支持厂商 | OpenAI GPT、DeepSeek、智谱 GLM、通义千问 Qwen、Kimi（月之暗面）、硅基流动 SiliconFlow、本地 Ollama，以及任意 OpenAI 兼容的自建网关 |
| 自定义系统提示词 | 面板标题栏「提示词」按钮可改写 Agent 的系统提示词（预填默认值，方便在其基础上改），回答始终基于「系统提示词 + 本体知识图谱 + 真实数据集」 |
| 多轮对话 | 支持连续追问，最近 **3 轮**成功的大模型问答会作为历史注入（本地降级结论不注入，避免误导模型） |
| 优雅降级 | 未配置模型时自动用本地图谱检索引擎给出结论，并引导接入模型 |
| 有据可依 | 提示词要求模型只依据注入的本体与数据作答，数据不足时明确说明缺什么 |
| 检索召回 | 打分 = 问题词 ∩ 列名（+3） / ∩ 单元格值（+1）；中文提问 × 英文数据靠跨语言词表扩展 |
| 空正文自愈 | 思考型模型（`deepseek-reasoner` / `deepseek-v4-flash` 等）会先消耗输出额度做推理，额度用尽时正文为空。客户端识别后**自动把额度放大 4 倍重试一次**，仍失败才提示去调大额度 |

**参数与容错设计**

- 输出上限默认 **8192**（等于平台上限），可在「模型连接」里下调；
- 数值参数（`temperature` / `maxTokens`）在「读 localStorage」「写配置」「发请求前」
  **三处归一化**，脏数据不会发到厂商；
- 「Test 连接」与真实提问**使用完全相同的参数**，避免「测试通过、提问失败」的假阳性；
- 厂商因输出上限参数报 400/422 时，自动**去掉该参数重试一次**，由厂商使用自己的默认值。

> **自建网关连不上？** 这是浏览器 CORS 限制，不是本项目的 bug。自建网关通常不放行
> CORS（`OPTIONS` 预检返回 403 且无 `Access-Control-Allow-Origin`），浏览器会直接抛
> `Failed to fetch`，前端拿不到状态码、**也无法绕过**。解决方式是给网关补上 CORS 响应头，
> 或在「模型连接 → 高级：跨域代理与私有网关」填写一个自备的代理前缀
> （如 `http://localhost:8787`，由你自己的反代补齐 CORS）。

详见 [大模型接入指南](docs/llm-integration.md)。

### 三、本体库与「存入本体库」

- **导入 RDF 后**：导入弹窗内出现「存入本体库」按钮，把这份本体保存到本体库的
  **「我的」**分区（仅存在本浏览器 localStorage），之后在「本体库」里一键重新加载，
  不用再翻找原始 `.rdf` 文件。
- **接入数据源后**：数据源面板顶部的「存入本体库」会把**当前本体 + 已接入的全部数据源**
  一起保存为一个包。之后加载这条记录，**本体与数据源一并恢复**，不必重新配置。

具体边界：

- 保存的是**配置**（地址、类型、Headers、列映射、映射实体），不是数据本身；
- 本地 JSON 文件的**行数据不随库存放**（体积不可控，会撞 localStorage 配额），
  加载后会标记为「需重新上传文件」并给出提示；
- 「导入 RDF → 存入本体库」只涉及本体，**不会覆盖**已保存的数据源配置。

### 四、本体目录（Catalogue）

内置 **71 个**本体条目（官方 44 / 社区 17 / 外部 10），覆盖零售、电商、医疗、金融、
制造、教育、FIBO 金融、媒体、活动等分类。可以按分类筛选、按名称或标签搜索、
一键加载、查看 RDF 原文，每个条目都有可分享的深链路。

条目名称与描述已全部中文化；本体/实体/属性名保持 RDF 原文。

### 五、可视化本体设计器

全屏分栏编辑器，用于从零创建或编辑已有本体：

- 添加实体类型（图标、颜色、类型化属性，可标注主键与单位）；
- 定义关系与基数（一对一 / 一对多 / 多对多）；
- 实时图谱预览，边改边看；
- 撤销 / 重做**最多 50 级**、实时校验（含 Fabric IQ 命名规则校验）；
- 导出 RDF/XML 或 JSON；
- **5 个领域模板**开箱可用（零售 / 医疗 / 金融 / IoT / 教育），每个模板预置 3 个实体与 2 条关系，避免面对空白页。

「提交到社区目录」入口提供引导弹窗：一键下载 RDF 与 `metadata.json`，再走 GitHub PR 流程。
（`src/lib/github.ts` 内置了 GitHub Device Flow 客户端与 OAuth 代理示例，未接入界面。）

### 六、RDF 导入与导出

- **往返保真**：RDF/XML 的 OWL 类、数据类型属性、对象属性与基数都支持导入导出，
  并有自动化 round-trip 测试保证保真度。
- **宽容输入**：兼容 Protégé 等常见工具产出的多种 RDF/XML 写法 ——
  `<owl:Class rdf:about>`、`<rdfs:Class>`、
  `<rdf:Description><rdf:type rdf:resource="…/owl#Class"/>`、
  根元素直接是 `<owl:Ontology>`（无 `<rdf:RDF>` 包裹）、
  以及老式 `http://www.w3.org/2002/07/owl` 命名空间（结尾无 `#`）。
  命名空间比较前会先归一化（`https→http`、去尾部 `#` / `/`）。
- **不静默成功**：Turtle（`.ttl`）、N-Triples、JSON-LD 不是 XML，解析器会识别出来并提示
  「另存为 RDF/XML」，而不是丢一个笼统的解析错误；解析出 0 个类也会明确报错，
  不会假装导入成功。

### 七、本体学院（Ontology School）

`/#/learn` 学习中心，共 **13 门课程 / 61 篇正文文章**：

- **本体基础**（`ontology-fundamentals`，6 篇）：什么是本体 → RDF 与 OWL → Fabric IQ 概念 →
  构建你的第一个本体 → 设计模式 → 如何贡献；
- **领域学习路径**（8 条，各 4 篇）：Fourth Coffee、电商、金融、医疗、制造、高校、
  HR 系统、供应链中断。每条路径逐步搭出一个本体，并嵌入实时图谱展示每一阶段新增的实体；
- **动手实验**（4 个）：IQ Lab 零售供应链（7 步，从 3 个实体做到 15 个实体）、
  FIBO 贷款（5 篇）、FIBO 风险（5 篇）、Zava「从农场到货架」（6 篇）。

每篇文章支持**演讲模式**（按 `##` 切分成幻灯片）与**交互式测验**（即时反馈）。
课程内容有独立的人工评审流程，见 [评审工作流](docs/ontology-school-review-workflow.md)。

### 八、界面与可用性

- **可拖动分栏**：竖直分隔条调整右侧栏宽度（260px ~ 视口宽 − 460px），
  水平分隔条调整问答面板高度（150px ~ 视口高 − 300px）；**双击复位**，
  `Tab` 聚焦后用方向键微调、`Home` 复位；尺寸跨会话保留。
  拖动后 Cytoscape 画布会同步尺寸并自动把节点重新收进可见区域。
- **命令行面板**：任意位置按 `⌘K` / `Ctrl+K` 打开，可跳转本体库、设计器、数据源接入、
  模型连接、导入导出等；按 `?` 直达数据源接入面板。
- **新手导览**：首次访问有聚光引导（顶栏 → 图谱 → 检视器 → 设计器），可勾选「不再显示」。
- **主题**：默认浅色，可切深色 / 极光 / 绯红。图谱画布是**纯色**底色（不带图案），
  让节点与连线的颜色成为唯一视觉信息；主题在首屏渲染前由 `index.html` 内联脚本恢复，
  不会出现深色闪屏。
- **移动端**：≤900px 时右侧栏收进底部 Tab、顶栏收进汉堡菜单、分栏拖拽关闭、
  表格改为可横向滚动；按钮点击区不小于 44px，输入框字号不小于 16px。
- **可访问性**：主题对比度、图谱画布底色等有回归测试锁定（`src/a11y/`）。

### 九、嵌入组件（Embeddable Widget）

构建产物 `build/embed/ontology-embed.js` 是自包含脚本，在任何网页里一个 `<script>` 标签
即可渲染交互式本体查看器：支持深浅主题、多种加载方式（目录 ID / URL / 内联 base64）、
点击查看详情。见 [嵌入指南](docs/embed-guide.md) 与 [嵌入安全模型](docs/embed-security.md)。

### 十、分享链接

顶栏「分享」会把当前本体（及数据绑定）编码进 URL：

```
https://<你的域名>/#/share/<base64 数据>
```

对方打开链接即可还原同一份本体，无需服务端存储。

---

## 路由一览

采用客户端 hash 路由，每个页面都有可分享的 URL：

| 路由 | 页面 |
| --- | --- |
| `/#/` | 首页（默认本体 Fourth Coffee） |
| `/#/catalogue` | 本体目录（可带 `?category=` / `?source=` 筛选） |
| `/#/catalogue/<source>/<slug>` | 指定本体，如 `/#/catalogue/official/cosmic-coffee` |
| `/#/designer` | 可视化设计器（新建） |
| `/#/designer/<source>/<slug>` | 用目录中的本体打开设计器 |
| `/#/learn` | 本体学院 · 课程列表 |
| `/#/learn/<course>` | 课程详情 · 文章列表 |
| `/#/learn/<course>/<article>` | 文章详情（支持演讲模式） |
| `/#/embed/<source>/<slug>` | 嵌入视图（配合 `ontology-embed.js`） |
| `/#/share/<data>` | 打开分享链接携带的本体 |

---

## 内置官方本体

| 领域 | 本体 | 实体 | 关系 |
| --- | --- | --- | --- |
| 零售 | Fourth Coffee | 6 | 7 |
| 电商 | E-Commerce Platform | 5 | 6 |
| 医疗 | Healthcare System | 5 | 6 |
| 金融 | Banking & Finance | 5 | 6 |
| 制造 | Smart Manufacturing | 5 | 5 |
| 教育 | University System | 5 | 6 |

目录条目存放在 `catalogue/{official,community,external}/<slug>/`，每个条目一份
`.rdf` 与一份 `metadata.json`，schema 见 `catalogue/metadata-schema.json`。
**改动目录后必须运行 `npm run catalogue:build`** 才会反映到前端。

---

## npm 脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器（Vite） |
| `npm run build` | 完整构建：编译目录 → 编译学习内容 → 类型检查 → 打包 → 打包嵌入组件 |
| `npm run build:embed` | 只打包嵌入组件 |
| `npm run preview` | 预览构建产物 |
| `npm run catalogue:build` | 编译 `catalogue/` 为前端可用的 `catalogue.json` |
| `npm run learn:build` | 编译 `content/learn/` 的 Markdown 为 `learn.json` |
| `npm run validate` | 校验目录内 RDF 文件合法性 |
| `npm test` / `npm run test:watch` | 运行测试（单次 / 监听） |
| `npm run test:a11y` | 只跑无障碍与主题对比度测试 |
| `npm run lint` | ESLint 检查 |
| `npm run hooks:install` | 安装仓库自带的 git hooks（`git config core.hooksPath .githooks`） |
| `npm run security:setup` | 初始化本地安全工具链 |
| `npm run secrets:scan` | 用 gitleaks 扫描敏感信息泄漏 |
| `npm run preview:ontology:list` | 列出本次改动的目录条目（PR 预览用） |
| `npm run preview:ontology:render` | 渲染本体预览图 |
| `npm run preview:ontology:prepare` | 准备预览资源 |

仓库根目录还有若干**一次性验证脚本**（`verify-*.mjs`），用于对具体修复做确定性复验，
例如 `verify-llm-max-tokens-fix.mjs`、`verify-retrieval-2026-09.mjs`、
`verify-panel-resize.mjs`、`verify-light-theme.mjs`，可按需 `node` 直接执行。

---

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_ENABLE_AI_BUILDER` | `false` | 启用「自然语言生成本体」实验功能（依赖 `api/generate-ontology` 后端） |
| `VITE_ENABLE_LEGACY_FORMATS` | `false` | 启用 JSON / YAML / CSV 等历史导入导出格式 |
| `VITE_BASE_PATH` | `/` | 应用基础路径（GitHub Pages 构建时自动设为 `/<仓库名>/`） |
| `VITE_GITHUB_CLIENT_ID` | *(空)* | GitHub OAuth App 客户端 ID（一键提交目录 PR 用，见 [配置指南](docs/github-oauth-setup.md)） |
| `VITE_GITHUB_OAUTH_BASE` | *(空)* | 外部 OAuth 代理地址（GitHub Pages 部署时使用，如 Cloudflare Worker） |
| `VITE_DEPLOYED_COMMIT_SHA` / `VITE_REPOSITORY` | *(空)* | 构建时注入，页脚展示部署版本与仓库地址 |

---

## 数据存储与隐私

| 数据 | 存放位置 | 是否上传 |
| --- | --- | --- |
| 主题、大模型配置（含 API Key）、系统提示词 | 浏览器 localStorage | 否（API Key 仅随请求头发给你选择的厂商） |
| 本体库「我的」条目（本体 + 数据源配置） | 浏览器 localStorage | 否 |
| 本地 JSON 文件的行数据 | 浏览器内存 | 否（刷新即需重新上传） |
| 目录、课程内容 | 构建产物（静态文件） | — |

因此：**换设备/换浏览器不会自动同步**，需要自行迁移（导出/导入本体库条目与数据源配置）。
公开部署时提醒：**页面本身是公网可访问的**，不要把真实隐私数据写进默认内容里；
本地存储的 API Key 不会外发，但建议生产环境通过最小化代理网关转发请求。

---

## 部署

### Azure 静态 Web 应用（主用）

仓库自带 GitHub Actions 工作流，推送到 `main` 即自动部署：

1. 在 Azure Portal 创建 Static Web App；
2. 关联 GitHub 仓库；
3. 把部署令牌写入仓库 Secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN_GREEN_PLANT_0BB1D2910`；
4. 推送到 `main`，工作流
   `.github/workflows/azure-static-web-apps-green-plant-0bb1d2910.yml` 自动完成构建与发布；
5. PR 会自动创建预览环境（另有 `azure-static-web-apps-review.yml`）。

> ⚠️ **注意 CSP**：`staticwebapp.config.json` 中的 `connect-src` 目前只允许
> `'self' https://github.com https://api.github.com`。部署到 Azure SWA 后，
> 若要**在浏览器里直连大模型厂商 API**（DeepSeek / OpenAI / 自建网关等），
> 需要把对应域名加进 `connect-src`，否则请求会被 CSP 拦截。

### GitHub Pages（适合 fork）

1. Fork 本仓库；
2. **Settings → Pages → Source** 选择 **GitHub Actions**；
3. 推送到 `main`，工作流 `.github/workflows/deploy-ghpages.yml` 会构建并发布到
   `https://<用户名>.github.io/<仓库名>/`。构建时 `VITE_BASE_PATH` 会自动设为
   `/<仓库名>/`，保证资源路径正确。

### 其他静态托管

本项目是纯静态站点，`npm run build` 后把 `build/` 目录交给任意静态托管即可
（Netlify / Vercel / Nginx / 对象存储 + CDN）。因为是 hash 路由，
**无需配置 404 回退规则**。

### 其他 CI 工作流

| 工作流 | 作用 |
| --- | --- |
| `ci.yml` | 代码检查与测试 |
| `secret-scan.yml` | gitleaks 敏感信息扫描 |
| `ontology-preview-render.yml` / `ontology-preview-comment.yml` | 本体改动自动渲染预览图并回评 PR |
| `ontology-school-review-approval.yml` | 课程内容人工评审流程 |

---

## 项目结构

```
Ontology_Platform/
├── src/
│   ├── components/        # React 组件（图谱、问答控制台、设计器、各类弹窗、学习页）
│   │   └── designer/      # 设计器子组件（实体表单、关系表单、模板、提交引导）
│   ├── data/              # 本体模型、检索引擎、设计器模板、数据源与 LLM 厂商预设
│   ├── lib/               # 路由、RDF 解析/序列化、数据集抓取、LLM 客户端、
│   │                      # JSON 自动解析、分享编码、GitHub OAuth、本体库
│   ├── store/             # Zustand 状态（appStore / designerStore）
│   ├── hooks/             # usePanelResize（分栏拖拽）、useRoute
│   ├── a11y/              # 无障碍与主题对比度校验
│   ├── styles/            # 样式（Fluent 风格主题变量）
│   └── types/             # TypeScript 类型
├── catalogue/             # 本体目录：official / community / external + metadata schema
├── content/learn/         # 学习课程目录（Markdown 文章、测验、元数据）
├── scripts/               # 构建期编译器（catalogue、learn）与 RDF 校验
├── api/                   # 可选的 Azure Functions 后端（AI 生成本体、GitHub OAuth 代理）
├── docs/                  # 用户与贡献者文档
├── public/                # 静态资源（编译后的 catalogue.json、learn.json）
├── build/                 # 构建产物（含 embed/ontology-embed.js）
├── .github/               # CI/CD 工作流、AI 技能与提示词、Issue 模板
└── verify-*.mjs           # 一次性确定性验证脚本
```

---

## 测试与质量

- **单元 / 组件测试**：Vitest + Testing Library，当前 **34 个测试文件 / 674 条用例全绿**。
- **无障碍与主题**：`src/a11y/` 下有主题对比度、图谱画布底色等回归测试，
  改动主题相关代码时必须一起改 `:root` 与 `.app-container` 两处的 `light-theme` 类。
- **RDF 保真**：目录编译测试会做 round-trip 校验（RDF → 模型 → RDF）。
- **样式规范**：`scripts/style-validator.ts` 校验设计令牌使用。

本地提交前建议：

```bash
npx tsc -b          # 类型检查（注意：不是 tsc --noEmit）
npm run lint
npm test
npm run build
```

---

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [本体编写指南](docs/authoring-guide.md) | 逐字段说明如何创建适配本平台的本体，含最佳实践与完整示例 |
| [数据源接入指南](docs/default-data-sources.md) | 如何接入自己的数据：JSON 自动解析（含分桶图文件）与手动填写各类端点 |
| [大模型接入指南](docs/llm-integration.md) | 接地问答的工作原理、支持的厂商、CORS 实测结论、自建网关注意事项与安全建议 |
| [提交本体：从设计到 PR](docs/contributing-ontology-from-design-to-github.md) | 贡献者完整流程：设计 → 导出 RDF → 写 metadata → 本地校验 → 提 PR |
| [嵌入指南](docs/embed-guide.md) | 如何把交互式本体组件嵌到任意网页 |
| [嵌入安全模型](docs/embed-security.md) | 嵌入组件的安全边界说明 |
| [GitHub OAuth 配置](docs/github-oauth-setup.md) | 一键提交目录 PR 所需的 OAuth 配置 |
| [学习内容编写指南](docs/learn-content-guide.md) | 如何编写课程、文章、测验与本体嵌入 |
| [课程评审工作流](docs/ontology-school-review-workflow.md) | 课程内容的人工审核与发布流程 |
| [主题编写指南](docs/theme-authoring-guide.md) | 如何接入一个新配色主题：令牌约定、store 与 CSS 步骤、对比度陷阱 |

> `docs/` 下还有若干 `TODO-*.md` 内部规划笔记，不属于对外文档。

---

## 技术栈

- **React 19** + **TypeScript 5**
- **Vite 8** 构建，**Vitest** 测试
- **Cytoscape.js**（fcose 布局）图可视化
- **Zustand** 状态管理
- **Framer Motion** 动效
- **Lucide** 图标
- **sanitize-html** 富文本净化
- **marked** Markdown 编译（构建期）

---

## 常见问题

**Q：打开项目为什么没有任何数据？**
平台不内置数据集，需要自己在「接入数据源」里上传 JSON 文件或填写接口地址。

**Q：上传的本地 JSON 刷新后消失了？**
行数据只存在浏览器内存中（不上传服务器、不受 CORS 限制的代价）。
如需复用，可上传远端 URL 类型的数据源，或用数据源面板的「存入本体库」保存配置后再重新上传文件。

**Q：为什么 `.ttl` / JSON-LD 文件导入失败？**
RDF 导入只支持 RDF/XML。请用 Protégé 等工具另存为 RDF/XML 后再导入。

**Q：模型连接测试通过，提问却报 400？**
通常是「最大输出 Token」超过该模型自身的输出上限。客户端会自动去掉该参数重试一次；
仍失败时把该值调小（如 2048–4096）。

**Q：模型回答「空内容」？**
思考型模型会把输出额度先花在推理上。客户端已内置放大额度重试；仍出现时请把
「最大输出 Token」调大到 4096–8192。

**Q：自建网关一直 `Failed to fetch`？**
网关没放行 CORS，浏览器层面无法绕过。给网关补 CORS 响应头，或填写自备的代理前缀。

**Q：改了 `catalogue/` 或 `content/learn/` 却没生效？**
需要重新运行 `npm run catalogue:build` / `npm run learn:build`（或 `npm run build`）。

---

## 贡献 · 许可 · 商标

- 贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，
  安全策略见 [SECURITY.md](SECURITY.md)。
- 项目内包含面向 AI 编程助手的技能与提示词（`.github/skills/`、`.github/prompts/`、
  `.github/instructions/`），覆盖「导入外部 RDF 到目录」「生成递进式课程模块」
  「社区本体贡献」「主题编写」「示例人名生成」等场景，可让 Agent 稳定地完成这些任务。
- **许可**：MIT，见 [LICENSE](LICENSE)。
- **商标**：本项目可能包含 Microsoft 及第三方项目的商标或标识。对 Microsoft 商标与标识的
  授权使用须遵循 Microsoft 商标与品牌指南；在修改版本中使用不得引起混淆或暗示 Microsoft 背书。
  其他第三方商标与标识的使用同样受其各自政策约束。
