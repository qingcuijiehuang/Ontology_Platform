import { useState, useRef, useEffect } from 'react';
import { useAppStore, THEME_OPTIONS } from '../store/appStore';
import { useRoute } from '../hooks/useRoute';
import { routeToHash } from '../lib/router';
import { encodeSharePayload } from '../lib/shareCodec';
import { serializeToRDF } from '../lib/rdf/serializer';
import { isLlmConfigured, describeLlm } from '../data/llmProviders';
import { ModelConnectionIcon } from './LlmConnector';
import { Palette, Check, Database, FileJson, LayoutGrid, Sparkles, FileText, Share2, PenTool, Menu, X, Download, Plug } from 'lucide-react';

interface HeaderProps {
  onDataSourcesClick: () => void;
  onImportExportClick: () => void;
  onGalleryClick: () => void;
  onDesignerClick: () => void;
  onNLBuilderClick?: () => void;
  onSummaryClick: () => void;
  onEndpointClick: () => void;
  onLlmClick: () => void;
}

export function Header({ onDataSourcesClick, onImportExportClick, onGalleryClick, onDesignerClick, onNLBuilderClick, onSummaryClick, onEndpointClick, onLlmClick }: HeaderProps) {
  const { theme, setTheme, currentOntology, dataBindings, llm } = useAppStore();
  const route = useRoute();
  const llmReady = isLlmConfigured(llm);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'copied' | 'downloaded'>('idle');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);


  const ontologyDisplayName = currentOntology.name || '未命名本体';

  const shareableId = route.page === 'catalogue' && route.ontologyId ? route.ontologyId : null;

  const handleShare = async () => {
    if (shareStatus === 'copying') return;

    if (shareableId) {
      // Catalogue ontology — use the short deep link
      const url = `${window.location.origin}${window.location.pathname}#/catalogue/${shareableId}`;
      await navigator.clipboard.writeText(url);
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 2000);
      return;
    }

    // Custom ontology — compress and encode into a share URL
    setShareStatus('copying');
    const encoded = await encodeSharePayload(currentOntology, dataBindings);
    if (encoded) {
      const url = `${window.location.origin}${window.location.pathname}#/share/${encoded}`;
      await navigator.clipboard.writeText(url);
      history.replaceState(null, '', routeToHash({ page: 'share', data: encoded }));
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 2000);
    } else {
      // Too large for URL — download the RDF file instead
      const content = serializeToRDF(currentOntology, dataBindings);
      const blob = new Blob([content], { type: 'application/rdf+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentOntology.name.toLowerCase().replace(/\s+/g, '-')}-ontology.rdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setShareStatus('downloaded');
      setTimeout(() => setShareStatus('idle'), 3000);
    }
  };

  const shareLabel = shareStatus === 'copied' ? '已复制' : shareStatus === 'downloaded' ? '已下载 RDF' : shareStatus === 'copying' ? '编码中…' : '分享';

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // Close theme menu when clicking outside
  useEffect(() => {
    if (!themeMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [themeMenuOpen]);

  const menuAction = (fn: () => void) => () => { setMenuOpen(false); fn(); };

  return (
    <header className="header">
      <div className="header-logo">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#0078D4"/>
          <path d="M8 8H15V15H8V8Z" fill="white"/>
          <path d="M17 8H24V15H17V8Z" fill="white" opacity="0.7"/>
          <path d="M8 17H15V24H8V17Z" fill="white" opacity="0.7"/>
          <path d="M17 17H24V24H17V17Z" fill="white" opacity="0.5"/>
        </svg>
        <div>
          <span className="header-title">
            本体平台 <span className="header-title-preview">Ontology Platform</span>
          </span>
          <span className="header-context">{ontologyDisplayName}</span>
        </div>
      </div>

      <div className="header-actions">
        <button
          className={`header-model-btn ${llmReady ? 'is-ready' : 'is-unset'}`}
          onClick={onLlmClick}
          title={llmReady ? `模型连接：${describeLlm(llm)}` : '接入大模型（GPT / DeepSeek / GLM 等）'}
          aria-label="模型连接"
        >
          <ModelConnectionIcon size={16} connected={llmReady} />
          <span>模型连接</span>
        </button>
        <button
          className="header-primary-btn"
          onClick={onEndpointClick}
          title="接入 RDF / SPARQL / REST 数据库"
        >
          <Plug size={16} />
          <span>接入数据源</span>
        </button>
        <button
          className="header-text-btn"
          onClick={handleShare}
          title={shareableId ? '复制本体分享链接' : '通过链接分享本体'}
          style={shareStatus === 'copied' ? { color: 'var(--ms-green, #107C10)' } : shareStatus === 'downloaded' ? { color: 'var(--ms-blue, #0078D4)' } : undefined}
        >
          {shareStatus === 'downloaded' ? <Download size={16} /> : <Share2 size={16} />}
          <span>{shareLabel}</span>
        </button>
        <button className="header-text-btn" onClick={onSummaryClick} title="查看本体摘要">
          <FileText size={16} />
          <span>摘要</span>
        </button>
        {onNLBuilderClick && (
          <button className="icon-btn" onClick={onNLBuilderClick} data-tooltip="AI 构建器" aria-label="AI 构建器">
            <Sparkles size={20} />
          </button>
        )}
        <button className="icon-btn" onClick={onGalleryClick} data-tooltip="本体库" aria-label="本体库">
          <LayoutGrid size={20} />
        </button>
        <button className="icon-btn" onClick={onDesignerClick} data-tooltip="本体设计器" aria-label="本体设计器">
          <PenTool size={20} />
        </button>
        <button className="icon-btn" onClick={onImportExportClick} data-tooltip="导入 / 导出" aria-label="导入 / 导出">
          <FileJson size={20} />
        </button>
        <button className="icon-btn" onClick={onDataSourcesClick} data-tooltip="数据源说明" aria-label="数据源说明">
          <Database size={20} />
        </button>
        <div className="theme-picker" ref={themeMenuRef}>
          <button
            className="icon-btn"
            onClick={() => setThemeMenuOpen((o) => !o)}
            data-tooltip="主题"
            aria-label="主题"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
          >
            <Palette size={20} />
          </button>
          {themeMenuOpen && (
            <div className="theme-menu" role="menu">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`theme-menu-item ${theme === opt.id ? 'active' : ''}`}
                  onClick={() => { setTheme(opt.id); setThemeMenuOpen(false); }}
                  role="menuitemradio"
                  aria-checked={theme === opt.id}
                >
                  <span className="theme-swatch" style={{ background: opt.swatch }} />
                  {opt.label}
                  {theme === opt.id && <Check size={16} className="theme-check" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile hamburger menu */}
      <div className="header-mobile-menu" ref={menuRef}>
        <button className="icon-btn header-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="菜单">
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        {menuOpen && (
          <div className="mobile-menu-dropdown">
            <button className="mobile-menu-item" onClick={menuAction(onLlmClick)}>
              <ModelConnectionIcon size={18} connected={llmReady} /> 模型连接{llmReady ? '' : '（未配置）'}
            </button>
            <button className="mobile-menu-item mobile-menu-item--primary" onClick={menuAction(onEndpointClick)}>
              <Plug size={18} /> 接入数据源
            </button>
            <button className="mobile-menu-item" onClick={menuAction(handleShare)}>
              <Share2 size={18} /> {shareLabel}
            </button>
            <button className="mobile-menu-item" onClick={menuAction(onSummaryClick)}>
              <FileText size={18} /> 摘要
            </button>
            {onNLBuilderClick && (
              <button className="mobile-menu-item" onClick={menuAction(onNLBuilderClick)}>
                <Sparkles size={18} /> AI 构建器
              </button>
            )}
            <button className="mobile-menu-item" onClick={menuAction(onGalleryClick)}>
              <LayoutGrid size={18} /> 本体库
            </button>
            <button className="mobile-menu-item" onClick={menuAction(onDesignerClick)}>
              <PenTool size={18} /> 本体设计器
            </button>
            <button className="mobile-menu-item" onClick={menuAction(onImportExportClick)}>
              <FileJson size={18} /> 导入 / 导出
            </button>
            <button className="mobile-menu-item" onClick={menuAction(onDataSourcesClick)}>
              <Database size={18} /> 数据源说明
            </button>
            <div className="mobile-menu-themes">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`mobile-menu-item ${theme === opt.id ? 'active' : ''}`}
                  onClick={menuAction(() => setTheme(opt.id))}
                >
                  <span className="theme-swatch" style={{ background: opt.swatch }} />
                  {opt.label}
                  {theme === opt.id && <Check size={16} className="theme-check" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}