import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The default theme is resolved once, at module load (`const initialTheme =
// getInitialTheme()`), so every case has to re-import the store with a fresh
// module registry after seeding localStorage. These tests are the regression
// lock for the "light by default" decision — without them a future edit to
// getInitialTheme() could silently flip the whole product back to dark.

async function loadStore() {
  vi.resetModules();
  return await import('./appStore');
}

describe('默认主题（浅色）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('首次访问、没有任何存储时默认浅色', async () => {
    const { useAppStore, isDarkTheme } = await loadStore();
    const { theme, darkMode } = useAppStore.getState();
    expect(theme).toBe('light');
    expect(isDarkTheme(theme)).toBe(false);
    expect(darkMode).toBe(false);
  });

  it('已存储的主题优先于默认值', async () => {
    window.localStorage.setItem('theme', 'dark');
    const { useAppStore } = await loadStore();
    expect(useAppStore.getState().theme).toBe('dark');
    expect(useAppStore.getState().darkMode).toBe(true);
  });

  it('只迁移旧版 darkMode=true，其余（含脏值）一律回落浅色', async () => {
    window.localStorage.setItem('darkMode', 'true');
    expect((await loadStore()).useAppStore.getState().theme).toBe('dark');

    window.localStorage.setItem('darkMode', 'false');
    expect((await loadStore()).useAppStore.getState().theme).toBe('light');

    // 脏值不该被当成「开过深色模式」。注意 Number('') === 0 这类隐式转换陷阱。
    window.localStorage.setItem('darkMode', '1');
    expect((await loadStore()).useAppStore.getState().theme).toBe('light');
  });

  it('无法识别的 theme 值回落浅色', async () => {
    window.localStorage.setItem('theme', 'neon');
    expect((await loadStore()).useAppStore.getState().theme).toBe('light');
  });

  it('themeClass 把浅色系主题映射到 light-theme，深色系不加类', async () => {
    const { themeClass, isDarkTheme } = await loadStore();
    expect(themeClass('light')).toBe('light-theme');
    expect(themeClass('crimson')).toBe('light-theme theme-crimson');
    expect(themeClass('aurora')).toBe('theme-aurora');
    expect(themeClass('dark')).toBe('');
    // 背景干净与否取决于暗色判定：图谱 / RDF 渲染都读它。
    expect(isDarkTheme('light')).toBe(false);
    expect(isDarkTheme('crimson')).toBe(false);
    expect(isDarkTheme('dark')).toBe(true);
    expect(isDarkTheme('aurora')).toBe(true);
  });

  it('toggleDarkMode 从浅色切到深色再切回', async () => {
    const { useAppStore } = await loadStore();
    expect(useAppStore.getState().theme).toBe('light');
    useAppStore.getState().toggleDarkMode();
    expect(useAppStore.getState().theme).toBe('dark');
    useAppStore.getState().toggleDarkMode();
    expect(useAppStore.getState().theme).toBe('light');
  });

  it('主题菜单里「浅色」排第一，和默认主题保持一致', async () => {
    const { THEME_OPTIONS } = await loadStore();
    const ids = THEME_OPTIONS.map((t) => t.id);
    // 菜单第一项必须就是首次进入时生效的主题，否则用户会看到
    // 「默认浅色、但列表第一项却是深色」的错位。
    expect(ids[0]).toBe('light');
    expect(THEME_OPTIONS[0].label).toBe('浅色');
    // 四套主题齐全且不重复（键盘循环切换依赖这份顺序）
    expect(ids).toEqual(['light', 'dark', 'aurora', 'crimson']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
