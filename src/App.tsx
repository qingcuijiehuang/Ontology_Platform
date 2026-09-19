import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Header,
  OntologyGraph,
  InspectorPanel,
  SearchFilter,
  EndpointConnector,
  LlmConnector,
  AIQueryConsole,
  ImportExportModal,
  GalleryModal,
  OntologySummaryModal,
  OntologyDesigner,
  LearnPage,
  CommandPalette,
  GuidedTour,
  isTourDismissed,
  AppFooter,
  OntologyStatsPanel,
  PathFinderPanel,
  InstanceBrowser,
} from './components';
import type { CommandItem } from './components';
import { useAppStore, themeClass, THEME_OPTIONS } from './store/appStore';
import { useDesignerStore } from './store/designerStore';
import { useRoute } from './hooks/useRoute';
import { usePanelResize } from './hooks/usePanelResize';
import { navigate } from './lib/router';
import { decodeSharePayload } from './lib/shareCodec';
import type { Catalogue } from './types/catalogue';
import { Search, Info, LayoutGrid, PenTool, FileJson, FileText, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import './styles/app.css';

const AI_BUILDER_ENABLED = import.meta.env.VITE_ENABLE_AI_BUILDER === 'true';

const NLBuilderModal = AI_BUILDER_ENABLED
  ? lazy(() => import('./components/NLBuilderModal').then(m => ({ default: m.NLBuilderModal })))
  : null;

function App() {
  const route = useRoute();

  const [showTour, setShowTour] = useState(() => !isTourDismissed());
  const [showDataSources, setShowDataSources] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showNLBuilder, setShowNLBuilder] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [showLlm, setShowLlm] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'inspector'>('graph');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const { theme, setTheme, currentOntology, loadOntology } = useAppStore();

  // ── 右侧栏宽度可拖动 ──────────────────────────────────
  // 面板在分隔条正方向一侧，所以 reverse：指针左移 = 栏变宽。
  // 上限按视口动态计算，保证中间图谱区永远留得下至少 ~460px。
  const sidebarResize = usePanelResize({
    storageKey: 'right-sidebar-width',
    initial: typeof window !== 'undefined' && window.innerWidth <= 1200 ? 320 : 360,
    min: 260,
    max: () => Math.max(300, window.innerWidth - 460),
    axis: 'x',
    reverse: true,
    label: '拖动调整右侧栏宽度',
  });

  // Deep-link: /#/catalogue/<id> — load a specific ontology from the catalogue
  useEffect(() => {
    if (route.page === 'catalogue' && route.ontologyId) {
      const id = route.ontologyId;
      fetch(`${import.meta.env.BASE_URL}catalogue.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load catalogue (${res.status})`);
          return res.json() as Promise<Catalogue>;
        })
        .then((data) => {
          const entry = data.entries.find((e) => e.id === id);
          if (entry) {
            loadOntology(entry.ontology, entry.bindings);
            // URL stays at /#/catalogue/<id> so it's shareable
          } else {
            // Unknown ontology id — open gallery so the user can pick
            navigate({ page: 'catalogue' });
          }
        })
        .catch(() => {
          // On error, open gallery
          navigate({ page: 'catalogue' });
        });
    }
  }, [route, loadOntology]);

  // Deep-link: /#/share/<data> — decode an inline-shared ontology
  useEffect(() => {
    if (route.page === 'share' && route.data) {
      decodeSharePayload(route.data)
        .then(({ ontology, bindings }) => {
          loadOntology(ontology, bindings);
        })
        .catch(() => {
          // Corrupt or invalid share link — go home
          navigate({ page: 'home' });
        });
    }
  }, [route, loadOntology]);

  // Show gallery only when at /#/catalogue (no specific ontology ID)
  const showGallery = route.page === 'catalogue' && !route.ontologyId;

  const closeGallery = useCallback(() => {
    navigate({ page: 'home' });
  }, []);

  const openGallery = useCallback(() => {
    navigate({ page: 'catalogue' });
  }, []);

  const openDesigner = useCallback(() => {
    // Load the current playground ontology into the designer
    const { currentOntology } = useAppStore.getState();
    useDesignerStore.getState().loadDraft(currentOntology);
    navigate({ page: 'designer' });
  }, []);

  const openLearn = useCallback(() => navigate({ page: 'learn' }), []);

  const cycleTheme = useCallback(() => {
    const idx = THEME_OPTIONS.findIndex((t) => t.id === theme);
    const next = THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length];
    setTheme(next.id);
  }, [theme, setTheme]);

  // ── Global keyboard shortcuts ──────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs/textareas (except for Cmd+K)
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      // Cmd+K / Ctrl+K — open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        return;
      }

      if (isInput) return;

      switch (e.key) {
        case '?':
          e.preventDefault();
          setShowEndpoint(true);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Command palette items ──────────────────────────────
  const commands = useMemo<CommandItem[]>(() => [
    { id: 'llm', label: '模型连接（大模型 API）', icon: <Sparkles size={18} />, action: () => setShowLlm(true) },
    { id: 'connect', label: '接入数据源', icon: <LayoutGrid size={18} />, action: () => setShowEndpoint(true) },
    { id: 'catalogue', label: '打开本体库', icon: <LayoutGrid size={18} />, action: openGallery },
    { id: 'designer', label: '打开设计器', icon: <PenTool size={18} />, action: openDesigner },
    { id: 'learn', label: '打开学习中心', icon: <PenTool size={18} />, action: openLearn },
    { id: 'import-export', label: '导入 / 导出', icon: <FileJson size={18} />, action: () => setShowImportExport(true) },
    { id: 'summary', label: '查看摘要', icon: <FileText size={18} />, action: () => setShowSummary(true) },
    { id: 'data-sources', label: '数据源说明', icon: <FileText size={18} />, action: () => setShowDataSources(true) },
    { id: 'theme', label: '切换主题', icon: <FileText size={18} />, action: cycleTheme },
  ], [openGallery, openDesigner, openLearn, cycleTheme]);

  // Full-page views
  if (route.page === 'designer') {
    return <OntologyDesigner route={route} />;
  }
  if (route.page === 'learn') {
    return <LearnPage route={route} />;
  }

  return (
    <div
      className={`app-container ${themeClass(theme)}`}
      style={{ '--right-sidebar-width': `${sidebarResize.size}px` } as CSSProperties}
    >
      <Header
        onDataSourcesClick={() => setShowDataSources(true)}
        onImportExportClick={() => setShowImportExport(true)}
        onGalleryClick={openGallery}
        onDesignerClick={openDesigner}
        onNLBuilderClick={AI_BUILDER_ENABLED ? () => setShowNLBuilder(true) : undefined}
        onSummaryClick={() => setShowSummary(true)}
        onEndpointClick={() => setShowEndpoint(true)}
        onLlmClick={() => setShowLlm(true)}
      />

      {/* 左列：图谱 + 智能检索问答（回答框位于图谱下方） + 页脚 */}
      <div className="main-column">
        <OntologyGraph />
        <AIQueryConsole onOpenModelSettings={() => setShowLlm(true)} />
        <AppFooter />
      </div>

      {/* 竖直分隔条：左右拖动调整右侧栏宽度，双击复位 */}
      <div
        className={`panel-resizer panel-resizer--vertical ${sidebarResize.dragging ? 'is-dragging' : ''}`}
        {...sidebarResize.handleProps}
      />

      <div className="right-sidebar">
        <OntologyStatsPanel />
        <InstanceBrowser ontology={currentOntology} />
        <PathFinderPanel />
        <SearchFilter />
        <InspectorPanel />
      </div>

      {/* Mobile bottom tabs — visible only on small screens via CSS */}
      <div className="mobile-panel-tabs">
        <button className={`mobile-tab ${mobilePanel === 'graph' ? 'active' : ''}`} onClick={() => setMobilePanel('graph')}>
          <Search size={18} /> 图谱与问答
        </button>
        <button className={`mobile-tab ${mobilePanel === 'inspector' ? 'active' : ''}`} onClick={() => setMobilePanel('inspector')}>
          <Info size={18} /> 检视
        </button>
      </div>

      {/* Mobile panel drawer — visible only on small screens when a panel is selected */}
      {mobilePanel === 'inspector' && (
        <div className="mobile-panel-drawer">
          <button className="mobile-panel-close" onClick={() => setMobilePanel('graph')}>✕ 关闭</button>
          <SearchFilter />
          <InspectorPanel />
        </div>
      )}

      {showTour && (
        <GuidedTour onComplete={() => { setShowTour(false); }} />
      )}

      <AnimatePresence>
        {showEndpoint && <EndpointConnector onClose={() => setShowEndpoint(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showLlm && <LlmConnector onClose={() => setShowLlm(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showDataSources && (
          <div className="modal-overlay" onClick={() => setShowDataSources(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>数据源说明</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 12 }}>
                本平台支持 4 种真实数据源接入：
              </p>
              <ul style={{ paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li><strong>REST API</strong>：从任意 RESTful 接口拉取 JSON 数据；支持自定义 Headers 与超时。</li>
                <li><strong>SPARQL</strong>：对 RDF 三元组存储执行 SELECT 查询，返回 JSON 结果；自动包裹样本查询。</li>
                <li><strong>GraphQL</strong>：通过 GraphQL 端点查询，自动解析 data 字段。</li>
                <li><strong>JSON 文件</strong>：从可访问的 JSON 文件直接加载。</li>
              </ul>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 12 }}>
                所有请求通过浏览器原生 fetch 发起，跨域（CORS）需在目标服务器放行。
                数据拉回后会在右侧"实例浏览"中以表格展示，并被自然语言查询自动引用。
              </p>
              <div style={{ marginTop: 18, textAlign: 'center' }}>
                <button className="btn btn-primary" onClick={() => setShowDataSources(false)}>关闭</button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImportExport && <ImportExportModal onClose={() => setShowImportExport(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showGallery && <GalleryModal onClose={closeGallery} />}
      </AnimatePresence>

      {AI_BUILDER_ENABLED && NLBuilderModal && (
        <AnimatePresence>
          {showNLBuilder && (
            <Suspense fallback={null}>
              <NLBuilderModal onClose={() => setShowNLBuilder(false)} />
            </Suspense>
          )}
        </AnimatePresence>
      )}

      <AnimatePresence>
        {showSummary && <OntologySummaryModal onClose={() => setShowSummary(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        <CommandPalette
          open={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          commands={commands}
        />
      </AnimatePresence>
    </div>
  );
}

export default App;