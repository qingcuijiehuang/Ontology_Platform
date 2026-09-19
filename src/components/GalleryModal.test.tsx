import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryModal } from './GalleryModal';
import { useAppStore } from '../store/appStore';
import { useDesignerStore } from '../store/designerStore';
import { saveUserOntology } from '../lib/userOntologyLibrary';
import type { Catalogue } from '../types/catalogue';
import type { Ontology } from '../data/ontology';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const htmlProps = Object.fromEntries(
        Object.entries(props).filter(
          ([k]) =>
            !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout'].includes(k),
        ),
      );
      return <div {...htmlProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const makeOntology = (name: string, entityCount = 2, relCount = 1): Ontology => ({
  name,
  description: `${name} description`,
  entityTypes: Array.from({ length: entityCount }, (_, i) => ({
    id: `entity-${i}`,
    name: `Entity ${i}`,
    description: '',
    icon: '📦',
    color: '#000',
    properties: [{ name: 'id', type: 'string' as const, isIdentifier: true }],
  })),
  relationships: Array.from({ length: relCount }, (_, i) => ({
    id: `rel-${i}`,
    name: `rel-${i}`,
    from: 'entity-0',
    to: `entity-${Math.min(i + 1, entityCount - 1)}`,
    cardinality: 'one-to-many' as const,
    description: '',
  })),
});

const fakeCatalogue: Catalogue = {
  generatedAt: '2025-01-01T00:00:00Z',
  count: 3,
  entries: [
    {
      id: 'official/cosmic-coffee',
      name: 'Fourth Coffee',
      description: 'Coffee supply chain ontology',
      icon: '☕',
      category: 'retail',
      tags: ['coffee', 'supply-chain'],
      author: 'Ontology Playground',
      source: 'official',
      ontology: makeOntology('Fourth Coffee', 3, 2),
      bindings: [],
    },
    {
      id: 'community/drsmith/hospital-net',
      name: 'Hospital Network',
      description: 'Healthcare facility ontology',
      icon: '🏥',
      category: 'healthcare',
      tags: ['health', 'hospital'],
      author: 'Dr. Smith',
      source: 'community',
      ontology: makeOntology('Hospital Network', 4, 3),
      bindings: [],
    },
    {
      id: 'official/finance-ledger',
      name: 'Finance Ledger',
      description: 'Financial transactions ontology',
      category: 'finance',
      tags: ['finance', 'ledger'],
      author: 'FinCorp',
      source: 'official',
      ontology: makeOntology('Finance Ledger', 2, 1),
      bindings: [],
    },
  ],
};

function mockFetchSuccess(data: Catalogue = fakeCatalogue) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFetchFailure(status = 404) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
  } as Response);
}

