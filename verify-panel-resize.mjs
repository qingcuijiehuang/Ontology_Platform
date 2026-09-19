/**
 * 拖拽分栏 · 浏览器端端到端验证
 * ---------------------------------------------------------------------------
 * 用真实 Chromium 验证「右侧栏宽度」与「问答面板高度」是否真的可以拖动：
 *   1. 默认几何（右栏 ≈360px、分隔条存在且可见）
 *   2. 在竖直分隔条上真实按下 → 左移 → 右栏变宽；越界被夹取
 *   3. 在水平分隔条上真实按下 → 上移 → 面板变高
 *   4. 双击分隔条复位
 *   5. 刷新后尺寸持久化
 *   6. 顺带产出前后对比截图，肉眼复核
 *
 * 运行：npx tsx verify-panel-resize.mjs
 * 前置：另开终端在 build/ 目录下起静态服务器（默认 127.0.0.1:4188）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE_URL = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4188';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(ROOT, '.workbuddy');

/**
 * 本机预置的 Playwright 浏览器版本与 node_modules 里 playwright 期望的版本号不一致，
 * 直接 launch() 会报 "Executable doesn't exist"。这里显式挑一个已安装的 Chromium。
 */
function resolveChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    'C:/Users/22918/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    'C:/Users/22918/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    process.exitCode = 1;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
}

/** 读取右栏宽度 / 面板高度 / 分隔条几何。 */
async function readGeometry(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector('.right-sidebar');
    const consoleEl = document.querySelector('.ai-console');
    const vSplit = document.querySelector('.panel-resizer--vertical');
    const hSplit = document.querySelector('.panel-resizer--horizontal');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      sidebar: box(sidebar),
      console: box(consoleEl),
      vSplit: box(vSplit),
      hSplit: box(hSplit),
      vSplitCursor: vSplit ? getComputedStyle(vSplit).cursor : null,
      hSplitCursor: hSplit ? getComputedStyle(hSplit).cursor : null,
      vSplitDisplay: vSplit ? getComputedStyle(vSplit).display : null,
    };
  });
}

/** 用鼠标真实拖动一会儿（多步移动，贴近真人操作）。 */
async function dragBy(page, handle, dx, dy, steps = 12) {
  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX + (dx * i) / steps, startY + (dy * i) / steps);
  }
  await page.mouse.up();
}

const executablePath = resolveChromiumExecutable();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

console.log(`\n=== 拖拽分栏验证 @ ${BASE_URL} ===\n`);

/** 等到应用主界面挂载完成（图谱是懒渲染的，只等 .ai-console 就够）。 */
async function waitForApp(p) {
  await p.waitForSelector('.ai-console', { state: 'attached', timeout: 45000 });
  await p.waitForTimeout(700);
}

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await waitForApp(page);

// 关掉首次引导浮层 —— 它的 .tour-overlay 会拦截指针事件；同时写入 dismissed 标记，
// 只清理本功能的尺寸键（不能用 localStorage.clear()，否则引导会再次弹出）
await page.evaluate(() => {
  window.localStorage.setItem('ontology-quest-tour-dismissed', 'true');
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith('wb_panel_size_')) window.localStorage.removeItem(key);
  }
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
await waitForApp(page);
check('首次引导浮层已关闭（不遮挡分隔条）', (await page.locator('.tour-overlay').count()) === 0);

// ── 1. 默认几何 ──────────────────────────────────────────
console.log('[1] 默认布局');
let geo = await readGeometry(page);
check('右侧栏默认宽度为 360px', geo.sidebar && Math.abs(geo.sidebar.w - 360) <= 2, `实测 ${geo.sidebar?.w}px`);
check('竖直分隔条已渲染并可见', !!geo.vSplit && geo.vSplit.w > 0 && geo.vSplitDisplay !== 'none', `宽 ${geo.vSplit?.w}px`);
check('竖直分隔条光标为 col-resize', geo.vSplitCursor === 'col-resize', `实测 ${geo.vSplitCursor}`);
check('水平分隔条已渲染（面板展开态）', !!geo.hSplit && geo.hSplit.h > 0, `高 ${geo.hSplit?.h}px`);
check('水平分隔条光标为 row-resize', geo.hSplitCursor === 'row-resize', `实测 ${geo.hSplitCursor}`);
check(
  '分隔条位于左列与右栏之间',
  geo.vSplit && geo.sidebar && geo.vSplit.x + geo.vSplit.w <= geo.sidebar.x + 1,
  `split 右边界 ${geo.vSplit.x + geo.vSplit.w} / sidebar 左边界 ${geo.sidebar.x}`,
);
await page.screenshot({ path: path.join(SHOT_DIR, 'resize-01-default.png') });

