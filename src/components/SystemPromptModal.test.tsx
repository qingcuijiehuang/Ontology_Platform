import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemPromptModal } from './SystemPromptModal';
import { useAppStore } from '../store/appStore';
import { DEFAULT_SYSTEM_PROMPT } from '../lib/llmClient';

describe('SystemPromptModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useAppStore.setState({ aiSystemPrompt: '' });
  });

  it('未自定义过时编辑框预填默认提示词', () => {
    render(<SystemPromptModal onClose={onClose} />);
    const textarea = screen.getByLabelText('系统提示词内容') as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('已自定义时预填当前提示词', () => {
    useAppStore.setState({ aiSystemPrompt: '你是一名数据审计员。' });
    render(<SystemPromptModal onClose={onClose} />);
    const textarea = screen.getByLabelText('系统提示词内容') as HTMLTextAreaElement;
    expect(textarea.value).toBe('你是一名数据审计员。');
  });

  it('保存自定义提示词写入 store 并关闭弹窗', async () => {
    const user = userEvent.setup();
    render(<SystemPromptModal onClose={onClose} />);
    const textarea = screen.getByLabelText('系统提示词内容') as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, '只回答与咖啡销售有关的问题。');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(useAppStore.getState().aiSystemPrompt).toBe('只回答与咖啡销售有关的问题。');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('恢复默认按钮把编辑框填回默认提示词，保存后 store 归空', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ aiSystemPrompt: '临时提示词' });
    render(<SystemPromptModal onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /恢复默认/ }));
    const textarea = screen.getByLabelText('系统提示词内容') as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_SYSTEM_PROMPT);

    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(useAppStore.getState().aiSystemPrompt).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('取消不改动 store', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ aiSystemPrompt: '原始提示词' });
    render(<SystemPromptModal onClose={onClose} />);
    await user.clear(screen.getByLabelText('系统提示词内容'));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(useAppStore.getState().aiSystemPrompt).toBe('原始提示词');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('清空内容后保存按钮禁用；Esc 关闭', async () => {
    const user = userEvent.setup();
    render(<SystemPromptModal onClose={onClose} />);
    const textarea = screen.getByLabelText('系统提示词内容');
    await user.clear(textarea);

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
