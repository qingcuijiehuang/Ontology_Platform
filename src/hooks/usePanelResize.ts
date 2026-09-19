/**
 * usePanelResize —— 可拖动面板尺寸（通用 hook）
 * ---------------------------------------------------------------------------
 * 用于「拖动分隔条调整面板宽/高」这一类交互，例如：
 *   - 右侧栏宽度（竖直分隔条，左右拖）
 *   - 图谱下方「智能检索问答」面板高度（水平分隔条，上下拖）
 *
 * 设计要点：
 *   1. 用 Pointer Events + `setPointerCapture`，鼠标 / 触屏 / 触控笔统一处理，
 *      指针拖出元素甚至拖出窗口也不会丢事件。
 *   2. 尺寸始终经 `clamp` 收敛到 `[min, max]`，`max` 支持函数形式以便按视口动态计算，
 *      避免出现「面板被拖到比窗口还大」的失控状态。
 *   3. 尺寸写入 localStorage 持久化；读取时校验「有限正数」，脏值自动回落默认值。
 *   4. `customized` 标记用户是否真的调过尺寸 —— 消费方可以据此决定
 *      「没调过 → 让内容自适应（auto），调过 → 用固定尺寸」。
 *   5. 双击复位；分隔条可 Tab 聚焦，用方向键微调（无障碍）。
 *
 * 调用关系是单向的：hook 只管尺寸状态，不感知任何业务渲染，避免联动环路。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const STORAGE_PREFIX = 'wb_panel_size_';

/** 拖动轴：'x' = 横向拖动改宽度，'y' = 纵向拖动改高度。 */
export type ResizeAxis = 'x' | 'y';

/**
 * 分隔条的 props：直接展开到 `<div {...handleProps} />` 上即可。
 */
export interface PanelResizeHandleProps {
  role: 'separator';
  tabIndex: number;
  'aria-orientation': 'vertical' | 'horizontal';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-label': string;
  title: string;
  style: CSSProperties;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface UsePanelResizeResult {
  /** 当前尺寸（px）。 */
  size: number;
  /** 是否正在拖动 —— 可用于给分隔条加高亮。 */
  dragging: boolean;
  /** 用户是否手动调整过（双击复位后回到 false）。 */
  customized: boolean;
  /** 复位到初始尺寸并清除持久化记录。 */
  reset: () => void;
  /** 程序化设置尺寸（会走 clamp 与持久化）。 */
  setSize: (next: number) => void;
  /** 展开到分隔条元素上的 props。 */
  handleProps: PanelResizeHandleProps;
}

export interface UsePanelResizeOptions {
  /** 持久化键名（同前缀下唯一，建议用语义化短横线命名）。 */
  storageKey: string;
  /** 初始 / 复位尺寸（px）。 */
  initial: number;
  /** 最小尺寸（px），下限保护。 */
  min: number;
  /** 最大尺寸（px），支持函数形式以按视口动态计算。 */
  max: number | (() => number);
  /** 拖动轴。 */
  axis: ResizeAxis;
  /**
   * 是否反向：当面板位于拖动轴的正向一侧时传 true。
   *  - 右侧栏：向右拖 = 变大 → 需要反向（指针左移时尺寸增大）→ true
   *  - 下方控制台：向下拖 = 变大 → 需要反向 → true
   */
  reverse?: boolean;
  /** 方向键单步尺寸（px），默认 16。 */
  step?: number;
  /**
   * 拖动起点尺寸的兜底来源。
   * 面板处于「内容自适应」状态时，配置里的 initial 未必等于实际渲染尺寸，
   * 传这个回调可在按下瞬间量取真实尺寸，避免第一次拖动就把面板跳到一个突兀的值。
   * 返回 null / 非有限数时回落到当前 size。
   */
  resolveStartSize?: () => number | null;
  /** 无障碍标签，默认「拖动调整面板尺寸」。 */
  label?: string;
}

/** 读取持久化尺寸；返回是否真的读到过合法值。 */
function readStoredSize(storageKey: string, fallback: number): { value: number; found: boolean } {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return { value: fallback, found: false };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (raw == null || raw === '') return { value: fallback, found: false };
    const parsed = Number(raw);
    // 脏值（null / 'abc' / 0 / 负数 / NaN）一律回落默认值，避免把面板拖成不可用
    if (!Number.isFinite(parsed) || parsed <= 0) return { value: fallback, found: false };
    return { value: Math.round(parsed), found: true };
  } catch {
    return { value: fallback, found: false };
  }
}

function persistSize(storageKey: string, size: number | null): void {
  if (typeof window === 'undefined' || !('localStorage' in window)) return;
  try {
    if (size == null) window.localStorage.removeItem(STORAGE_PREFIX + storageKey);
    else window.localStorage.setItem(STORAGE_PREFIX + storageKey, String(size));
  } catch {
    // 隐私模式 / 配额不足时静默降级：尺寸仍可用，只是不持久化
  }
}