// ── 2. 拖动右侧栏宽度 ────────────────────────────────────
console.log('\n[2] 拖动竖直分隔条（左移 120px → 右栏应变宽）');
const beforeW = geo.sidebar.w;
await dragBy(page, page.locator('.panel-resizer--vertical'), -120, 0);
await page.waitForTimeout(250);
geo = await readGeometry(page);
check(
  '右栏变宽约 120px',
  Math.abs(geo.sidebar.w - (beforeW + 120)) <= 6,
  `期望 ≈${beforeW + 120}px，实测 ${geo.sidebar.w}px`,
);
check(
  '主列相应变窄（分栏是此消彼长）',
  geo.sidebar.x + geo.sidebar.w === 1600,
  `右栏右边界 ${geo.sidebar.x + geo.sidebar.w}`,
);
await page.screenshot({ path: path.join(SHOT_DIR, 'resize-02-sidebar-wide.png') });

console.log('\n[3] 向右拖回并测试下限夹取');
await dragBy(page, page.locator('.panel-resizer--vertical'), 900, 0);
await page.waitForTimeout(250);
geo = await readGeometry(page);
check('右栏被夹到下限 260px，不会消失', geo.sidebar.w === 260, `实测 ${geo.sidebar.w}px`);

console.log('\n[4] 向左拖爆上限');
await dragBy(page, page.locator('.panel-resizer--vertical'), -1400, 0);
await page.waitForTimeout(250);
geo = await readGeometry(page);
const expectedMax = 1600 - 460;
check(
  `右栏被夹到上限 ${expectedMax}px，图谱区仍保留 460px`,
  Math.abs(geo.sidebar.w - expectedMax) <= 2,
  `实测 ${geo.sidebar.w}px`,
);

// ── 5. 双击复位 ──────────────────────────────────────────
console.log('\n[5] 双击分隔条复位');
await page.locator('.panel-resizer--vertical').dblclick();
await page.waitForTimeout(250);
geo = await readGeometry(page);
check('右栏复位到 360px', Math.abs(geo.sidebar.w - 360) <= 2, `实测 ${geo.sidebar.w}px`);

// ── 6. 拖动问答面板高度 ──────────────────────────────────
console.log('\n[6] 拖动水平分隔条（上移 140px → 面板应变高）');
const beforeConsoleH = geo.console.h;
await dragBy(page, page.locator('.panel-resizer--horizontal'), 0, -140);
await page.waitForTimeout(250);
geo = await readGeometry(page);
check(
  '问答面板变高约 140px（以真实高度为基准，不跳到配置初始值）',
  Math.abs(geo.console.h - (beforeConsoleH + 140)) <= 8,
  `期望 ≈${beforeConsoleH + 140}px，实测 ${geo.console.h}px`,
);
check(
  '分隔条紧贴面板上沿',
  geo.hSplit && Math.abs(geo.hSplit.y + geo.hSplit.h - geo.console.y) <= 2,
  `split 下边界 ${geo.hSplit ? geo.hSplit.y + geo.hSplit.h : 'n/a'} / console.y=${geo.console.y}`,
);
check(
  '图谱区被压缩但仍保留可见高度',
  geo.console.y > 64,
  `图谱底部 y=${geo.console.y}`,
);
await page.screenshot({ path: path.join(SHOT_DIR, 'resize-03-console-tall.png') });

console.log('\n[7] 向下拖爆下限');
await dragBy(page, page.locator('.panel-resizer--horizontal'), 0, 900);
await page.waitForTimeout(250);
geo = await readGeometry(page);
check('面板被夹到下限 150px', Math.abs(geo.console.h - 150) <= 2, `实测 ${geo.console.h}px`);

console.log('\n[8] 面板内出现独立滚动区（固定高度后内容不再撑破布局）');
const scrollable = await page.evaluate(() => {
  const body = document.querySelector('.ai-console-body');
  if (!body) return null;
  const cs = getComputedStyle(body);
  return { overflowY: cs.overflowY, flexGrow: cs.flexGrow, scrollable: body.scrollHeight > body.clientHeight };
});
check('body 可滚动', scrollable?.overflowY === 'auto', `overflow-y=${scrollable?.overflowY}`);
check('body 参与 flex 填充', scrollable?.flexGrow === '1', `flex-grow=${scrollable?.flexGrow}`);

// ── 9. 持久化 ────────────────────────────────────────────
console.log('\n[9] 刷新后尺寸持久化');
await page.locator('.panel-resizer--vertical').dblclick();
await dragBy(page, page.locator('.panel-resizer--vertical'), -80, 0);
await page.waitForTimeout(250);
const storedBefore = await page.evaluate(() => ({
  sidebar: window.localStorage.getItem('wb_panel_size_right-sidebar-width'),
  console: window.localStorage.getItem('wb_panel_size_ai-console-height'),
}));
check('宽度已写入 localStorage', storedBefore.sidebar === '440', `实测 ${storedBefore.sidebar}`);
check('高度已写入 localStorage', !!storedBefore.console, `实测 ${storedBefore.console}`);

await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
await waitForApp(page);
geo = await readGeometry(page);
check('刷新后右栏宽度保持 440px', Math.abs(geo.sidebar.w - 440) <= 3, `实测 ${geo.sidebar.w}px`);
check(
  '刷新后面板高度保持 150px',
  Math.abs(geo.console.h - 150) <= 3,
  `实测 ${geo.console.h}px`,
);

