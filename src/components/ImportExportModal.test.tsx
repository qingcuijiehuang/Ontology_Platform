import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportExportModal } from './ImportExportModal';
import { useAppStore } from '../store/appStore';
import { serializeToRDF } from '../lib/rdf/serializer';
import type { Ontology } from '../data/ontology';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const htmlProps = Object.fromEntries(
        Object.entries(props).filter(([k]) =>
          !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap'].includes(k)
        )
      );
      return <div {...htmlProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const testOntology: Ontology = {
  name: 'Test Widgets',
  description: 'A test ontology for integration testing',
  entityTypes: [
    {
      id: 'widget',
      name: 'Widget',
      description: 'A widget entity',
      icon: '⚙️',
      color: '#FF5733',
      properties: [
        { name: 'widget_id', type: 'string', isIdentifier: true },
        { name: 'label', type: 'string' },
        { name: 'weight', type: 'decimal' },
      ],
    },
    {
      id: 'factory',
      name: 'Factory',
      description: 'Produces widgets',
      icon: '🏭',
      color: '#3357FF',
      properties: [
        { name: 'factory_id', type: 'string', isIdentifier: true },
        { name: 'location', type: 'string' },
      ],
    },
  ],
  relationships: [
    {
      id: 'produces',
      name: 'produces',
      from: 'factory',
      to: 'widget',
      cardinality: 'one-to-many' as const,
      description: 'Factory produces widgets',
    },
  ],
};

function createRdfFile(rdfContent: string, fileName = 'test-ontology.rdf'): File {
  return new File([rdfContent], fileName, { type: 'application/rdf+xml' });
}

describe('ImportExportModal integration', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    // Reset the store to default before each test
    useAppStore.getState().resetToDefault();
  });

  it('imports a valid RDF file and updates the store', async () => {
    const rdfContent = serializeToRDF(testOntology);
    const file = createRdfFile(rdfContent);

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.currentOntology.name).toBe('Test Widgets');
    });

    const state = useAppStore.getState();
    expect(state.currentOntology.entityTypes).toHaveLength(2);
    expect(state.currentOntology.relationships).toHaveLength(1);
    expect(state.currentOntology.entityTypes.find(e => e.id === 'widget')?.properties).toHaveLength(3);
    expect(state.currentOntology.entityTypes.find(e => e.id === 'factory')?.properties).toHaveLength(2);
    expect(state.currentOntology.relationships[0].name).toBe('produces');

    // Success message should be shown
    expect(screen.getByText('本体已成功加载！')).toBeTruthy();
  });

  it('shows an error for malformed RDF', async () => {
    const file = createRdfFile('this is not valid XML at all');

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/RDF 解析错误/)).toBeTruthy();
    });

    // Store should remain unchanged (still default Fourth Coffee)
    const state = useAppStore.getState();
    expect(state.currentOntology.name).toBe('Fourth Coffee');
  });

  it('shows an error for unsupported file extensions', async () => {
    const file = new File(['some data'], 'ontology.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    render(<ImportExportModal onClose={onClose} />);

    // Use fireEvent to bypass the accept attribute filtering in userEvent
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/不支持的文件格式/)).toBeTruthy();
    });

    // Store should remain unchanged
    const state = useAppStore.getState();
    expect(state.currentOntology.name).toBe('Fourth Coffee');
  });

  it('uses parser default name when RDF has no ontology label', async () => {
    // Build minimal valid RDF with no rdfs:label on the Ontology element
    const minimalRdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">
  <owl:Ontology rdf:about="http://example.org/test"/>
  <owl:Class rdf:about="http://example.org/test#Thing">
    <rdfs:label>Thing</rdfs:label>
  </owl:Class>
</rdf:RDF>`;

    const file = createRdfFile(minimalRdf, 'my-cool-ontology.rdf');

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    // Parser returns 'Imported Ontology' as default when no label is present.
    // The filename fallback in the modal only applies when name is empty.
    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.currentOntology.name).toBe('Imported Ontology');
      expect(state.currentOntology.entityTypes).toHaveLength(1);
      expect(state.currentOntology.entityTypes[0].name).toBe('Thing');
    });
  });

  it('imports an .owl file by extension', async () => {
    const rdfContent = serializeToRDF(testOntology);
    const file = new File([rdfContent], 'widgets.owl', { type: 'application/rdf+xml' });

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.currentOntology.name).toBe('Test Widgets');
      expect(state.currentOntology.entityTypes).toHaveLength(2);
    });
  });

  it('imports data bindings from RDF', async () => {
    const bindings = [
      { entityTypeId: 'widget', source: 'WidgetSource', table: 'WidgetTable', columnMappings: { widget_id: 'WidgetID' } },
    ];
    const rdfContent = serializeToRDF(testOntology, bindings);
    const file = createRdfFile(rdfContent);

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.dataBindings).toHaveLength(1);
      expect(state.dataBindings[0].entityTypeId).toBe('widget');
      expect(state.dataBindings[0].source).toBe('WidgetSource');
      expect(state.dataBindings[0].table).toBe('WidgetTable');
    });
  });

  it('warns instead of loading an empty graph when the RDF has no classes', async () => {
    const rdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">
  <owl:Ontology rdf:about="http://example.org/empty">
    <rdfs:label>Only Metadata</rdfs:label>
  </owl:Ontology>
</rdf:RDF>`;
    const file = createRdfFile(rdf, 'metadata-only.rdf');

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/没有任何类/)).toBeTruthy();
    });

    // 空本体不应覆盖当前已加载的本体
    expect(useAppStore.getState().currentOntology.name).toBe('Fourth Coffee');
  });

  it('tells the user how to convert a Turtle file', async () => {
    const file = new File(['@prefix owl: <http://www.w3.org/2002/07/owl#> .'], 'my-ontology.ttl', {
      type: 'text/turtle',
    });

    render(<ImportExportModal onClose={onClose} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/RDF\/XML/)).toBeTruthy();
    });

    expect(useAppStore.getState().currentOntology.name).toBe('Fourth Coffee');
  });
});

