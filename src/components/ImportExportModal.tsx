import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Upload, Download, FileJson, AlertCircle, CheckCircle, RotateCcw, Copy, FileText, Table, Share2, LibraryBig } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { serializeToRDF } from '../lib/rdf/serializer';
import { parseRDF, RDFParseError } from '../lib/rdf/parser';
import { saveUserOntology } from '../lib/userOntologyLibrary';
import type { Ontology, DataBinding } from '../data/ontology';

const LEGACY_FORMATS_ENABLED = import.meta.env.VITE_ENABLE_LEGACY_FORMATS === 'true';

interface ImportExportModalProps {
  onClose: () => void;
}

const sampleSchema = `{
  "ontology": {
    "name": "我的本体",
    "description": "描述",
    "entityTypes": [
      {
        "id": "entity1",
        "name": "实体名称",
        "description": "实体说明",
        "icon": "📦",
        "color": "#0078D4",
        "properties": [
          { "name": "id", "type": "string", "isIdentifier": true },
          { "name": "name", "type": "string" }
        ]
      }
    ],
    "relationships": [
      {
        "id": "rel1",
        "name": "关联到",
        "from": "entity1",
        "to": "entity2",
        "cardinality": "1:n"
      }
    ]
  },
  "bindings": []
}`;

export function ImportExportModal({ onClose }: ImportExportModalProps) {
  const { currentOntology, dataBindings, loadOntology, resetToDefault, exportOntology } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'yaml' | 'csv' | 'rdf'>('rdf');
  /** 最近一次成功导入的本体 —— 「存入本体库」作用的对象。 */
  const [imported, setImported] = useState<{ ontology: Ontology; bindings: DataBinding[] } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string>('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const fileName = file.name.toLowerCase();
        // 先去掉 BOM 再判断，避免带 BOM 的 UTF-8 文件被判成「未知格式」
        const trimmed = content.replace(/^\uFEFF/, '').trimStart();
        const isRdfExt = fileName.endsWith('.rdf') || fileName.endsWith('.owl') || fileName.endsWith('.iq');
        const isXmlContent = trimmed.startsWith('<');

        let ontology: Ontology;
        let bindings: DataBinding[] = [];

        if (isXmlContent || isRdfExt) {
          // 解析器内部会识别 Turtle / JSON-LD 等非 XML 语法，
          // 并给出「如何转成 RDF/XML」的中文指引，而不是笼统地报解析失败。
          const result = parseRDF(content);
          ontology = result.ontology;
          bindings = result.bindings;
        } else if (/\.(ttl|n3|nt|trig|nq)$/.test(fileName)) {
          throw new Error(
            `「${file.name}」是 Turtle / N-Triples 语法，本平台目前只支持 RDF/XML。` +
              '请在 Protégé 里用「File → Save As → RDF/XML Syntax」另存为 .rdf / .owl 后再导入，' +
              '或先用在线转换工具把它转成 RDF/XML。',
          );
        } else if (/\.(jsonld|json-ld)$/.test(fileName)) {
          throw new Error(
            `「${file.name}」是 JSON-LD 格式，本平台目前只支持 RDF/XML。` +
              '请先用在线转换工具把它转成 RDF/XML（.rdf / .owl）后再导入。',
          );
        } else if (LEGACY_FORMATS_ENABLED && (fileName.endsWith('.json') || trimmed.startsWith('{'))) {
          // Parse as JSON (legacy)
          const parsed = JSON.parse(content);

          if (!parsed.ontology || !parsed.ontology.entityTypes || !parsed.ontology.relationships) {
            throw new Error('本体结构不合法，必须包含 ontology.entityTypes 与 ontology.relationships。');
          }

          ontology = parsed.ontology;
          bindings = parsed.bindings || [];
        } else {
          const supported = LEGACY_FORMATS_ENABLED
            ? '一个 RDF/OWL (.rdf, .owl, .iq) 或 JSON (.json) 文件'
            : '一个 RDF/OWL (.rdf, .owl, .iq) 文件';
          throw new Error(`不支持的文件格式："${file.name}"，请导入 ${supported}。`);
        }

        // 解析成功但没有任何类定义 —— 图谱会是空的，提前讲清楚而不是让用户面对空画布
        if (ontology.entityTypes.length === 0) {
          setImportStatus('error');
          setErrorMessage(
            '文件解析成功，但里面没有任何类（owl:Class / rdfs:Class）定义，导入后图谱会是空的。' +
              '请确认导出时包含了类定义；若这份文件其实是实例数据，可用顶栏的「接入数据源」加载。',
          );
          return;
        }

        // Fall back to filename (without extension) if no ontology name was parsed
        if (!ontology.name) {
          ontology.name = file.name.replace(/\.[^.]+$/, '');
        }

        loadOntology(ontology, bindings);
        setImported({ ontology, bindings });
        setImportStatus('success');
        setErrorMessage('');
        setSaveStatus('idle');
        setSaveMessage('');
        // 导入成功后停留在弹窗内，让用户决定是否「存入本体库」；
        // 「完成」按钮随时可以关闭。
      } catch (err) {
        setImportStatus('error');
        if (err instanceof RDFParseError) {
            setErrorMessage(`RDF 解析错误：${err.message}`);
          } else {
            setErrorMessage(err instanceof Error ? err.message : '解析文件失败');
          }
      }
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    let content: string;
    let mimeType: string;
    let extension: string;

    if (exportFormat === 'yaml') {
      content = exportAsYAML();
      mimeType = 'text/yaml';
      extension = 'yaml';
    } else if (exportFormat === 'csv') {
      content = exportAsCSV();
      mimeType = 'text/csv';
      extension = 'csv';
    } else if (exportFormat === 'rdf') {
      content = serializeToRDF(currentOntology, dataBindings);
      mimeType = 'application/rdf+xml';
      extension = 'rdf';
    } else {
      content = exportOntology();
      mimeType = 'application/json';
      extension = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentOntology.name.toLowerCase().replace(/\s+/g, '-')}-ontology.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Simple YAML exporter (no external dependencies)
  const exportAsYAML = (): string => {
    const indent = (level: number) => '  '.repeat(level);
    let yaml = '';

    yaml += 'ontology:\n';
    yaml += `${indent(1)}name: "${currentOntology.name}"\n`;
    yaml += `${indent(1)}description: "${currentOntology.description || ''}"\n`;
    yaml += `${indent(1)}entityTypes:\n`;

    for (const entity of currentOntology.entityTypes) {
      yaml += `${indent(2)}- id: "${entity.id}"\n`;
      yaml += `${indent(3)}name: "${entity.name}"\n`;
      yaml += `${indent(3)}description: "${entity.description || ''}"\n`;
      yaml += `${indent(3)}icon: "${entity.icon}"\n`;
      yaml += `${indent(3)}color: "${entity.color}"\n`;
      yaml += `${indent(3)}properties:\n`;
      for (const prop of entity.properties) {
        yaml += `${indent(4)}- name: "${prop.name}"\n`;
        yaml += `${indent(5)}type: "${prop.type}"\n`;
        if (prop.isIdentifier) yaml += `${indent(5)}isIdentifier: true\n`;
      }
    }

    yaml += `${indent(1)}relationships:\n`;
    for (const rel of currentOntology.relationships) {
      yaml += `${indent(2)}- id: "${rel.id}"\n`;
      yaml += `${indent(3)}name: "${rel.name}"\n`;
      yaml += `${indent(3)}from: "${rel.from}"\n`;
      yaml += `${indent(3)}to: "${rel.to}"\n`;
      yaml += `${indent(3)}cardinality: "${rel.cardinality}"\n`;
    }

    if (dataBindings.length > 0) {
      yaml += '\nbindings:\n';
      for (const binding of dataBindings) {
        yaml += `${indent(1)}- entityTypeId: "${binding.entityTypeId}"\n`;
        yaml += `${indent(2)}source: "${binding.source}"\n`;
      }
    }

    return yaml;
  };

  // Export entities and relationships as CSV tables
  const exportAsCSV = (): string => {
    let csv = '';

    // Entity Types table
    csv += '# ENTITY TYPES\n';
    csv += 'id,name,description,icon,color,properties\n';
    for (const entity of currentOntology.entityTypes) {
      const props = entity.properties.map(p => p.name).join(';');
      csv += `"${entity.id}","${entity.name}","${entity.description || ''}","${entity.icon}","${entity.color}","${props}"\n`;
    }

    csv += '\n';

    // Relationships table
    csv += '# RELATIONSHIPS\n';
    csv += 'id,name,from,to,cardinality,description\n';
    for (const rel of currentOntology.relationships) {
      csv += `"${rel.id}","${rel.name}","${rel.from}","${rel.to}","${rel.cardinality}","${rel.description || ''}"\n`;
    }

    // Properties detail table
    csv += '\n# PROPERTIES BY ENTITY\n';
    csv += 'entity_id,property_name,property_type,is_identifier\n';
    for (const entity of currentOntology.entityTypes) {
      for (const prop of entity.properties) {
        csv += `"${entity.id}","${prop.name}","${prop.type}","${prop.isIdentifier || false}"\n`;
      }
    }

    return csv;
  };

  const handleCopySchema = () => {
    navigator.clipboard.writeText(sampleSchema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    resetToDefault();
    setImported(null);
    setImportStatus('success');
    setErrorMessage('');
    setSaveStatus('idle');
    setSaveMessage('');
    setTimeout(() => onClose(), 1000);
  };

  /** 把最近一次成功导入的本体存入本体库（localStorage），供「本体库」随时加载。 */
  const handleSaveToLibrary = () => {
    if (!imported) return;
    try {
      saveUserOntology(imported.ontology, imported.bindings);
      setSaveStatus('saved');
      setSaveMessage(`「${imported.ontology.name}」已存入本体库，可在「本体库」里随时加载。`);
    } catch (err) {
      setSaveStatus('error');
      setSaveMessage(err instanceof Error ? err.message : '保存到本体库失败。');
    }
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
        style={{ maxWidth: 650, maxHeight: '85vh', overflow: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 600 }}>导入 / 导出本体</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
              加载你自己的本体，或导出当前正在编辑的本体
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Current Ontology Info */}
        <div style={{
          padding: 16,
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 4 }}>当前加载的本体</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{currentOntology.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {currentOntology.entityTypes.length} 个实体类型，{currentOntology.relationships.length} 条关系
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleReset}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={14} />
            恢复默认
          </button>
        </div>

        {/* Status Messages */}
        {importStatus === 'success' && (
          <div style={{
            padding: 12,
            background: 'rgba(15, 123, 15, 0.15)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--ms-green)'
          }}>
            <CheckCircle size={18} />
            <span style={{ flex: 1 }}>本体已成功加载！</span>
            {imported && (
              <button
                className="btn btn-secondary"
                onClick={handleSaveToLibrary}
                disabled={saveStatus === 'saved'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: saveStatus === 'saved' ? 'var(--ms-green)' : undefined,
                  borderColor: saveStatus === 'saved' ? 'var(--ms-green)' : undefined,
                }}
                title="把这份本体保存到本体库（仅存在本浏览器），之后可在「本体库」里一键加载"
              >
                <LibraryBig size={14} />
                {saveStatus === 'saved' ? '已存入本体库' : '存入本体库'}
              </button>
            )}
          </div>
        )}

        {saveMessage && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            marginBottom: 20,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: saveStatus === 'error' ? 'rgba(209, 52, 56, 0.12)' : 'rgba(0, 120, 212, 0.08)',
            color: saveStatus === 'error' ? '#D13438' : 'var(--text-secondary)',
          }} role="status" aria-live="polite">
            {saveStatus === 'error' ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
            <span>{saveMessage}</span>
          </div>
        )}

        {importStatus === 'error' && (
          <div style={{
            padding: 12,
            background: 'rgba(209, 52, 56, 0.15)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            color: '#D13438'
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Import/Export Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div 
            style={{ 
              padding: 24, 
              background: 'var(--bg-tertiary)', 
              borderRadius: 'var(--radius-lg)',
              border: '2px dashed var(--border-primary)',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s'
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && fileInputRef.current) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                fileInputRef.current.files = dataTransfer.files;
                fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              accept={LEGACY_FORMATS_ENABLED ? '.json,.rdf,.owl,.iq' : '.rdf,.owl,.iq'}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <div style={{ 
              width: 48, 
              height: 48, 
              background: 'rgba(0, 120, 212, 0.15)', 
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px'
            }}>
              <Upload size={24} color="var(--ms-blue)" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>导入本体</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {LEGACY_FORMATS_ENABLED ? '把 JSON 或 RDF/OWL 文件拖到这里' : '把 RDF/OWL (.rdf, .owl, .iq) 文件拖到这里'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
              兼容 owl:Class / rdfs:Class，
              以及 rdf:Description + rdf:type 两种 RDF/XML 写法
            </div>
          </div>

          <div
            style={{
              padding: 24,
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-lg)',
              border: '2px solid transparent',
              textAlign: 'center'
            }}
          >
            <div style={{
              width: 48,
              height: 48,
              background: 'rgba(15, 123, 15, 0.15)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px'
            }}>
              <Download size={24} color="var(--ms-green)" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>导出当前本体</div>
            
            {/* Format Selector — only shown when legacy formats are enabled */}
            {LEGACY_FORMATS_ENABLED && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12 }}>
                <button
                  onClick={() => setExportFormat('json')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: exportFormat === 'json' ? 'var(--ms-blue)' : 'var(--bg-secondary)',
                    color: exportFormat === 'json' ? 'white' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <FileJson size={12} />
                  JSON
                </button>
                <button
                  onClick={() => setExportFormat('yaml')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: exportFormat === 'yaml' ? 'var(--ms-purple)' : 'var(--bg-secondary)',
                    color: exportFormat === 'yaml' ? 'white' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <FileText size={12} />
                  YAML
                </button>
                <button
                  onClick={() => setExportFormat('csv')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: exportFormat === 'csv' ? 'var(--ms-green)' : 'var(--bg-secondary)',
                    color: exportFormat === 'csv' ? 'white' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <Table size={12} />
                  CSV
                </button>
                <button
                  onClick={() => setExportFormat('rdf')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: exportFormat === 'rdf' ? '#E74C3C' : 'var(--bg-secondary)',
                    color: exportFormat === 'rdf' ? 'white' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                  title="RDF/XML 格式（兼容 Microsoft Fabric）"
                >
                  <Share2 size={12} />
                  RDF
                </button>
              </div>
            )}
            
            <button
              className="btn btn-primary"
              onClick={handleExport}
              style={{ width: '100%' }}
            >
              {LEGACY_FORMATS_ENABLED ? `Download .${exportFormat}` : 'Download RDF/OWL'}
            </button>
          </div>
        </div>

        {/* Schema Reference — only shown when legacy JSON format is enabled */}
        {LEGACY_FORMATS_ENABLED && (
          <div>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 12 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileJson size={16} color="var(--text-tertiary)" />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  JSON 结构参考
                </span>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={handleCopySchema}
              >
                <Copy size={12} style={{ marginRight: 4 }} />
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre style={{ 
              padding: 16, 
              background: 'var(--bg-primary)', 
              borderRadius: 'var(--radius-md)',
              fontSize: 11,
              lineHeight: 1.5,
              overflow: 'auto',
              maxHeight: 200,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)'
            }}>
              {sampleSchema}
            </pre>
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