// ── 10. 键盘无障碍 ───────────────────────────────────────
console.log('\n[10] 键盘微调分隔条');
await page.locator('.panel-resizer--vertical').focus();
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
geo = await readGeometry(page);
check('方向键左移两次 → 宽度 +32px', Math.abs(geo.sidebar.w - 472) <= 3, `实测 ${geo.sidebar.w}px`);
await page.keyboard.press('Home');
await page.waitForTimeout(200);
geo = await readGeometry(page);
check('Home 键复位到 360px', Math.abs(geo.sidebar.w - 360) <= 2, `实测 ${geo.sidebar.w}px`);

// ── 11. 图谱画布跟随容器尺寸 ─────────────────────────────
console.log('\n[11] 拖动分栏后 Cytoscape 画布同步尺寸并重新收进视野');
await page.locator('.panel-resizer--vertical').dblclick();
await page.locator('.panel-resizer--horizontal').dblclick();
await page.waitForTimeout(400);
const graphBefore = await page.evaluate(() => {
  const cy = window.__ONTOLOGY_PREVIEW_CY__;
  const c = document.querySelector('.graph-canvas');
  return cy && c ? { cyH: Math.round(cy.height()), contH: Math.round(c.clientHeight) } : null;
});
check('图谱视口高度与容器一致（初始）', graphBefore && Math.abs(graphBefore.cyH - graphBefore.contH) <= 2,
  `cy=${graphBefore?.cyH} / container=${graphBefore?.contH}`);

await dragBy(page, page.locator('.panel-resizer--horizontal'), 0, -220);
await page.waitForTimeout(700); // 等防抖 fit 落地
const graphAfter = await page.evaluate(() => {
  const cy = window.__ONTOLOGY_PREVIEW_CY__;
  const c = document.querySelector('.graph-canvas');
  if (!cy || !c) return null;
  const bb = cy.elements().boundingBox();
  return {
    cyW: Math.round(cy.width()),
    cyH: Math.round(cy.height()),
    contW: Math.round(c.clientWidth),
    contH: Math.round(c.clientHeight),
  };
});
check('视口高度跟着容器变小（画布已 resize）', graphAfter && Math.abs(graphAfter.cyH - graphAfter.contH) <= 2,
  `cy=${graphAfter?.cyH} / container=${graphAfter?.contH}`);
check('视口宽度同样同步', graphAfter && Math.abs(graphAfter.cyW - graphAfter.contW) <= 2,
  `cy=${graphAfter?.cyW} / container=${graphAfter?.contW}`);
const inView = await page.evaluate(() => {
  const cy = window.__ONTOLOGY_PREVIEW_CY__;
  if (!cy) return null;
  // renderedBoundingBox 是视口坐标系（boundingBox 是模型坐标，不能直接和视口尺寸比）
  const bb = cy.elements().renderedBoundingBox();
  const w = cy.width();
  const h = cy.height();
  const pad = 1;
  return {
    inside: bb.x1 >= -pad && bb.y1 >= -pad && bb.x2 <= w + pad && bb.y2 <= h + pad,
    bb,
    w: Math.round(w),
    h: Math.round(h),
  };
});
check('拖动后节点全部回到可见区域（自动 fit）', inView?.inside === true,
  inView ? `渲染 bbox=(${Math.round(inView.bb.x1)},${Math.round(inView.bb.y1)})-(${Math.round(inView.bb.x2)},${Math.round(inView.bb.y2)}) / 视口 ${inView.w}×${inView.h}` : 'n/a');
await page.screenshot({ path: path.join(SHOT_DIR, 'resize-05-graph-refit.png') });

// ── 12. 移动端不出现分隔条 ───────────────────────────────
console.log('\n[12] 窄屏（820×900）隐藏分隔条');
await page.setViewportSize({ width: 820, height: 900 });
await page.waitForTimeout(400);
const mobile = await page.evaluate(() => {
  const v = document.querySelector('.panel-resizer--vertical');
  const h = document.querySelector('.panel-resizer--horizontal');
  return {
    v: v ? getComputedStyle(v).display : 'absent',
    h: h ? getComputedStyle(h).display : 'absent',
    sidebar: document.querySelector('.right-sidebar')
      ? getComputedStyle(document.querySelector('.right-sidebar')).display
      : 'absent',
  };
});
check('竖直分隔条在窄屏隐藏', mobile.v === 'none' || mobile.v === 'absent', `display=${mobile.v}`);
check('水平分隔条在窄屏隐藏', mobile.h === 'none' || mobile.h === 'absent', `display=${mobile.h}`);

// ── 收尾 ─────────────────────────────────────────────────
check('页面无运行时异常', pageErrors.length === 0, pageErrors.join(' | ') || '无');

await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOT_DIR, 'resize-04-final.png') });

await browser.close();

console.log(`\n=== ${passed} 项通过${failed ? `，${failed} 项失败` : '，全部通过'} ===\n`);
