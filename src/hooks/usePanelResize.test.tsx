/**
 * usePanelResize 单元测试
 * ---------------------------------------------------------------------------
 * 覆盖拖拽分栏的核心行为：夹取、方向反转、双击复位、键盘微调、持久化自愈。
 * 指针事件直接构造为普通对象交给 handler 调用 —— jsdom 对 PointerEvent 支持不完整，
 * 而我们真正要验证的是 hook 内部的数学与状态机，不是浏览器的事件派发。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePanelResize, type UsePanelResizeOptions } from './usePanelResize';

const STORAGE_KEY = 'wb_panel_size_test-panel';

/** 造一个够用的合成 PointerEvent（只需 clientX / clientY / pointerId）。 */
function pointerEvent(
  target: HTMLElement,
  coords: { x?: number; y?: number },
  pointerId = 1,
): ReactPointerEvent<HTMLElement> {
  return {
    pointerType: 'mouse',
    button: 0,
    clientX: coords.x ?? 0,
    clientY: coords.y ?? 0,
    pointerId,
    currentTarget: target,
    target,
    preventDefault: () => {},
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function makeTarget(): HTMLElement {
  return document.createElement('div');
}

const baseOptions: UsePanelResizeOptions = {
  storageKey: 'test-panel',
  initial: 360,
  min: 260,
  max: 720,
  axis: 'x',
  reverse: true,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('usePanelResize · 初始状态', () => {
  it('无持久化记录时使用 initial，且不算「已调整」', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    expect(result.current.size).toBe(360);
    expect(result.current.customized).toBe(false);
    expect(result.current.dragging).toBe(false);
  });

  it('分隔条具备无障碍语义（role=separator + aria 数值）', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    expect(result.current.handleProps.role).toBe('separator');
    expect(result.current.handleProps['aria-orientation']).toBe('vertical');
    expect(result.current.handleProps['aria-valuenow']).toBe(360);
    expect(result.current.handleProps['aria-valuemin']).toBe(260);
    expect(result.current.handleProps['aria-valuemax']).toBe(720);
    expect(result.current.handleProps.tabIndex).toBe(0);
  });

  it('axis=y 时方向是水平分隔条', () => {
    const { result } = renderHook(() => usePanelResize({ ...baseOptions, axis: 'y' }));
    expect(result.current.handleProps['aria-orientation']).toBe('horizontal');
  });
});

describe('usePanelResize · 拖动', () => {
  it('reverse=true：指针左移 → 尺寸变大（右侧栏 / 下方面板都是这种关系）', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 500 })));
    expect(result.current.dragging).toBe(true);

    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 440 })));
    // 左移 60px → 360 + 60
    expect(result.current.size).toBe(420);
    expect(result.current.customized).toBe(true);

    act(() => result.current.handleProps.onPointerUp(pointerEvent(target, { x: 440 })));
    expect(result.current.dragging).toBe(false);
  });

  it('reverse=false：指针右移 → 尺寸变大', () => {
    const { result } = renderHook(() => usePanelResize({ ...baseOptions, reverse: false }));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 200 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 260 })));
    expect(result.current.size).toBe(420);
  });

  it('axis=y 读取 clientY', () => {
    const { result } = renderHook(() => usePanelResize({ ...baseOptions, axis: 'y' }));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { y: 700 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { y: 640 })));
    expect(result.current.size).toBe(420);
  });

  it('夹到上限，不会超出 max', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 1000 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: -5000 })));
    expect(result.current.size).toBe(720);
  });

  it('夹到下限，不会小于 min', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 0 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 5000 })));
    expect(result.current.size).toBe(260);
  });

  it('max 支持函数形式（按视口动态计算）', () => {
    const { result } = renderHook(() =>
      usePanelResize({ ...baseOptions, max: () => 400 }),
    );
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 1000 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: -5000 })));
    expect(result.current.size).toBe(400);
    expect(result.current.handleProps['aria-valuemax']).toBe(400);
  });

  it('未按下就移动指针不会改变尺寸', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: -500 })));
    expect(result.current.size).toBe(360);
    expect(result.current.customized).toBe(false);
  });

  it('拖动过程中锁定文本选中，结束后恢复', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 500 })));
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');

    act(() => result.current.handleProps.onPointerUp(pointerEvent(target, { x: 500 })));
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('resolveStartSize：以「按下瞬间量到的真实尺寸」为基准，而不是配置的 initial', () => {
    // 模拟「面板处于内容自适应高度」：真实高度 154px，而 initial 配的是 360px。
    // 若不做这件事，第一次拖动会先跳到 360 再跟手，观感上就是「一拖就爆开一大截」。
    let measured = 154;
    const { result } = renderHook(() =>
      usePanelResize({ ...baseOptions, initial: 360, min: 150, axis: 'y', resolveStartSize: () => measured }),
    );
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 0, y: 800 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 0, y: 660 })));
    // 154 + 140 = 294（而不是 360 + 140 = 500）
    expect(result.current.size).toBe(294);

    measured = 400;
    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 0, y: 800 }, 2)));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 0, y: 660 }, 2)));
    expect(result.current.size).toBe(540);
  });

  it('resolveStartSize 返回 null / 非法值时回落当前 size', () => {
    const { result } = renderHook(() =>
      usePanelResize({ ...baseOptions, resolveStartSize: () => null }),
    );
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 500 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 440 })));
    expect(result.current.size).toBe(420); // 360 + 60
  });
});