/** 把 max 选项（数字或函数）解析成实际上限值。 */
function resolveMaxValue(maxOption: number | (() => number), min: number): number {
  const raw = typeof maxOption === 'function' ? maxOption() : maxOption;
  return Number.isFinite(raw) && raw > min ? raw : min;
}

export function usePanelResize(options: UsePanelResizeOptions): UsePanelResizeResult {
  const { storageKey, initial, min, axis, reverse = false, step = 16, label } = options;

  const [initialState] = useState(() => readStoredSize(storageKey, initial));
  const [size, setSizeState] = useState(initialState.value);
  const [customized, setCustomized] = useState(initialState.found);
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null);
  const handleRef = useRef<HTMLElement | null>(null);

  // max 放进 ref：调用方通常传内联函数（每次渲染都是新引用），
  // 放进依赖数组会让 clamp 每帧重建、resize 监听反复解绑。
  const maxRef = useRef(options.max);
  const resolveStartSizeRef = useRef(options.resolveStartSize);
  useEffect(() => {
    maxRef.current = options.max;
    resolveStartSizeRef.current = options.resolveStartSize;
  });

  const resolveMax = useCallback((): number => resolveMaxValue(maxRef.current, min), [min]);

  const clamp = useCallback(
    (value: number): number => {
      if (!Number.isFinite(value)) return min;
      return Math.min(Math.max(Math.round(value), min), resolveMax());
    },
    [min, resolveMax],
  );

  // 视口变化时重新收敛：窗口变小后旧尺寸可能已越界
  useEffect(() => {
    const onWindowResize = () => setSizeState((prev) => clamp(prev));
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [clamp]);

  // 持久化：只有用户调过才写；复位后清键，消费方可据此回到自适应
  useEffect(() => {
    persistSize(storageKey, customized ? size : null);
  }, [customized, size, storageKey]);

  // 拖动期间锁掉文本选中与光标闪烁，避免拖出一片蓝色选区
  useEffect(() => {
    if (!dragging) return;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [axis, dragging]);

  const setSize = useCallback(
    (next: number) => {
      setCustomized(true);
      setSizeState(clamp(next));
    },
    [clamp],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // 鼠标只响应左键；触摸 / 触控笔没有 button 语义，直接放行
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const target = e.currentTarget;
      handleRef.current = target;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // 某些环境不支持 pointer capture，退化为普通事件流
      }
      // 只把「量出来的真实尺寸」当基准，不再对基准做 clamp ——
      // 否则自适应高度小于下限时，一按下就会先跳一段。
      const measured = resolveStartSizeRef.current?.();
      const startSize = typeof measured === 'number' && Number.isFinite(measured) && measured > 0
        ? measured
        : size;
      dragRef.current = {
        startPos: axis === 'x' ? e.clientX : e.clientY,
        startSize,
      };
      setDragging(true);
    },
    [axis, size],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const delta = (pos - drag.startPos) * (reverse ? -1 : 1);
      setCustomized(true);
      setSizeState(clamp(drag.startSize + delta));
    },
    [axis, clamp, reverse],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    const target = handleRef.current;
    handleRef.current = null;
    if (target) {
      try {
        if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
      } catch {
        // 指针已消失（例如触摸中断），忽略
      }
    }
  }, []);

  const reset = useCallback(() => {
    setSizeState(clamp(initial));
    setCustomized(false);
  }, [clamp, initial]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const decreaseKey = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      const increaseKey = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      // 面板在正向一侧时，「往内拖」是变大：右栏按左键变大、下方面板按上键变大
      const growKey = reverse ? decreaseKey : increaseKey;
      const shrinkKey = reverse ? increaseKey : decreaseKey;

      if (e.key === growKey) {
        e.preventDefault();
        setSize(size + step);
      } else if (e.key === shrinkKey) {
        e.preventDefault();
        setSize(size - step);
      } else if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault();
        reset();
      }
    },
    [axis, reset, reverse, setSize, size, step],
  );

  // aria-valuemax 要在渲染期取值，所以直接读当前 props 而不是 ref
  // （ref 只服务于事件回调里那份稳定引用，渲染期读 ref 会被 react-hooks/refs 拦下）
  const ariaMax = resolveMaxValue(options.max, min);

  const handleProps: PanelResizeHandleProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
    'aria-valuenow': size,
    'aria-valuemin': min,
    'aria-valuemax': ariaMax,
    'aria-label': `${label ?? '拖动调整面板尺寸'}，双击或按 Home 复位`,
    title: `${label ?? '拖动调整面板尺寸'}（双击复位）`,
    style: { touchAction: 'none' },
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: reset,
    onKeyDown,
  };

  return { size, dragging, customized, reset, setSize, handleProps };
}