describe('ImportExportModal — 存入本体库', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    useAppStore.getState().resetToDefault();
    window.localStorage.clear();
  });

  it('导入成功后提供「存入本体库」，点击后写入本地本体库', async () => {
    const rdfContent = serializeToRDF(testOntology);
    const file = createRdfFile(rdfContent);

    render(<ImportExportModal onClose={onClose} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    const saveBtn = await screen.findByRole('button', { name: /存入本体库/ });
    expect(saveBtn).toBeTruthy();
    // 没保存前按钮是可点击状态
    expect(saveBtn).not.toHaveProperty('disabled', true);

    await userEvent.click(saveBtn);

    // 按钮变为「已存入本体库」，下方出现提示文案
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已存入本体库' })).toBeTruthy();
    });
    expect(screen.getByText(/可在「本体库」里随时加载/)).toBeTruthy();

    // localStorage 里出现了这条本体
    const raw = window.localStorage.getItem('ontology-platform.user-ontology-library');
    expect(raw).toBeTruthy();
    const entries = JSON.parse(raw as string);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Test Widgets');
    expect(entries[0].source).toBe('local');
  });

  it('再次点击已保存的按钮不会重复写入（同名覆盖语义下的幂等展示）', async () => {
    const rdfContent = serializeToRDF(testOntology);
    const file = createRdfFile(rdfContent);

    render(<ImportExportModal onClose={onClose} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    const saveBtn = await screen.findByRole('button', { name: /存入本体库/ });
    await userEvent.click(saveBtn);

    // 按钮文案变为「已存入本体库」并禁用，防止重复点击
    const savedBtn = await screen.findByRole('button', { name: '已存入本体库' });
    expect(savedBtn).toHaveProperty('disabled', true);
    expect(window.localStorage.getItem('ontology-platform.user-ontology-library') as string).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('ontology-platform.user-ontology-library') as string)).toHaveLength(1);
  });

  it('不渲染「推送到 Microsoft Fabric」按钮', async () => {
    const rdfContent = serializeToRDF(testOntology);
    const file = createRdfFile(rdfContent);

    render(<ImportExportModal onClose={onClose} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await screen.findByRole('button', { name: /存入本体库/ });
    expect(screen.queryByText(/推送到 Microsoft Fabric/)).toBeNull();
  });
});