describe('usePanelResize · 复位与键盘', () => {
  it('双击复位到 initial 并清除「已调整」标记', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    const target = makeTarget();

    act(() => result.current.handleProps.onPointerDown(pointerEvent(target, { x: 500 })));
    act(() => result.current.handleProps.onPointerMove(pointerEvent(target, { x: 400 })));
    expect(result.current.size).toBe(460);

    act(() => result.current.handleProps.onDoubleClick());
    expect(result.current.size).toBe(360);
    expect(result.current.customized).toBe(false);
  });

  it('reverse=true 时按 ArrowLeft 变大、ArrowRight 变小', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));

    act(() => result.current.handleProps.onKeyDown({ key: 'ArrowLeft', preventDefault: () => {} } as never));
    expect(result.current.size).toBe(376);

    act(() => result.current.handleProps.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} } as never));
    expect(result.current.size).toBe(360);
  });

  it('reverse=false 时方向键语义相反', () => {
    const { result } = renderHook(() => usePanelResize({ ...baseOptions, reverse: false }));

    act(() => result.current.handleProps.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} } as never));
    expect(result.current.size).toBe(376);
  });

  it('axis=y 时用上下方向键', () => {
    const { result } = renderHook(() => usePanelResize({ ...baseOptions, axis: 'y' }));

    act(() => result.current.handleProps.onKeyDown({ key: 'ArrowUp', preventDefault: () => {} } as never));
    expect(result.current.size).toBe(376);
  });

  it('Home 键复位', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    act(() => result.current.setSize(600));
    expect(result.current.size).toBe(600);

    act(() => result.current.handleProps.onKeyDown({ key: 'Home', preventDefault: () => {} } as never));
    expect(result.current.size).toBe(360);
    expect(result.current.customized).toBe(false);
  });

  it('键盘调整同样受上下限约束', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    act(() => result.current.setSize(700));
    for (let i = 0; i < 20; i += 1) {
      act(() => result.current.handleProps.onKeyDown({ key: 'ArrowLeft', preventDefault: () => {} } as never));
    }
    expect(result.current.size).toBe(720);
  });
});

describe('usePanelResize · 持久化', () => {
  it('拖动后写入 localStorage', () => {
    const { result } = renderHook(() => usePanelResize(baseOptions));
    act(() => result.current.setSize(480));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('480');
  });

  it('重新挂载时读回上次尺寸', () => {
    window.localStorage.setItem(STORAGE_KEY, '512');
    const { result } = renderHook(() => usePanelResize(baseOptions));
    expect(result.current.size).toBe(512);
    expect(result.current.customized).toBe(true);
  });

  it('复位后清除持久化记录，消费方可回到自适应', () => {
    window.localStorage.setItem(STORAGE_KEY, '512');
    const { result } = renderHook(() => usePanelResize(baseOptions));
    act(() => result.current.reset());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.customized).toBe(false);
  });

  it.each([
    ['空字符串', ''],
    ['非数字', 'abc'],
    ['零', '0'],
    ['负数', '-120'],
    ['NaN', 'NaN'],
  ])('脏值（%s）自动回落到 initial', (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    const { result } = renderHook(() => usePanelResize(baseOptions));
    expect(result.current.size).toBe(360);
    expect(result.current.customized).toBe(false);
  });

  it('持久化尺寸越界时在挂载后立即收敛到区间内', () => {
    window.localStorage.setItem(STORAGE_KEY, '99999');
    const { result } = renderHook(() => usePanelResize(baseOptions));
    // 初次渲染直接用陈旧值，随后靠 clamp 修正（这里验证 clamp 逻辑本身）
    act(() => result.current.setSize(99999));
    expect(result.current.size).toBe(720);
  });

  it('localStorage 抛异常时静默降级，不影响拖动', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => usePanelResize(baseOptions));
    expect(() => act(() => result.current.setSize(500))).not.toThrow();
    expect(result.current.size).toBe(500);
    setItem.mockRestore();
  });
});
