import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header';
import { useAppStore } from '../store/appStore';

const noop = () => {};

function renderHeader(overrides: Partial<Parameters<typeof Header>[0]> = {}) {
  return render(
    <Header
      onDataSourcesClick={noop}
      onImportExportClick={noop}
      onGalleryClick={noop}
      onDesignerClick={noop}
      onSummaryClick={noop}
      onEndpointClick={noop}
      onLlmClick={noop}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  cleanup();
  useAppStore.getState().resetLlmConfig();
});

afterEach(() => {
  cleanup();
});

describe('Header — 顶栏按钮', () => {
  it('「模型连接」是带文案的按钮，不再是纯图标按钮', () => {
    renderHeader();
    const btn = screen.getByRole('button', { name: '模型连接' });
    expect(btn.tagName).toBe('BUTTON');
    // 文案必须真的渲染出来（纯图标版本这里会是空字符串）
    expect(btn.textContent).toContain('模型连接');
  });

  it('「模型连接」排在「接入数据源」左边', () => {
    renderHeader();
    const model = screen.getByRole('button', { name: '模型连接' });
    const endpoint = screen.getByRole('button', { name: '接入数据源' });

    // compareDocumentPosition: 4 = DOCUMENT_POSITION_FOLLOWING
    expect(model.compareDocumentPosition(endpoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('两个按钮样式类同源（都是顶栏胶囊按钮）', () => {
    renderHeader();
    const model = screen.getByRole('button', { name: '模型连接' });
    const endpoint = screen.getByRole('button', { name: '接入数据源' });
    expect(model.className).toContain('header-model-btn');
    expect(endpoint.className).toContain('header-primary-btn');
  });

  it('未配置模型时是无状态点按钮，点击回调可触发', async () => {
    const onLlmClick = vi.fn();
    renderHeader({ onLlmClick });

    const btn = screen.getByRole('button', { name: '模型连接' });
    expect(btn.className).toContain('is-unset');
    expect(btn).toHaveAttribute('title', '接入大模型（GPT / DeepSeek / GLM 等）');

    await userEvent.click(btn);
    expect(onLlmClick).toHaveBeenCalledTimes(1);
  });
});