describe('GalleryModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    useAppStore.getState().resetToDefault();
    window.location.hash = '#/catalogue';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state then renders catalogue entries', async () => {
    mockFetchSuccess();
    render(<GalleryModal onClose={onClose} />);

    // Loading state appears first
    expect(screen.getByText('正在加载本体库…')).toBeTruthy();

    // Entries appear after fetch
    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });
    expect(screen.getByText('Hospital Network')).toBeTruthy();
    expect(screen.getByText('Finance Ledger')).toBeTruthy();
    expect(screen.queryByText('正在加载本体库…')).toBeNull();
  });

  it('shows error state on fetch failure', async () => {
    mockFetchFailure(500);
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/本体库加载失败|Failed to load catalogue/)).toBeTruthy();
    });
  });

  it('filters entries by search query (name)', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/按名称、标签、作者搜索/);
    await user.type(searchInput, 'hospital');

    expect(screen.queryByText('Fourth Coffee')).toBeNull();
    expect(screen.getByText('Hospital Network')).toBeTruthy();
    expect(screen.queryByText('Finance Ledger')).toBeNull();
  });

  it('filters entries by search query (tag)', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/按名称、标签、作者搜索/);
    await user.type(searchInput, 'ledger');

    expect(screen.queryByText('Fourth Coffee')).toBeNull();
    expect(screen.queryByText('Hospital Network')).toBeNull();
    expect(screen.getByText('Finance Ledger')).toBeTruthy();
  });

  it('filters by category', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    // Select healthcare category
    const categorySelect = screen.getByDisplayValue('全部分类');
    await user.selectOptions(categorySelect, 'healthcare');

    expect(screen.queryByText('Fourth Coffee')).toBeNull();
    expect(screen.getByText('Hospital Network')).toBeTruthy();
    expect(screen.queryByText('Finance Ledger')).toBeNull();
  });

  it('filters by source (community)', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    const sourceSelect = screen.getByDisplayValue('全部来源');
    await user.selectOptions(sourceSelect, 'community');

    expect(screen.queryByText('Fourth Coffee')).toBeNull();
    expect(screen.getByText('Hospital Network')).toBeTruthy();
    expect(screen.queryByText('Finance Ledger')).toBeNull();
  });

  it('shows empty message when no entries match filters', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/按名称、标签、作者搜索/);
    await user.type(searchInput, 'xyznonexistent');

    expect(screen.getByText('没有本体匹配你的筛选条件。')).toBeTruthy();
  });

  it('loads an ontology and navigates to its deep link', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    // Click the first non-active ontology's "Load" button.
    const loadButtons = screen.getAllByText('加载');
    await user.click(loadButtons[0]);

    const state = useAppStore.getState();
    expect(state.currentOntology.name).toBe('Hospital Network');
    expect(state.currentOntology.entityTypes).toHaveLength(4);
    // Now navigates to deep link instead of calling onClose
    expect(window.location.hash).toBe('#/catalogue/community/drsmith/hospital-net');
  });

  it('shows "Community" badge only on community entries', async () => {
    mockFetchSuccess();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    // "Community" appears in the source filter dropdown AND as a badge.
    // Only Hospital Network is community, so there should be exactly 1 badge
    // plus 1 option in the dropdown = 2 total.
    const allCommunity = screen.getAllByText('社区');
    expect(allCommunity).toHaveLength(2); // 1 dropdown option + 1 badge

    // The badge is a <span> inside a card, the option is in a <select>
    const badges = allCommunity.filter((el) => el.tagName !== 'OPTION');
    expect(badges).toHaveLength(1);
  });

  it('displays entity and relationship counts', async () => {
    mockFetchSuccess();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    // Fourth Coffee: 3 entities, 2 relationships
    expect(screen.getByText('3 个实体')).toBeTruthy();
    expect(screen.getByText('2 条关系')).toBeTruthy();
    // Hospital Network: 4 entities, 3 relationships
    expect(screen.getByText('4 个实体')).toBeTruthy();
    expect(screen.getByText('3 条关系')).toBeTruthy();
  });

  it('「在设计器中编辑」会把本体载入设计器 store 并跳转到设计器', async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    // Click the "在设计器中编辑" pencil button for the first entry
    const editButtons = screen.getAllByTitle('在设计器中编辑');
    expect(editButtons.length).toBeGreaterThan(0);
    await user.click(editButtons[0]);

    // The designer store should have the ontology loaded
    const designerState = useDesignerStore.getState();
    expect(designerState.ontology.name).toBe('Fourth Coffee');
    expect(designerState.ontology.entityTypes).toHaveLength(3);
    expect(designerState.ontology.relationships).toHaveLength(2);

    // The app store (playground) should also have the ontology loaded
    const appState = useAppStore.getState();
    expect(appState.currentOntology.name).toBe('Fourth Coffee');
    expect(appState.currentOntology.entityTypes).toHaveLength(3);

    // Should navigate to designer, NOT to home
    expect(window.location.hash).toBe('#/designer');

    // onClose should NOT be called (navigation handles unmounting)
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('GalleryModal — 本体库本地保存区（我的）', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    useAppStore.getState().resetToDefault();
    window.localStorage.clear();
    window.location.hash = '#/catalogue';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 往 localStorage 塞两条本地保存的本体。 */
  const seedLocal = () => {
    saveUserOntology(makeOntology('我的汽车网关', 5, 4), []);
    saveUserOntology(makeOntology('我的测试本体'), []);
  };

  it('本地保存的本体会出现在本体库里，并带「我的」徽标', async () => {
    seedLocal();
    mockFetchSuccess();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('我的汽车网关')).toBeTruthy();
    });
    expect(screen.getByText('我的测试本体')).toBeTruthy();

    // 「我的」徽标：来源筛选下拉 1 个 option + 2 张卡片 = 3
    const allMine = screen.getAllByText('我的');
    expect(allMine).toHaveLength(3);
    expect(allMine.filter((el) => el.tagName !== 'OPTION')).toHaveLength(2);
  });

  it('来源筛选「我的」只显示本地保存的本体', async () => {
    seedLocal();
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Fourth Coffee')).toBeTruthy();
    });

    const sourceSelect = screen.getByDisplayValue('全部来源');
    await user.selectOptions(sourceSelect, 'local');

    expect(screen.getByText('我的汽车网关')).toBeTruthy();
    expect(screen.getByText('我的测试本体')).toBeTruthy();
    expect(screen.queryByText('Fourth Coffee')).toBeNull();
    expect(screen.queryByText('Hospital Network')).toBeNull();
  });

  it('加载本地本体后关闭弹窗（本地条目没有可分享的深链）', async () => {
    seedLocal();
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('我的汽车网关')).toBeTruthy();
    });

    await user.click(screen.getAllByText('加载')[0]);

    // 列表按保存时间倒序，第一张卡片是最后保存的「我的测试本体」
    expect(useAppStore.getState().currentOntology.name).toBe('我的测试本体');
    expect(onClose).toHaveBeenCalled();
  });

  it('删除本地本体需要确认，确认后从列表移除', async () => {
    seedLocal();
    mockFetchSuccess();
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('我的汽车网关')).toBeTruthy();
    });

    // 两条本地本体各有一个删除按钮；删除第一张卡片（排序最新的在前 = 我的测试本体）
    const deleteButtons = screen.getAllByTitle('从本体库中删除');
    expect(deleteButtons).toHaveLength(2);
    await user.click(deleteButtons[0]);

    expect(confirmSpy).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText('我的测试本体')).toBeNull();
    });
    expect(screen.getByText('我的汽车网关')).toBeTruthy();

    // 取消确认则不删除
    confirmSpy.mockReturnValue(false);
    await user.click(screen.getByTitle('从本体库中删除'));
    expect(screen.getByText('我的汽车网关')).toBeTruthy();
  });

  it('卡片显示随本体保存的数据源数量，加载时一并恢复这些数据源', async () => {
    saveUserOntology(makeOntology('带数据源的本体', 3, 2), [], [
      { id: 'ep_1', kind: 'rest', name: '客户接口', url: 'https://api.example.com/customers' },
      {
        id: 'ep_2',
        kind: 'json-file',
        name: '本地订单文件',
        url: 'local://orders.json',
        localRows: [{ orderId: 'A-1' }],
        localFileName: 'orders.json',
      },
    ]);
    mockFetchSuccess();
    const user = userEvent.setup();
    useAppStore.getState().resetEndpoints();
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('带数据源的本体')).toBeTruthy();
    });
    expect(screen.getByText('2 个数据源')).toBeTruthy();

    await user.click(screen.getAllByText('加载')[0]);

    const endpoints = useAppStore.getState().endpoints;
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].name).toBe('客户接口');
    // 本地文件的行数据不随库存放：加载后标记为「需重新上传文件」，状态重置为 idle
    expect(endpoints[1].needsFileReupload).toBe(true);
    expect(endpoints[1].localRows).toBeUndefined();
    expect(endpoints[1].lastFetchStatus).toBe('idle');
  });

  it('加载从未存过数据源的本地本体，不会清空当前已接入的数据源', async () => {
    saveUserOntology(makeOntology('纯本体', 2, 1), []);
    mockFetchSuccess();
    const user = userEvent.setup();
    useAppStore.getState().setEndpoints([
      { id: 'ep_keep', kind: 'rest', name: '保留我的数据源', url: 'https://example.com/keep' },
    ]);
    render(<GalleryModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('纯本体')).toBeTruthy();
    });
    await user.click(screen.getAllByText('加载')[0]);

    expect(useAppStore.getState().endpoints).toHaveLength(1);
    expect(useAppStore.getState().endpoints[0].name).toBe('保留我的数据源');
  });
});
