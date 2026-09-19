import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EndpointConnector } from './EndpointConnector';
import { useAppStore } from '../store/appStore';

// framer-motion 在 jsdom 里会带来动画相关的噪音，这里替换成普通 div
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

beforeEach(() => {
  cleanup();
  useAppStore.getState().resetEndpoints();
});

describe('EndpointConnector — 面板结构（无内置数据集）', () => {
  it('面板打开时已接入列表为空，提供「自定义接入」与「清空全部」', () => {
    render(<EndpointConnector onClose={() => {}} />);

    expect(useAppStore.getState().endpoints).toHaveLength(0);
    expect(screen.getByText(/还没有接入任何数据源/)).toBeInTheDocument();
    expect(screen.getByText('自定义接入')).toBeInTheDocument();
    expect(screen.getByText('清空全部')).toBeInTheDocument();
    // 平台不内置任何数据集：面板里不存在预设案例集分组
    expect(screen.queryByText(/可选数据源案例集/)).not.toBeInTheDocument();
    expect(screen.queryByText(/内置样本数据集/)).not.toBeInTheDocument();
  });

  it('清空全部按钮会移除所有已接入的数据源', async () => {
    const user = userEvent.setup();
    useAppStore.getState().addEndpoint({ kind: 'rest', name: '临时接口', url: 'https://example.com/api' });
    render(<EndpointConnector onClose={() => {}} />);

    expect(useAppStore.getState().endpoints).toHaveLength(1);
    await user.click(screen.getByText('清空全部'));

    expect(useAppStore.getState().endpoints).toHaveLength(0);
    expect(await screen.findByText(/已清空全部数据源/)).toBeInTheDocument();
  });
});

describe('EndpointConnector — 存入本体库', () => {
  const LIBRARY_KEY = 'ontology-platform.user-ontology-library';

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('未接入任何数据源时按钮禁用', () => {
    render(<EndpointConnector onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /存入本体库/ })).toBeDisabled();
  });

  it('接入数据源后可存入本体库，条目里带上集成配置与当前本体', async () => {
    const user = userEvent.setup();
    useAppStore.getState().addEndpoint({
      kind: 'rest',
      name: '客户接口',
      url: 'https://api.example.com/customers',
      entityTypeId: 'customer',
      columnMappings: { customer_id: 'customerId' },
    });
    render(<EndpointConnector onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /存入本体库/ }));

    const stored = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) as string);
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe('local');
    expect(stored[0].ontology.name).toBe(useAppStore.getState().currentOntology.name);
    expect(stored[0].endpoints).toHaveLength(1);
    expect(stored[0].endpoints[0].name).toBe('客户接口');
    expect(stored[0].endpoints[0].columnMappings).toEqual({ customer_id: 'customerId' });

    expect(await screen.findByText(/已把.*与 1 个数据源存入本体库/)).toBeInTheDocument();
  });

  it('本地 JSON 文件的数据源会提示「行数据不随库存放、需重新上传」', async () => {
    const user = userEvent.setup();
    useAppStore.getState().addEndpoint({
      kind: 'json-file',
      name: '本地订单文件',
      url: 'local://orders.json',
      localRows: [{ orderId: 'A-1' }],
      localFileName: 'orders.json',
    });
    render(<EndpointConnector onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /存入本体库/ }));

    expect(await screen.findByText(/需重新上传该文件/)).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) as string);
    // 行数据不进 localStorage
    expect(stored[0].endpoints[0].localRows).toBeUndefined();
    expect(stored[0].endpoints[0].needsFileReupload).toBe(true);
  });
});

describe('EndpointConnector — 手动填写表单', () => {
  /** 展开「自定义接入」折叠区。 */
  const openCustomSection = async () => {
    const user = userEvent.setup();
    render(<EndpointConnector onClose={() => {}} />);
    await user.click(screen.getByText('自定义接入'));
    return user;
  };

  it('类型默认是「JSON 文件」，且排在下拉选项第一位', async () => {
    await openCustomSection();

    const select = screen.getByDisplayValue('JSON 文件') as HTMLSelectElement;
    expect(select.value).toBe('json-file');

    const options = Array.from(select.options);
    expect(options[0].textContent).toBe('JSON 文件');
    expect(options[0].value).toBe('json-file');
    // 其余类型依次排列
    expect(options.map((o) => o.value)).toEqual(['json-file', 'rest', 'sparql', 'graphql']);
  });

  it('手动填写 JSON 文件地址可添加数据源', async () => {
    const user = await openCustomSection();

    await user.type(screen.getByPlaceholderText('例如：我的 SPARQL 仓库'), '外部订单表');
    await user.type(screen.getByPlaceholderText('https://example.com/data.json'), 'https://cdn.example.com/orders.json');
    await user.click(screen.getByRole('button', { name: /添加数据源/ }));

    const endpoints = useAppStore.getState().endpoints;
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe('外部订单表');
    expect(endpoints[0].kind).toBe('json-file');
    expect(endpoints[0].url).toBe('https://cdn.example.com/orders.json');
  });
});

