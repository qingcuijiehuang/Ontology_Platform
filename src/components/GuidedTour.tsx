import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';

interface TourStep {
  target: string;        // CSS selector for the element to spotlight
  title: string;
  description: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
}

const tourSteps: TourStep[] = [
  {
    target: '.header',
    title: '顶栏导航',
    description: '顶栏可快速进入「接入数据源 / 摘要 / 本体库 / 设计器 / 主题」；右上角的「模型连接」用于接入 GPT、DeepSeek、GLM 等大模型。随时按 ⌘K 打开命令面板。',
    placement: 'bottom',
  },
  {
    target: '.graph-container',
    title: '本体图谱',
    description: '这是当前本体的可视化图谱。点击实体节点或关系连线，可在右侧查看其属性、关系与数据源映射。',
    placement: 'bottom',
  },
  {
    target: '.ai-console',
    title: '智能检索问答',
    description: '在图谱下方直接提问：系统会把本体结构与已接入的真实数据集作为依据交给大模型，流式给出回答，并实时加亮命中的实体与关系。',
    placement: 'top',
  },
  {
    target: '.right-sidebar',
    title: '检视器 / 实例浏览',
    description: '选中实体查看属性；用搜索框定位实体；用路径查找追溯关系；用「实例浏览」查看接入的真实数据行与列映射。',
    placement: 'left',
  },
  {
    target: '.header-actions [data-tooltip="本体设计器"]',
    title: '本体设计器',
    description: '从零或模板构建本体，导出为 RDF 文件，或一键接入真实数据源进行检索。',
    placement: 'bottom',
  },
];

const STORAGE_KEY = 'ontology-quest-tour-dismissed';

interface GuidedTourProps {
  /** Called when the tour is fully dismissed (skip/finish) */
  onComplete: () => void;
}

/** Check if a DOM element is visible (has non-zero dimensions) */
function isElementVisible(selector: string): boolean {
  const el = document.querySelector(selector);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function GuidedTour({ onComplete }: GuidedTourProps) {
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* noop */ }
    onComplete();
  }, [onComplete]);

  // Filter steps to only those whose target element is visible.
  // On mobile (≤900px), panels like .right-sidebar are display:none, so they
  // get filtered out. If no steps are visible (e.g. very small screen),
  // auto-dismiss the tour.
  useEffect(() => {
    const visible = tourSteps.filter(s => isElementVisible(s.target));
    if (visible.length === 0) {
      dismiss();
      return;
    }
    setVisibleSteps(visible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = visibleSteps[stepIdx];

  // Measure the target element
  const measure = useCallback(() => {
    if (!current) return;
    const el = document.querySelector(current.target);
    if (el) {
      setRect(el.getBoundingClientRect());
    }
  }, [current]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  const next = () => {
    if (stepIdx < visibleSteps.length - 1) {
      setStepIdx(s => s + 1);
    } else {
      dismiss();
    }
  };

  const prev = () => {
    if (stepIdx > 0) setStepIdx(s => s - 1);
  };

  // Nothing to show yet (steps still being filtered, or will auto-dismiss)
  if (!current) return null;

  // Compute tooltip position, clamped within the viewport
  const tooltipStyle = (): React.CSSProperties => {
    if (!rect) return { opacity: 0 };
    const pad = 16;
    const margin = 12; // minimum distance from viewport edges
    const base: React.CSSProperties = { position: 'fixed' };

    const clampLeft = (left: number, maxW: number) =>
      Math.max(margin, Math.min(left, window.innerWidth - maxW - margin));

    const clampTop = (top: number) =>
      Math.max(margin, Math.min(top, window.innerHeight - 200));

    switch (current.placement) {
      case 'bottom': {
        const maxW = Math.min(360, rect.width);
        return { ...base, top: clampTop(rect.bottom + pad), left: clampLeft(rect.left, maxW), maxWidth: maxW };
      }
      case 'top': {
        const maxW = Math.min(360, rect.width);
        const top = rect.top - pad - 200; // estimate ~200px tooltip height
        return { ...base, top: Math.max(margin, top), left: clampLeft(rect.left, maxW), maxWidth: maxW };
      }
      case 'right':
        return { ...base, top: clampTop(rect.top), left: Math.min(rect.right + pad, window.innerWidth - 320 - margin), maxWidth: 320 };
      case 'left':
        return { ...base, top: clampTop(rect.top), right: Math.max(margin, window.innerWidth - rect.left + pad), maxWidth: 320 };
    }
  };

  // Spotlight clip-path: full viewport with a rectangular hole
  const clipPath = rect
    ? `polygon(
        0% 0%, 0% 100%, ${rect.left}px 100%, ${rect.left}px ${rect.top}px,
        ${rect.right}px ${rect.top}px, ${rect.right}px ${rect.bottom}px,
        ${rect.left}px ${rect.bottom}px, ${rect.left}px 100%, 100% 100%, 100% 0%
      )`
    : undefined;

  return (
    <AnimatePresence>
      <motion.div
        className="tour-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ clipPath }}
      />
      <motion.div
        className="tour-tooltip"
        key={stepIdx}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        style={tooltipStyle()}
      >
        <div className="tour-tooltip-header">
          <span className="tour-tooltip-step">{stepIdx + 1}/{visibleSteps.length}</span>
          <button className="tour-tooltip-close" onClick={dismiss} aria-label="关闭引导">
            <X size={16} />
          </button>
        </div>
        <h4 className="tour-tooltip-title">{current.title}</h4>
        <p className="tour-tooltip-desc">{current.description}</p>
        <div className="tour-tooltip-actions">
          {stepIdx > 0 && (
            <button className="tour-btn tour-btn-secondary" onClick={prev}>
              <ChevronLeft size={14} /> 上一步
            </button>
          )}
          <button className="tour-btn tour-btn-primary" onClick={next}>
            {stepIdx < visibleSteps.length - 1 ? (
              <>下一步 <ChevronRight size={14} /></>
            ) : (
              '开始使用'
            )}
          </button>
        </div>
        <button className="tour-skip" onClick={dismiss}>
          跳过 · 不再显示
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

/** Returns true if the user previously dismissed the tour */
export function isTourDismissed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}
