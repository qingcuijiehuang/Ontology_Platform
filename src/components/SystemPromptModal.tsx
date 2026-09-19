/**
 * 系统提示词设置弹窗 —— 由「智能检索问答」面板顶部的「提示词」按钮打开。
 *
 * 编辑内容会整体替换内置的默认系统提示词（DEFAULT_SYSTEM_PROMPT），
 * 而「本体知识图谱 + 真实数据集」的接地上下文照常注入用户消息，
 * 因此检索回答始终基于「系统提示词 + 本体 + 数据集」三者。
 */
import { useEffect, useState } from 'react';
import { X, RotateCcw, Info } from 'lucide-react';
import { useAppStore, AI_SYSTEM_PROMPT_MAX_LENGTH } from '../store/appStore';
import { DEFAULT_SYSTEM_PROMPT } from '../lib/llmClient';

interface SystemPromptModalProps {
  onClose: () => void;
}

export function SystemPromptModal({ onClose }: SystemPromptModalProps) {
  const aiSystemPrompt = useAppStore((s) => s.aiSystemPrompt);
  const setAiSystemPrompt = useAppStore((s) => s.setAiSystemPrompt);

  // 草稿：打开时预填当前生效的提示词（未自定义过则预填默认值，方便在其基础上修改）
  const [draft, setDraft] = useState(() => aiSystemPrompt.trim() || DEFAULT_SYSTEM_PROMPT);

  // 锁定背景滚动
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isDefault = draft.trim() === DEFAULT_SYSTEM_PROMPT.trim();
  const overLimit = draft.length > AI_SYSTEM_PROMPT_MAX_LENGTH;

  const handleSave = () => {
    const trimmed = draft.trim();
    // 与默认提示词一致时存空串，语义上回到「使用默认」
    setAiSystemPrompt(trimmed === DEFAULT_SYSTEM_PROMPT.trim() ? '' : trimmed);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-content prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置系统提示词"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>

        <div className="prompt-modal-head">
          <h2>智能问答 · 系统提示词</h2>
          <p>
            设定检索问答 Agent 的角色与作答规则。回答始终基于
            <strong>系统提示词 + 本体知识图谱 + 真实数据集</strong>；
            本体与数据上下文由平台自动注入，无需在此描述。
          </p>
        </div>

        <textarea
          className="prompt-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          spellCheck={false}
          aria-label="系统提示词内容"
          placeholder="输入系统提示词…"
        />

        <div className="prompt-modal-foot">
          <span className={`prompt-char-count ${overLimit ? 'is-over' : ''}`}>
            {draft.length} / {AI_SYSTEM_PROMPT_MAX_LENGTH}
          </span>
          <div className="prompt-modal-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setDraft(DEFAULT_SYSTEM_PROMPT)}
              disabled={isDefault}
              title="恢复为内置默认提示词"
            >
              <RotateCcw size={14} /> 恢复默认
            </button>
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={draft.trim().length === 0 || overLimit}
            >
              保存
            </button>
          </div>
        </div>

        <div className="prompt-modal-hint">
          <Info size={13} />
          <span>
            置空保存或点「恢复默认」即使用内置提示词；自定义提示词会保存在本地浏览器，对所有本体生效。
          </span>
        </div>
      </div>
    </div>
  );
}