describe('EndpointConnector — 自动解析接入（上传 JSON 文件）', () => {
  /** 展开「自定义接入」折叠区。 */
  const openCustomSection = async () => {
    const user = userEvent.setup();
    render(<EndpointConnector onClose={() => {}} />);
    await user.click(screen.getByText('自定义接入'));
    return user;
  };

  const jsonFile = (name: string, content: string) =>
    new File([content], name, { type: 'application/json' });

  const uploadTo = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    return { input, file };
  };

  it('折叠区里同时提供「自动解析接入」和「或手动填写」两条路径', async () => {
    await openCustomSection();
    expect(screen.getByText('自动解析接入')).toBeInTheDocument();
    expect(screen.getByText('或手动填写')).toBeInTheDocument();
    expect(screen.getByText('点击选择 JSON 文件，或拖拽到此处')).toBeInTheDocument();
  });

  it('上传 JSON 后自动识别实体、生成列映射，接入后数据留在内存里', async () => {
    await openCustomSection();
    const { input, file } = uploadTo(
      jsonFile(
        'orders-2026-09.json',
        JSON.stringify([
          { order_id: 'SO-1001', order_total: 45.5, order_status: 'Pending' },
          { order_id: 'SO-1002', order_total: 12, order_status: 'Preparing' },
        ]),
      ),
    );

    fireEvent.change(input, { target: { files: [file] } });

    // 预览出现：文件名、行数列数、识别到的实体
    await screen.findByText('orders-2026-09.json');
    expect(screen.getByText(/2 行 · 3 列/)).toBeInTheDocument();
    // 列映射里 order_id → orderId
    expect(screen.getByText('orderId')).toBeInTheDocument();
    expect(screen.getByText('3/3 列已映射')).toBeInTheDocument();

    // 数据源名称默认取文件名（去掉扩展名）
    const nameInput = screen.getByDisplayValue('orders-2026-09');
    expect(nameInput).toBeInTheDocument();

    const before = useAppStore.getState().endpoints.length;
    await userEvent.click(screen.getByRole('button', { name: /接入这个数据源/ }));

    const endpoints = useAppStore.getState().endpoints;
    expect(endpoints).toHaveLength(before + 1);
    const added = endpoints[endpoints.length - 1];
    expect(added.name).toBe('orders-2026-09');
    expect(added.kind).toBe('json-file');
    expect(added.entityTypeId).toBe('order');
    expect(added.columnMappings?.order_id).toBe('orderId');
    expect(added.localFileName).toBe('orders-2026-09.json');
    expect(added.localRows).toHaveLength(2);
  });

  it('上传非 JSON 内容时给出可执行的中文提示，且不会新增数据源', async () => {
    await openCustomSection();
    const { input, file } = uploadTo(jsonFile('data.csv.json', 'id,name\n1,Alice'));

    fireEvent.change(input, { target: { files: [file] } });

    const message = await screen.findByText(/不是合法的 JSON/);
    expect(message).toBeInTheDocument();
    expect(screen.getByText('重新选择')).toBeInTheDocument();
    // 平台默认不接入任何数据源，解析失败后依然为空
    expect(useAppStore.getState().endpoints).toHaveLength(0);
  });

  it('非 .json 扩展名直接拒绝，不会去读文件内容', async () => {
    await openCustomSection();
    const { input, file } = uploadTo(new File(['{"a":1}'], 'data.txt', { type: 'text/plain' }));

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/请上传 \.json 文件/)).toBeInTheDocument();
  });

  it('识别不出实体时提示手动选择，仍可接入但 entityTypeId 为空', async () => {
    await openCustomSection();
    const { input, file } = uploadTo(jsonFile('env.json', JSON.stringify([{ foo: 1, bar: 2 }])));

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/未能自动识别对应的本体实体/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /接入这个数据源/ }));
    const endpoints = useAppStore.getState().endpoints;
    const added = endpoints[endpoints.length - 1];
    expect(added.entityTypeId).toBeUndefined();
    expect(added.columnMappings).toBeUndefined();
    expect(added.localRows).toHaveLength(1);
  });

  it('切换预览里的实体后，列映射会按新实体重算', async () => {
    await openCustomSection();
    const { input, file } = uploadTo(
      jsonFile('orders.json', JSON.stringify([{ order_id: 'SO-1', order_total: 5, order_status: 'Pending' }])),
    );
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText('orders.json');

    // 默认识别为订单：3 列全部映射上
    expect(screen.getByText('3/3 列已映射')).toBeInTheDocument();

    // 手动改成一个完全对不上的实体 → 映射清空
    const select = screen.getByLabelText('映射到的本体实体') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'customer');

    expect(screen.getByText('0/3 列已映射')).toBeInTheDocument();
    // 映射为 0 时给出提示
    expect(screen.getByText(/没有识别出列映射/)).toBeInTheDocument();
  });
});

