import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, RefreshCw, ChevronDown, ChevronUp, AlertCircle, CheckCircle, Loader2, Table2, X, Link2 } from 'lucide-react';
import { useAppStore, type DataEndpoint } from '../store/appStore';
import type { Ontology } from '../data/ontology';
import { sampleInstances } from '../data/ontology';
import { fetchEndpointRows, formatCell, isLocalEndpoint, localSourceLabel } from '../lib/datasetFetcher';

interface InstanceBrowserProps {
  ontology: Ontology;
}

interface FetchedDataset {
  endpointId: string;
  endpointName: string;
  endpointKind: DataEndpoint['kind'];
  fetchedAt: number;
  rowCount: number;
  rows: Record<string, unknown>[];
  error?: string;
}

interface PreviewColumn {
  /** Raw column key in the fetched payload. */
  key: string;
  /** Ontology property name this column is mapped to (falls back to key). */
  label: string;
  /** Whether a column mapping was declared for this column. */
  mapped: boolean;
}


export function InstanceBrowser({ ontology }: InstanceBrowserProps) {
  const { endpoints } = useAppStore();
  const [expanded, setExpanded] = useState(true);
  const [activeEndpointId, setActiveEndpointId] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Record<string, FetchedDataset>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Sample fallback instances for the currently-loaded ontology
  const fallbackSample = useMemo(() => {
    if (ontology.name === 'Fourth Coffee' || ontology.name === 'Cosmic Coffee') {
      return sampleInstances;
    }
    return [];
  }, [ontology]);

  // Auto-select the first endpoint
  useEffect(() => {
    if (!activeEndpointId && endpoints.length > 0) {
      setActiveEndpointId(endpoints[0].id);
    }
    if (activeEndpointId && !endpoints.find((e) => e.id === activeEndpointId)) {
      setActiveEndpointId(endpoints[0]?.id ?? null);
    }
  }, [endpoints, activeEndpointId]);

  const activeEndpoint = endpoints.find((e) => e.id === activeEndpointId) ?? null;
  const activeDataset = activeEndpointId ? datasets[activeEndpointId] : undefined;
  const activeLoading = activeEndpointId ? loading[activeEndpointId] : false;

  // Entity this data source maps to (declared on the endpoint).
  const activeEntity = useMemo(() => {
    if (!activeEndpoint?.entityTypeId) return undefined;
    return ontology.entityTypes.find((e) => e.id === activeEndpoint.entityTypeId);
  }, [activeEndpoint, ontology]);

  /** 加载提示里展示的数据来源：本地文件显示文件名，在线数据源显示 URL。 */
  const activeSourceLabel = activeEndpoint
    ? isLocalEndpoint(activeEndpoint)
      ? localSourceLabel(activeEndpoint)
      : activeEndpoint.url
    : '';

  const fetchEndpoint = useCallback(async (endpoint: DataEndpoint) => {
    setLoading((prev) => ({ ...prev, [endpoint.id]: true }));
    const result = await fetchEndpointRows(endpoint, ontology, { timeoutMs: 12000 });
    setDatasets((prev) => ({
      ...prev,
      [endpoint.id]: {
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        endpointKind: endpoint.kind,
        fetchedAt: Date.now(),
        rowCount: result.rows.length,
        rows: result.rows,
        error: result.error,
      },
    }));
    setLoading((prev) => ({ ...prev, [endpoint.id]: false }));
  }, [ontology]);

  // Auto-fetch when the active endpoint changes
  useEffect(() => {
    if (activeEndpoint && !datasets[activeEndpoint.id] && !loading[activeEndpoint.id]) {
      void fetchEndpoint(activeEndpoint);
    }
  }, [activeEndpoint, datasets, loading, fetchEndpoint]);

  const handleRefresh = () => {
    if (!activeEndpoint) return;
    setDatasets((prev) => {
      const next = { ...prev };
      delete next[activeEndpoint.id];
      return next;
    });
    void fetchEndpoint(activeEndpoint);
  };

  const handleClear = () => {
    if (!activeEndpointId) return;
    setDatasets((prev) => {
      const next = { ...prev };
      delete next[activeEndpointId];
      return next;
    });
  };

  const previewRows = useMemo(
    () => activeDataset?.rows.slice(0, 10) ?? [],
    [activeDataset],
  );

  // Translate source columns into ontology property names when a mapping exists
  const previewColumns = useMemo<PreviewColumn[]>(() => {
    const mappings = activeEndpoint?.columnMappings;
    const keys = new Set<string>();
    for (const row of previewRows) {
      Object.keys(row).forEach((k) => keys.add(k));
    }
    return Array.from(keys).slice(0, 6).map((key) => {
      const mappedProp = mappings?.[key];
      return { key, label: mappedProp ?? key, mapped: Boolean(mappedProp) };
    });
  }, [previewRows, activeEndpoint]);

  const mappedCount = previewColumns.filter((c) => c.mapped).length;

  return (
    <div className="instance-browser-panel">
      <button
        className="stats-panel-header"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <span className="stats-panel-title">
          <Database size={14} />
          实例浏览
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: 14 }}>
              {endpoints.length === 0 && (
                <div style={{
                  padding: 14,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}>
                  {fallbackSample.length > 0 ? (
                    <>
                      尚未接入数据源，下方展示的是 <strong>{ontology.name}</strong> 的内置样本数据。
                      点击顶部「接入数据源」可拉取真实数据。
                    </>
                  ) : (
                    <>尚未接入数据源。点击顶部「接入数据源」可拉取真实 RDF / 数据库实例。</>
                  )}
                </div>
              )}

              {endpoints.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <select
                      className="endpoint-form-input"
                      style={{ flex: 1, fontSize: 12 }}
                      value={activeEndpointId ?? ''}
                      onChange={(e) => setActiveEndpointId(e.target.value || null)}
                    >
                      <option value="">— 选择数据源 —</option>
                      {endpoints.map((ep) => (
                        <option key={ep.id} value={ep.id}>{ep.name}</option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      onClick={handleRefresh}
                      disabled={!activeEndpoint || activeLoading}
                      title="刷新"
                      aria-label="刷新"
                    >
                      <RefreshCw size={14} className={activeLoading ? 'endpoint-spin' : ''} />
                    </button>
                    {activeDataset && (
                      <button
                        className="icon-btn"
                        onClick={handleClear}
                        title="清空"
                        aria-label="清空"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {activeLoading && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: 10, fontSize: 12, color: 'var(--text-secondary)',
                    }}>
                      <Loader2 size={14} className="endpoint-spin" /> 正在加载 {activeSourceLabel} …
                    </div>
                  )}

                  {activeDataset && !activeDataset.error && (
                    <div className="endpoint-status endpoint-status--ok" style={{ marginBottom: 8 }}>
                      <CheckCircle size={12} />
                      <span>共 {activeDataset.rowCount} 条记录（{new Date(activeDataset.fetchedAt).toLocaleTimeString()}）</span>
                    </div>
                  )}

                  {activeDataset?.error && (
                    <div className="endpoint-status endpoint-status--err">
                      <AlertCircle size={12} />
                      <span>{activeDataset.error}</span>
                    </div>
                  )}
                </>
              )}

              {/* The actual data table */}
              {((activeDataset && activeDataset.rows.length > 0) || fallbackSample.length > 0) && (
                <div className="instance-table-wrapper">
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                    marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <Table2 size={12} />
                    {activeDataset ? `来自 ${activeDataset.endpointName}` : `内置样本 · ${ontology.name}`}
                  </div>

                  {activeDataset ? (
                    <>
                      {(activeEntity || mappedCount > 0) && (
                        <div className="instance-map-summary">
                          <Link2 size={11} />
                          {activeEntity && (
                            <span>
                              映射到实体 <strong style={{ color: activeEntity.color }}>{activeEntity.name}</strong>
                            </span>
                          )}
                          {activeEntity && mappedCount > 0 && <span>·</span>}
                          {mappedCount > 0 && (
                            <span>{mappedCount}/{previewColumns.length} 列已建立列映射</span>
                          )}
                        </div>
                      )}
                      <table className="instance-table">
                        <thead>
                          <tr>
                            {previewColumns.map((c) => (
                              <th key={c.key} className={c.mapped ? 'col-mapped' : undefined}>
                                {c.label}
                                {c.mapped && <span className="col-map">← {c.key}</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, idx) => (
                            <tr key={idx}>
                              {previewColumns.map((c) => (
                                <td key={c.key} title={formatCell(row[c.key])}>{formatCell(row[c.key])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <SampleTable instances={fallbackSample} />
                  )}
                  {activeDataset && activeDataset.rowCount > previewRows.length && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'center' }}>
                      仅展示前 {previewRows.length} 条，共 {activeDataset.rowCount} 条
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SampleTable({ instances }: { instances: typeof sampleInstances }) {
  const preview = instances.slice(0, 6);
  const columns = preview[0] ? Object.keys(preview[0].values).slice(0, 5) : [];
  return (
    <table className="instance-table">
      <thead>
        <tr>
          {columns.map((c) => (<th key={c}>{c}</th>))}
        </tr>
      </thead>
      <tbody>
        {preview.map((inst) => (
          <tr key={inst.id}>
            {columns.map((c) => (
              <td key={c}>{formatCell(inst.values[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
