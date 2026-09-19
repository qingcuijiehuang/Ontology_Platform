/// <reference types="node" />
// Locks the "plain light canvas" decision. The graph used to sit on a
// checkerboard painted from --chess-square-*, which competed with the node and
// edge colors. It is now a flat --graph-bg surface.
//
// Two things must stay true, and a real browser is not needed to prove either:
//   1. .graph-container paints no pattern at all;
//   2. every theme's --graph-bg is fully OPAQUE, so the dark <body> behind the
//      theme class can never bleed through a translucent canvas.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEMES, getThemeTokens } from './themeTokens';
import { parseColor, relativeLuminance } from './contrast';

const css = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8');

/** Body of a standalone `<selector> { ... }` rule, or null when absent. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[}/])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm');
  const match = re.exec(css);
  return match ? match[1] : null;
}

/** Drop CSS block comments, so prose mentioning a token never matches as a rule. */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('图谱画布：纯色浅底，无棋盘格', () => {
  const container = ruleBody('.graph-container');
  const canvas = ruleBody('.graph-canvas');
  const containerDecls = container ? stripComments(container) : null;
  const canvasDecls = canvas ? stripComments(canvas) : null;

  it('.graph-container 规则存在', () => {
    expect(container).not.toBeNull();
  });

  it('画布底色取自 --graph-bg', () => {
    expect(containerDecls).toMatch(/background\s*:\s*var\(--graph-bg\)/);
  });

  it('画布不再画任何图案', () => {
    expect(containerDecls).not.toMatch(/background-image/);
    expect(containerDecls).not.toMatch(/linear-gradient/);
    expect(containerDecls).not.toMatch(/repeating-/);
    expect(containerDecls).not.toMatch(/chess-square/);
    // 内层 canvas 也必须保持透明，否则会盖住外层底色
    expect(canvasDecls).not.toMatch(/background-image|linear-gradient/);
  });

  it('每个主题的 --graph-bg 都不透明，深色 body 不会透出', () => {
    for (const theme of THEMES) {
      const value = getThemeTokens(theme)['--graph-bg'];
      expect(value, `主题 ${theme} 未定义 --graph-bg`).toBeTruthy();
      expect(parseColor(value).a, `主题 ${theme} 的 --graph-bg 是半透明色 ${value}`).toBe(1);
    }
  });

  it('浅色系主题画布是浅底，深色系主题画布是深底', () => {
    // 图谱节点文字颜色是固定的深/浅两套，画布明暗必须与之一致，
    // 否则默认浅色主题下会出现「深底深字」而不可读。
    const lightThemes = ['light', 'crimson'] as const;
    const darkThemes = ['dark', 'aurora'] as const;
    for (const theme of lightThemes) {
      const l = relativeLuminance(parseColor(getThemeTokens(theme)['--graph-bg']));
      expect(l, `主题 ${theme} 期望浅色画布`).toBeGreaterThan(0.8);
    }
    for (const theme of darkThemes) {
      const l = relativeLuminance(parseColor(getThemeTokens(theme)['--graph-bg']));
      expect(l, `主题 ${theme} 期望深色画布`).toBeLessThan(0.1);
    }
  });

  it('默认主题（无存储时）走浅色画布', () => {
    // getInitialTheme() 在 appStore.theme.test.ts 里锁定为 'light'；
    // 这里补上「默认主题的画布确实是浅色」这一半。
    const l = relativeLuminance(parseColor(getThemeTokens('light')['--graph-bg']));
    expect(l).toBeGreaterThan(0.8);
  });
});
