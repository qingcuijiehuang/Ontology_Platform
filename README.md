# 本体平台 · Ontology Platform ☕

> Note: 本项目使用 AI 辅助编程开发。

A free, open-source web application for **browsing, designing, and querying ontologies against real data sources**. Import RDF/XML, connect to public SPARQL endpoints, REST APIs or GraphQL services, and explore the schema through an interactive graph. All from a fully static site with zero backend dependencies.

![Microsoft Fabric](https://img.shields.io/badge/Microsoft-Fabric-0078D4?style=flat-square&logo=microsoft)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

## Features

### 接入真实数据源（Connect to Real Sources）

- **REST API** —— 从任意 RESTful 接口拉取 JSON 数据，可自定义 Headers 与超时。
- **SPARQL** —— 对 RDF 三元组存储（如 DBpedia、Wikidata）执行 SELECT 查询。
- **GraphQL** —— 通过 GraphQL 端点拉取数据，自动解析 `data` 字段。
- **JSON 文件** —— 支持两种方式：填一个可访问的 JSON 文件 URL；
  或在「自定义接入 → 自动解析接入」里**直接上传本地 JSON 文件**。

**自动解析接入（上传本地 JSON）**：选择或拖入一个 `.json` 文件后，系统会自动
解析出数据行、识别列名、**猜测对应的本体实体**并**自动生成列映射**，确认后即可接入。
解析结果会先以预览形式给出（文件名、行数 / 列数、`源列 → 本体属性` 对照表），
识别不准时可以手动切换实体，映射会实时重算。

- 兼容对象数组、`items` / `rows` / `results` / `data` 包装、GraphQL 的 `data` 包装、
  SPARQL JSON 的 `results.bindings`，以及单个对象；带 BOM 的文件也能解析。
- 数据只存在浏览器内存里、**不会上传到任何服务器**，因此离线可用且不受 CORS 限制；
  代价是刷新页面后需要重新上传（与手动添加的自定义数据源行为一致）。
- 单个文件上限 8 MB、最多保留 5000 行，超出会截断并在预览里明确提示。
- 非 JSON 内容（CSV / JSON Lines / 纯文本）会给出可执行的中文提示，而不是静默失败。

**多实体分桶图（`objects` + `relationships`）**：本体导出 / 图数据库 dump 常见的形态是
「一桶一张表」—— 顶层是 `{ metadata, objects: { 实体名: [实例…] }, relationships: [三元组…] }`。
这类文件不再被当成「一行数据」，而是**按桶展开**：

- 预览里列出每个实体桶（行数 / 列数 / 匹配到的本体实体），可以逐个勾选要接入哪些桶；
- 接入时**一个桶 = 一个数据源**，名称形如 `文件名 · 桶名`；
- 桶名优先与本体实体名匹配（`Test_Case` ≡ `TestCase`，`Requirement_Document` 也能命中
  `Requirement`），且一个实体只会被一个桶占用；桶名明显是实体名却匹配不上时**不会**退化成
  列名硬猜，避免把「测试用例」误映射成毫不相干的实体；
- `relationships` 可以单独勾选，接成一个关系数据源（`文件名 · relationships`）；
- 重复上传同一份文件时**原地刷新**对应数据源，不会在列表里堆出重复项。

接入的数据会在右侧"实例浏览"中以表格展示，并按数据源声明的**列映射**把源系统字段
翻译成对应的本体属性，同时被自然语言查询自动引用。

### 数据源接入（Data Source Connection）

平台**不内置任何数据集** —— 「接入数据源」面板只提供两种接入方式，
全部数据都来自用户自己：

1. **自动解析**：上传 / 拖入一份本地 JSON 文件，系统自动解析内容、
   识别本体实体并生成列映射；多实体分桶文件（`objects` + `relationships`）
   会按桶拆成多个数据源。
2. **手动填写**：填入数据源地址接入，类型默认且首选 **JSON 文件**，
   也支持 REST API / SPARQL / GraphQL。

打开项目时「已接入的数据源」列表是空的；面板顶部提供**已接入数**统计、
**「存入本体库」**与**「清空全部」**按钮，随时可以回到空白状态。

**存入本体库**：面板顶部的「存入本体库」会把**当前本体 + 已接入的全部数据源**
一起保存到本体库的「我的」分区（仅存在本浏览器 localStorage）。之后在「本体库」
里加载这条记录，本体与数据源会一并恢复，不用重新配置一遍。

- 保存的是**配置**（地址、类型、Headers、列映射、映射实体），不是数据本身；
- 本地 JSON 文件的**行数据不随库存放**（体积不可控，会撞 localStorage 配额），
  加载后会标记为「需重新上传文件」并给出提示；
- 「导入 RDF → 存入本体库」只涉及本体，不会覆盖已保存的数据源配置。

详见 [Data Source Guide](docs/default-data-sources.md)。

### Ontology Catalogue

A curated library of official and community-contributed ontologies spanning six
domains (Retail, E-Commerce, Healthcare, Finance, Manufacturing, Education).
Browse by category, search by name or tags, load any ontology with one click,
and view its RDF source. Every ontology has a shareable deep link
(`/#/catalogue/official/cosmic-coffee`).

Catalogue UI labels (search, filters, category names) and every entry
description are localised to Chinese. Ontology names, entity names and property
names stay exactly as authored in the RDF, so loading, search, filtering and
export are unaffected.

### 界面主题（Themes）

默认使用**浅色**主题（可在顶栏切换深色 / 极光 / 绯红）。图谱画布是一块**纯色**
浅底（`--graph-bg`），不带任何底色图案，让节点与连线的颜色成为唯一的视觉信息。

主题在首屏渲染前即由 `index.html` 的内联脚本从本地存储恢复并挂到 `<html>` 上，
因此加载过程中不会出现深色闪屏。

### Visual Ontology Designer

A full-screen, split-pane editor for creating ontologies from scratch or
editing existing ones. Add entity types with icons, colors, and typed
properties; define relationships with cardinalities; see a live graph preview
that updates as you work. Includes undo/redo (50 levels), real-time validation,
and export to RDF/XML or JSON.

### RDF Import & Export

Full round-trip support for RDF/XML (OWL classes, datatype properties, object
properties with cardinalities). Import `.rdf` / `.owl` files and verify fidelity
with automated round-trip tests.

**存入本体库（Save to Ontology Library）**：导入成功后弹窗内会出现
**「存入本体库」**按钮 —— 一键把这份本体保存到本体库的「我的」分区
（仅存在本浏览器 localStorage，不上传服务器），之后在「本体库」里随时一键重新加载，
无需再翻找原始 `.rdf` 文件；同名本体再次保存会原地覆盖，条目可删除。

The importer accepts the RDF/XML dialects produced by Protégé and other common
tooling, not just one canonical shape:

- `<owl:Class rdf:about="…">` and `<rdfs:Class rdf:about="…">`
- `<rdf:Description rdf:about="…"><rdf:type rdf:resource="…/owl#Class"/></rdf:Description>`
- a root element that *is* `<owl:Ontology>` (no `<rdf:RDF>` wrapper)
- the legacy `http://www.w3.org/2002/07/owl` namespace without a trailing `#`

Turtle (`.ttl`), N-Triples and JSON-LD are not XML, so they are not supported —
the importer detects them and tells you to re-export as RDF/XML instead of
failing with a generic parse error.

### One-Click Catalogue PR

Sign in with GitHub (device flow) and submit your ontology to the community
catalogue directly from the designer — the app forks the repo, creates a
branch, commits the RDF + metadata, and opens a pull request automatically.

### Embeddable Widget

A self-contained JavaScript file (`ontology-embed.js`) that renders an
interactive ontology viewer on any web page with a single `<script>` tag.
Supports dark/light themes, multiple loading methods (catalogue ID, URL,
inline base64), and click-to-inspect. See the
[Embedding Guide](docs/embed-guide.md) for details.

### Ontology School

A structured learning hub (`/#/learn`) with **9 courses** spanning conceptual
learning paths and hands-on labs:

- **Ontology Fundamentals** — 6 articles covering core concepts (What is an
  Ontology? → RDF/OWL → Fabric IQ → Build Your First → Design Patterns →
  Contributing)
- **7 Domain Learning Paths** — Fourth Coffee, E-Commerce, Finance, Healthcare,
  Manufacturing, University, and HR System. Each path has 4 progressive articles
  that build an ontology step-by-step, with live embedded graphs showing new
  entities at each stage.
- **IQ Lab: Retail Supply Chain** — A 7-step hands-on lab that builds a 15-entity
  ontology from scratch (3 → 15 entities across 6 progressive catalogue entries).

Every article supports **presentation mode** (slides split at `##` headings)
and includes **interactive quizzes** with instant feedback. Ontology embeds
load live graphs from the catalogue with optional diff highlighting.

### 智能检索问答（LLM-grounded Q&A）

图谱下方内置检索问答控制台：提问后系统会先把**本体结构**（实体 / 属性 / 关系 / 基数）
与**已接入的真实数据集样本行**（含「源列 → 本体属性」映射）组装成上下文，
再以流式方式调用所选大模型作答；回答下方会列出「依据本体 / 依据数据集 / 图谱命中」，
命中的实体与关系同时在图谱上加亮。

- **支持厂商**：OpenAI GPT、DeepSeek、智谱 GLM、通义千问 Qwen、Kimi（月之暗面）、
  硅基流动 SiliconFlow、本地 Ollama，以及任意 OpenAI 兼容的自建网关 —— 见右上角
  「模型连接」图标。
- **自定义系统提示词**：问答面板标题栏的「提示词」按钮可改写 agent 的系统提示词，
  始终基于「系统提示词 + 本体知识图谱 + 真实数据集」作答。
- **多轮对话**：支持连续追问，最近 3 轮问答会作为历史注入模型。
- **私有网关连不上？** 自建网关通常不放行 CORS（`OPTIONS` 预检 403），
  浏览器会直接抛 `Failed to fetch`，此限制**无法在前端绕过**。
  可在「模型连接 → 高级：跨域代理与私有网关」填写一个自备的代理前缀
  （如 `http://localhost:8787`，由你自己在网关或反代上补 CORS 响应头）。
- **优雅降级**：未配置模型时自动使用本地图谱检索引擎给出结论，并引导接入模型。
- **有据可依**：提示词要求模型只依据注入的本体与数据作答，数据不足时明确说明缺什么。
- 详见 [LLM Integration Guide](docs/llm-integration.md)。

### 可拖动分栏（Resizable Panels）

主界面两块区域支持自由拖拽调整尺寸，尺寸会记住并跨会话保留：

| 分隔条 | 位置 | 拖动效果 | 取值范围 |
|---|---|---|---|
| 竖直分隔条 | 内容区与右侧栏之间 | 左右拖动 → **右侧栏宽度** | 260px ~ 视口宽度 − 460px |
| 水平分隔条 | 图谱区与检索问答面板之间 | 上下拖动 → **问答面板高度** | 150px ~ 视口高度 − 300px |

- **双击复位**：双击分隔条回到默认尺寸（问答面板回到「内容自适应高度」）。
- **键盘可用**：`Tab` 聚焦分隔条后用 `←/→`（或 `↑/↓`）微调，`Home` 复位。
- **图谱自动适配**：拖动分栏后 Cytoscape 画布会同步新尺寸，并在拖动停下后自动把
  所有节点重新收进可见区域。
- **移动端**：窄屏（≤900px）不做分栏拖拽，右栏收进底部 Tab，问答面板回到自适应高度。

### Command Palette & Keyboard Shortcuts

Press `⌘K` / `Ctrl+K` anywhere to open a searchable command palette. Jump
to the Catalogue, Designer, the data source connector, model connection, Import/Export, and more
without leaving the keyboard. Press `?` for quick access to the data source
connector. Arrow keys + Enter to navigate the palette.

### Starter Templates

The designer offers five domain templates (Retail, Healthcare, Finance, IoT,
Education) so new users never face a blank page. Each template creates 3
entities with properties and 2 relationships, ready to customise.

### Interactive Onboarding Tour

First-time visitors get a guided tour with a spotlight overlay that
highlights the Header, Graph, Inspector, and Designer in sequence.
Dismissable with a "don't show again" option persisted to `localStorage`.

### Deep Linking & URL Routing

Client-side hash routing with shareable URLs for every page:

| Route | Page |
|-------|------|
| `/#/` | Home (default ontology) |
| `/#/catalogue` | Ontology gallery |
| `/#/catalogue/<source>/<slug>` | Specific ontology (e.g. `/#/catalogue/official/cosmic-coffee`) |
| `/#/designer` | Visual designer |
| `/#/designer/<source>/<slug>` | Designer with catalogue ontology (e.g. `/#/designer/official/cosmic-coffee`) |
| `/#/learn` | Ontology School — course catalogue |
| `/#/learn/<course>` | Course detail — article list |
| `/#/learn/<course>/<article>` | Article view (with presentation mode) |

## Official Ontologies

| Domain | Ontology | Entities | Relationships |
|--------|----------|----------|---------------|
| Retail | Fourth Coffee | 6 | 7 |
| E-Commerce | Online Retail | 5 | 6 |
| Healthcare | Clinical System | 5 | 6 |
| Finance | Banking & Finance | 5 | 6 |
| Manufacturing | Industry 4.0 | 5 | 5 |
| Education | University System | 5 | 6 |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
cd Ontology-Playground
npm install
```

### Development

```bash
npm run dev
```

Visit http://localhost:5173

### Production Build

```bash
npm run build
```

The build pipeline compiles the catalogue, compiles learning content markdown,
type-checks, bundles the app, and builds the embed widget. Output is in
`build/`.

### Running Tests

```bash
npm test            # single run
npm run test:watch  # watch mode
```

## Deployment

### Azure Static Web Apps (primary)

The repo ships with a GitHub Actions workflow that deploys to Azure SWA on every
push to `main`.

1. Create a Static Web App in the Azure Portal
2. Connect to your GitHub repository
3. Copy the deployment token and add it as the GitHub secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN_GREEN_PLANT_0BB1D2910`
4. Push to `main` — the workflow at
   `.github/workflows/azure-static-web-apps-green-plant-0bb1d2910.yml` handles
   the rest
5. PR preview environments are created automatically for pull requests

### GitHub Pages (for forks)

A separate workflow deploys to GitHub Pages, ideal for forks:

1. Fork this repo
2. Go to **Settings → Pages → Source** and select **GitHub Actions**
3. Push to `main` — the workflow at `.github/workflows/deploy-ghpages.yml`
   builds and deploys to `https://<username>.github.io/<repo-name>/`

The `VITE_BASE_PATH` env var is set automatically to `/<repo-name>/` during the
GitHub Pages build so asset paths resolve correctly.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_ENABLE_AI_BUILDER` | `false` | Enable the Azure OpenAI ontology builder |
| `VITE_ENABLE_LEGACY_FORMATS` | `false` | Enable JSON/YAML/CSV import/export formats |
| `VITE_BASE_PATH` | `/` | Base path for the app (set automatically for GitHub Pages) |
| `VITE_GITHUB_CLIENT_ID` | *(empty)* | GitHub OAuth App client ID for one-click catalogue PRs ([setup guide](docs/github-oauth-setup.md)) |
| `VITE_GITHUB_OAUTH_BASE` | *(empty)* | External OAuth proxy URL for GitHub Pages deployments (e.g. Cloudflare Worker URL) |

## Project Structure

```
Ontology-Playground/
├── src/
│   ├── components/       # React components (graph, AI console, designer, modals, learn page)
│   ├── data/             # Ontology model, query engine, data-source & LLM provider presets
│   ├── lib/              # Router, RDF parser/serializer, dataset fetcher, LLM client
│   ├── store/            # Zustand stores (app state, designer state)
│   ├── styles/           # CSS (Microsoft Fluent-inspired dark/light themes)
│   └── types/            # TypeScript type definitions
├── catalogue/            # Official + community ontology RDF files
├── content/learn/        # Course directories with markdown articles, quizzes, and metadata
├── scripts/              # Build-time compilers (catalogue, learning content)
├── api/                  # Azure Functions backend (optional, for AI builder)
├── docs/                 # Guides and documentation
├── public/               # Static assets (compiled catalogue.json, learn.json)
└── .github/workflows/    # CI/CD (Azure SWA + GitHub Pages)
```

## Documentation

The table below lists the main end-user and contributor guides. Internal planning notes (for example, `docs/TODO-*.md`) are intentionally not part of the published documentation set.

| Guide | Description |
|-------|-------------|
| [Ontology Authoring Guide](docs/authoring-guide.md) | How to create ontologies that work well in the Playground — field-by-field reference, best practices, and a step-by-step walkthrough |
| [Data Source Guide](docs/default-data-sources.md) | How to connect your own data — JSON auto-parse (incl. bucketed graph files) and manual endpoints (REST / SPARQL / GraphQL / JSON) |
| [LLM Integration Guide](docs/llm-integration.md) | How the LLM-grounded retrieval Q&A works, supported providers (GPT / DeepSeek / GLM / Qwen / Kimi / SiliconFlow / Ollama), CORS findings, notes on self-hosted gateways, and security tips |
| [Contribute an Ontology: From Design to GitHub](docs/contributing-ontology-from-design-to-github.md) | End-to-end contributor workflow: design, RDF export, metadata, local validation, and pull request |
| [Playground Feature Demo Guide](docs/playground-features-demo-guide.md) | Step-by-step demo script to showcase key Playground capabilities and connect them to Fabric IQ and Real-Time Intelligence |
| [Ontology School Demo Guide](docs/ontology-school-demo-guide.md) | Step-by-step live demo plan for courses, embeds, quizzes, presentation mode, and learning workflow |
| [Embedding Guide](docs/embed-guide.md) | How to embed interactive ontology widgets on any web page |
| [GitHub OAuth Setup](docs/github-oauth-setup.md) | How to configure GitHub OAuth for one-click catalogue PRs |
| [Embed Security](docs/embed-security.md) | Security model for the embeddable widget |
| [Learning Content Guide](docs/learn-content-guide.md) | How to author courses, articles, quizzes, and ontology embeds for the Ontology School |
| [Ontology School Review Workflow](docs/ontology-school-review-workflow.md) | Human review and approval flow for school lesson content |
| [Theme Authoring Guide](docs/theme-authoring-guide.md) | How to plug a new color theme into the Playground — token contract, the appStore + CSS steps, and contrast gotchas |

## AI Agent Quickstart

This repository includes Copilot customization files so agents can reliably:

- import customer RDF/OWL into catalogue-ready format
- generate progressive Ontology School modules
- route lesson content through human review workflows

Included assets:

- Skills:
   - `.github/skills/ontology-catalog-import/` — import external/customer RDF/OWL into catalogue format
   - `.github/skills/ontology-school-path-generator/` — generate progressive Ontology School modules
   - `.github/skills/community-ontology-contribution/` — add a contributor ontology under `catalogue/community/` with the correct directory structure, metadata, and validation
   - `.github/skills/name-generator/` — generate person names for examples, demos, quests, tests, and sample data from the approved CSV fixture
- RDF intake instruction:
   - `.github/instructions/rdf-intake.instructions.md`
- Reusable prompts:
   - `.github/prompts/import-rdf-to-catalog.prompt.md`
   - `.github/prompts/generate-ontology-school-module.prompt.md`

Recommended validation before merge:

```bash
npm run qa:tutorial-content
npm run build
```

## Technologies

- **React 19** + TypeScript 5
- **Cytoscape.js** — Graph visualization (fcose layout)
- **Zustand** — State management
- **Vite** — Build tool
- **Framer Motion** — Animations
- **Lucide Icons** — Icon library
- **marked** — Markdown compilation (build-time)

## Learn More

- [Microsoft Fabric IQ Ontology Documentation](https://learn.microsoft.com/en-us/fabric/iq/ontology/overview)
- [Azure Static Web Apps](https://docs.microsoft.com/azure/static-web-apps/)

## License

MIT

## Trademark Notice

Trademarks This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow Microsoft’s Trademark & Brand Guidelines. Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party’s policies.