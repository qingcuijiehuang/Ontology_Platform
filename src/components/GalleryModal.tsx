import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Layers, ArrowRight, Search, Code, User, Pencil, Share2, Trash2, Database } from 'lucide-react';
import { useDesignerStore } from '../store/designerStore';
import { useAppStore } from '../store/appStore';
import { serializeToRDF } from '../lib/rdf/serializer';
import { highlightRdf, RDF_HIGHLIGHT_DARK, RDF_HIGHLIGHT_LIGHT } from '../lib/rdf/highlighter';
import { navigate, parseHash } from '../lib/router';
import { listUserOntologies, removeUserOntology, toRuntimeEndpoints, type StoredUserOntology } from '../lib/userOntologyLibrary';
import type { CatalogueEntry, Catalogue } from '../types/catalogue';
import { CATEGORY_COLORS, CATEGORY_LABELS, LOCAL_SOURCE_LABEL } from '../types/catalogue';

interface GalleryModalProps {
  onClose: () => void;
}

type SourceFilter = 'all' | 'official' | 'community' | 'external' | 'local';

/** 列表里的一行：编译期目录条目，或用户存在本地本体库里的条目。 */
type GalleryEntry = CatalogueEntry | StoredUserOntology;

/** 是否为「我的」本地保存条目（带保存时间）。 */
function isStoredEntry(entry: GalleryEntry): entry is StoredUserOntology {
  return entry.source === 'local' && 'savedAt' in entry;
}

/** 随本体一起保存的数据源；编译期条目 / 从未存过数据源的本地条目为 undefined。 */
function endpointsOf(entry: GalleryEntry) {
  return isStoredEntry(entry) ? entry.endpoints : undefined;
}