describe('EndpointConnector — 多实体分桶图（objects + relationships）', () => {
  const openCustomSection = async () => {
    const user = userEvent.setup();
    render(<EndpointConnector onClose={() => {}} />);
    await user.click(screen.getByText('自定义接入'));
    return user;
  };

  const jsonFile = (name: string, content: string) =>
    new File([content], name, { type: 'application/json' });

  const upload = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });
  };

  /** 一份典型的分桶图：2 个实体桶 + 1 条关系。 */
  const BUCKETED = JSON.stringify({
    metadata: { domain: 'Automotive Embedded Software', scenario: 'Central Gateway ECU (CGW)' },
    objects: {
      Requirement: [{ requirement_id: 'REQ-1' }, { requirement_id: 'REQ-2' }],
      Test_Case: [{ test_case_id: 'TC-1' }],
    },
    relationships: [
      {
        from_type: 'Test_Case',
        from_id: 'TC-1',
        relation: 'verifies',
        to_type: 'Requirement',
        to_id: 'REQ-1',
      },
    ],
  });

  it('分桶文件预览为「实体桶列表」，接入后每个桶各成一个数据源', async () => {
    await openCustomSection();
    upload(jsonFile('automotive-ontology.json', BUCKETED));

    await screen.findByText('automotive-ontology.json');
    expect(screen.getByText(/2 个实体桶 · 3 行 · 1 条关系/)).toBeInTheDocument();
    expect(screen.getByText(/场景：Central Gateway ECU/)).toBeInTheDocument();
    expect(screen.getByText(/个桶已匹配/)).toBeInTheDocument();

    const before = useAppStore.getState().endpoints.length;
    await userEvent.click(screen.getByRole('button', { name: /接入选中的/ }));

    const endpoints = useAppStore.getState().endpoints;
    expect(endpoints).toHaveLength(before + 3);
    const names = endpoints.map((e) => e.name);
    expect(names).toContain('automotive-ontology · Requirement');
    expect(names).toContain('automotive-ontology · Test_Case');
    expect(names).toContain('automotive-ontology · relationships');

    const requirement = endpoints.find((e) => e.name.endsWith('· Requirement'))!;
    expect(requirement.kind).toBe('json-file');
    expect(requirement.localRows).toHaveLength(2);
    expect(requirement.localFileName).toBe('automotive-ontology.json');

    const relations = endpoints.find((e) => e.name.endsWith('· relationships'))!;
    expect(relations.localRows).toHaveLength(1);
  });

  it('取消勾选某个桶后，该桶不会被接入', async () => {
    await openCustomSection();
    upload(jsonFile('automotive.json', BUCKETED));
    await screen.findByText('automotive.json');

    const bucket = screen.getByRole('button', { name: /Test_Case/ });
    expect(bucket).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(bucket);

    await userEvent.click(screen.getByRole('button', { name: /接入选中的/ }));

    const names = useAppStore.getState().endpoints.map((e) => e.name);
    expect(names).toContain('automotive · Requirement');
    expect(names).not.toContain('automotive · Test_Case');
  });

  it('重复上传同一份文件时原地刷新数据源，不会堆出重复项', async () => {
    await openCustomSection();
    const file = jsonFile('automotive.json', BUCKETED);

    upload(file);
    await screen.findByText('automotive.json');
    await userEvent.click(screen.getByRole('button', { name: /接入选中的/ }));
    const afterFirst = useAppStore.getState().endpoints.length;

    upload(file);
    await screen.findByText('automotive.json');
    await userEvent.click(screen.getByRole('button', { name: /接入选中的/ }));

    expect(useAppStore.getState().endpoints).toHaveLength(afterFirst);
  });

  it('首页拖拽区的说明里点明了分桶文件的支持', async () => {
    await openCustomSection();
    expect(screen.getByText(/这类多实体分桶文件/)).toBeInTheDocument();
  });
});