export function GalleryModal({ onClose }: GalleryModalProps) {
  const { currentOntology, loadOntology, setEndpoints } = useAppStore();

  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  /** 用户「导入 RDF → 存入本体库」保存在本地的本体，与 catalogue 合并展示。 */
  const [userEntries, setUserEntries] = useState<StoredUserOntology[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [rdfViewId, setRdfViewId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const [copiedEmbedId, setCopiedEmbedId] = useState<string | null>(null);

  // Keep filters in sync with URL query params (including page refresh + hash navigation)
  useEffect(() => {
    const syncFiltersFromHash = () => {
      const route = parseHash(window.location.hash);
      if (route.page !== 'catalogue') return;
      setCategoryFilter(route.category ?? 'all');
      setSourceFilter((route.source as SourceFilter) ?? 'all');
    };

    syncFiltersFromHash();
    window.addEventListener('hashchange', syncFiltersFromHash);
    return () => window.removeEventListener('hashchange', syncFiltersFromHash);
  }, []);

  // Load catalogue.json + 本地保存的「我的」本体
  useEffect(() => {
    setUserEntries(listUserOntologies());
    fetch(`${import.meta.env.BASE_URL}catalogue.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load catalogue (${res.status})`);
        return res.json() as Promise<Catalogue>;
      })
      .then((data) => {
        setCatalogue(data.entries);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // 本地保存的条目排在最前（最新的在最上），随后是编译期目录
  const allEntries = useMemo<GalleryEntry[]>(() => [...userEntries, ...catalogue], [userEntries, catalogue]);

  // Derive available categories from loaded data
  const categories = useMemo(() => {
    const cats = new Set(allEntries.map((e) => e.category));
    return Array.from(cats).sort();
  }, [allEntries]);

  // Filter + search
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allEntries.filter((entry) => {
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      // Hide school step-by-step entries unless that category is explicitly selected
      if (categoryFilter === 'all' && entry.category === 'school') return false;
      if (q) {
        const haystack = [
          entry.name,
          entry.description,
          entry.author,
          ...entry.tags,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allEntries, searchQuery, sourceFilter, categoryFilter]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(12);
  }, [searchQuery, sourceFilter, categoryFilter]);

  const visibleEntries = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  const handleShowMore = useCallback(() => {
    setVisibleCount((c) => c + 12);
  }, []);

  const handleLoadOntology = (entry: GalleryEntry) => {
    loadOntology(entry.ontology, entry.bindings);
    // 本地保存的条目不在静态 catalogue.json 里，深链会被判定为未知 id 而弹回
    // 本体库 —— 直接加载并关闭即可，不需要可分享的 URL。
    if (entry.source === 'local') {
      // 「本体 + 数据源」是一个包：条目里存过数据源（endpoints 是数组）才整体恢复，
      // 从未存过（undefined）则不动用户当前接入的数据源，避免误清空。
      const savedEndpoints = endpointsOf(entry);
      if (savedEndpoints) setEndpoints(toRuntimeEndpoints(savedEndpoints));
      onClose();
      return;
    }
    // Navigate to the ontology deep link so the URL is shareable
    navigate({
      page: 'catalogue',
      ontologyId: entry.id,
      category: categoryFilter !== 'all' ? categoryFilter : undefined,
      source: sourceFilter !== 'all' ? sourceFilter : undefined,
    });
  };

  /** 删除一条本地保存的本体（window.confirm 二次确认）。 */
  const handleDeleteUserOntology = useCallback((entry: CatalogueEntry) => {
    if (!window.confirm(`确定要从本体库中删除「${entry.name}」吗？此操作不可撤销。`)) return;
    setUserEntries(removeUserOntology(entry.id));
  }, []);

  const handleViewRdf = (entry: CatalogueEntry) => {
    setRdfViewId(rdfViewId === entry.id ? null : entry.id);
  };

  const handleCopyEmbed = (entry: CatalogueEntry) => {
    const siteUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
    const snippet = `<div class="ontology-embed" data-catalogue-id="${entry.id}" data-catalogue-base-url="${siteUrl}" data-theme="light" data-height="500px"></div>\n<script src="${siteUrl}embed/ontology-embed.js"></script>`;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopiedEmbedId(entry.id);
      setTimeout(() => setCopiedEmbedId(null), 2000);
    });
  };

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal-content"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 20 }}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900, maxHeight: '85vh', overflow: 'auto' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 600 }}>本体库</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
              浏览并加载本体库中已有的本体
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              placeholder="按名称、标签、作者搜索…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            />
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => {
              const newSource = e.target.value as SourceFilter;
              setSourceFilter(newSource);
              navigate({
                page: 'catalogue',
                source: newSource !== 'all' ? newSource : undefined,
                category: categoryFilter !== 'all' ? categoryFilter : undefined,
              });
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          >
            <option value="all">全部来源</option>
            <option value="local">我的</option>
            <option value="official">官方</option>
            <option value="external">外部</option>
            <option value="community">社区</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => {
              const newCategory = e.target.value;
              setCategoryFilter(newCategory);
              navigate({
                page: 'catalogue',
                category: newCategory !== 'all' ? newCategory : undefined,
                source: sourceFilter !== 'all' ? sourceFilter : undefined,
              });
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          >
            <option value="all">全部分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat] ?? cat}
              </option>
            ))}
          </select>
        </div>

        {/* Loading / Error / Empty */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
            正在加载本体库…
          </div>
        )}
        {error && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ms-red, #D13438)' }}>
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
            没有本体匹配你的筛选条件。
          </div>
        )}

        {/* Result count */}
        {!loading && !error && filtered.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
            显示 {Math.min(visibleCount, filtered.length)} / 共 {filtered.length} 个本体
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && !error && (
          <>
          <div className="gallery-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 16 }}>
            {visibleEntries.map((entry) => {
              const isActive = currentOntology.name === entry.ontology.name;
              const categoryColor = CATEGORY_COLORS[entry.category] ?? '#6B7280';
              const showRdf = rdfViewId === entry.id;
              const savedEndpoints = endpointsOf(entry) ?? [];

              return (
                <motion.div
                  key={entry.id}
                  layout
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    padding: 20,
                    background: isActive
                      ? 'linear-gradient(135deg, rgba(0, 120, 212, 0.15), rgba(0, 120, 212, 0.05))'
                      : 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-lg)',
                    border: isActive ? '2px solid var(--ms-blue)' : '2px solid transparent',
                    cursor: isActive ? 'default' : 'pointer',
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                  onClick={() => !isActive && handleLoadOntology(entry)}
                >
                  {/* Card header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          background: `${categoryColor}20`,
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 24,
                        }}
                      >
                        {entry.icon || '📄'}
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{entry.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              fontSize: 11,
                              color: categoryColor,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            {CATEGORY_LABELS[entry.category] ?? entry.category}
                          </span>
                          {entry.source === 'local' && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                background: 'var(--ms-blue)',
                                borderRadius: 'var(--radius-sm)',
                                color: '#fff',
                                fontWeight: 500,
                              }}
                            >
                              {LOCAL_SOURCE_LABEL}
                            </span>
                          )}
                          {entry.source === 'community' && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                background: 'var(--bg-secondary)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                              }}
                            >
                              社区
                            </span>
                          )}
                          {entry.source === 'external' && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                background: 'var(--ms-cyan)',
                                borderRadius: 'var(--radius-sm)',
                                color: '#fff',
                                fontWeight: 500,
                              }}
                            >
                              外部
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {isActive && (
                      <div
                        style={{
                          padding: '4px 8px',
                          background: 'var(--ms-blue)',
                          color: 'white',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        Active
                      </div>
                    )}
                  </div>

                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
                    {entry.description}
                  </p>

                  {/* Tags */}
                  {entry.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            background: 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-tertiary)',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Author */}
                  {entry.author && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
                      <User size={12} color="var(--text-tertiary)" />
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{entry.author}</span>
                    </div>
                  )}

                  {/* Stats + actions */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 0 0',
                      borderTop: '1px solid var(--border-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Layers size={14} color="var(--text-tertiary)" />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {entry.ontology.entityTypes.length} 个实体
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ArrowRight size={14} color="var(--text-tertiary)" />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {entry.ontology.relationships.length} 条关系
                        </span>
                      </div>
                      {savedEndpoints.length > 0 && (
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          title={`随本体保存的数据源：\n${savedEndpoints.map((e) => `· ${e.name}`).join('\n')}`}
                        >
                          <Database size={14} color="var(--ms-blue)" />
                          <span style={{ fontSize: 12, color: 'var(--ms-blue)', fontWeight: 600 }}>
                            {savedEndpoints.length} 个数据源
                          </span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {entry.source === 'local' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '5px 8px', fontSize: 11, color: 'var(--ms-red, #D13438)' }}
                          title="从本体库中删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteUserOntology(entry);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '5px 8px', fontSize: 11 }}
                        title="查看 RDF 源码"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewRdf(entry);
                        }}
                      >
                        <Code size={13} />
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '5px 8px', fontSize: 11 }}
                        title={copiedEmbedId === entry.id ? '已复制！' : '复制嵌入代码'}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyEmbed(entry);
                        }}
                      >
                        <Share2 size={13} />
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '5px 8px', fontSize: 11 }}
                        title="在设计器中编辑"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Load into both stores: playground (appStore) and designer
                          loadOntology(entry.ontology, entry.bindings);
                          useDesignerStore.getState().loadDraft(entry.ontology);
                          // Navigate to designer — the Gallery auto-unmounts because
                          // showGallery is route-driven (no need to call onClose,
                          // which would navigate to 'home' and overwrite this route).
                          navigate({ page: 'designer' });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      {!isActive && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLoadOntology(entry);
                          }}
                        >
                          加载
                        </button>
                      )}
                    </div>
                  </div>

                  {/* RDF source view */}
                  <AnimatePresence>
                    {showRdf && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: 'hidden' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GalleryRdfSource ontology={entry.ontology} bindings={entry.bindings} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 24px', fontSize: 13 }}
                onClick={handleShowMore}
              >
                显示更多（还有 {filtered.length - visibleCount} 个）
              </button>
            </div>
          )}
          </>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            想贡献本体？请查看{' '}
            <a
              href="https://github.com/microsoft/Ontology-Playground/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--ms-blue, #0078D4)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              <strong>CONTRIBUTING.md</strong>
            </a>
            {' '}—— 把你的本体作为 RDF 文件加入，并发起一个{' '}
            <a
              href="https://github.com/microsoft/Ontology-Playground/fork"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--ms-blue, #0078D4)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Pull Request
            </a>
            。
          </p>
        </div>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Highlighted RDF source (gallery cards) ──────────────────────────────────

function GalleryRdfSource({ ontology, bindings }: { ontology: Parameters<typeof serializeToRDF>[0]; bindings: Parameters<typeof serializeToRDF>[1] }) {
  const darkMode = useAppStore((s) => s.darkMode);
  const hlTheme = darkMode ? RDF_HIGHLIGHT_DARK : RDF_HIGHLIGHT_LIGHT;
  const rdf = useMemo(() => serializeToRDF(ontology, bindings), [ontology, bindings]);
  const highlighted = useMemo(() => highlightRdf(rdf, hlTheme), [rdf, hlTheme]);

  return (
    <pre
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-primary)',
        fontSize: 11,
        lineHeight: 1.5,
        overflow: 'auto',
        maxHeight: 250,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--text-secondary)',
      }}
    >
      {highlighted}
    </pre>
  );
}
