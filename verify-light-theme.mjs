// Verify the light-by-default theme + plain graph canvas + Chinese catalogue.
//
// Two prerequisites:
//   1. a static server over build/ (default http://127.0.0.1:4199)
//        cd build && python -m http.server 4199 --bind 127.0.0.1
//   2. permission to launch a real Chromium — the AI sandbox blocks the spawn,
//      so run this from a normal terminal:
//        node verify-light-theme.mjs
//
// The pass/fail logic is mirrored by the sandbox-safe unit tests in
// src/store/appStore.theme.test.ts (default theme resolution).
import { chromium } from 'playwright';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4199;
const ROOT = process.cwd();
const BASE_URL = process.env.PREVIEW_URL ?? `http://127.0.0.1:${PORT}`;

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    'C:/Users/22918/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    'C:/Users/22918/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// The onboarding tour's backdrop dims the whole page, so any screenshot taken
// while it is open shows colours that are not the real ones. Dismiss it first.
async function dismissTour(page) {
  return page.evaluate(() => {
    const labels = ['跳过', '不再显示', '知道了', '关闭'];
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      labels.some((l) => (b.textContent ?? '').includes(l)),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
}

const browser = await chromium.launch({
  executablePath: resolveChromiumExecutable(),
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // ── 1. First visit: no stored theme → light, and no dark flash ─────────────
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-container', { timeout: 15000 });
  // let cytoscape finish laying out
  await sleep(2500);

  // Dismiss the onboarding tour — its backdrop dims the whole page, which makes
  // every screenshot unreadable (the colours behind it are not the real ones).
  const tourDismissed = await dismissTour(page);
  await sleep(600);
  check('新手引导可关闭（为了拿到未压暗的截图）', tourDismissed);

  const htmlClass = await page.evaluate(() => document.documentElement.className);
  check('首屏 <html> 带 light-theme 类（无存储时默认浅色）', htmlClass.includes('light-theme'), `class="${htmlClass}"`);

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('body 背景是浅色（不是 #1B1B1B）', bodyBg !== 'rgb(27, 27, 27)', bodyBg);

  const containerClass = await page.evaluate(() => document.querySelector('.app-container')?.className ?? '');
  check('.app-container 也是 light-theme', containerClass.includes('light-theme'), containerClass);

  // ── 2. Graph canvas is a plain solid light surface ────────────────────────
  const graphBg = await page.evaluate(() => {
    const el = document.querySelector('.graph-container');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { image: cs.backgroundImage, color: cs.backgroundColor };
  });
  check('图谱容器存在', graphBg !== null);
  check('图谱背景无图案（background-image: none）', graphBg?.image === 'none', graphBg?.image);
  check('图谱背景是纯浅色 #FFFFFF', graphBg?.color === 'rgb(255, 255, 255)', graphBg?.color);

  const canvasBg = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="ontology-graph-canvas"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  check('图谱 canvas 自身无深色底', canvasBg !== 'rgb(30, 30, 30)', String(canvasBg));

  await page.screenshot({ path: `${ROOT}/docs/assets/theme-light-default.png` });

  // ── 3. A stored dark preference still wins ───────────────────────────────
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-container', { timeout: 15000 });
  await sleep(800);
  const darkClass = await page.evaluate(() => document.documentElement.className);
  const darkBody = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('已存深色偏好时仍走深色', !darkClass.includes('light-theme') && darkBody === 'rgb(27, 27, 27)', `${darkClass} / ${darkBody}`);
  await page.screenshot({ path: `${ROOT}/docs/assets/theme-dark-still-works.png` });

  // back to light for the catalogue shot
  await page.evaluate(() => localStorage.removeItem('theme'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-container', { timeout: 15000 });
  await sleep(1000);

  // ── 4. Catalogue copy is Chinese ─────────────────────────────────────────
  const galleryBtn = await page.$('button[title*="本体库"]');
  if (galleryBtn) await galleryBtn.click();
  else await page.evaluate(() => { window.location.hash = '#/catalogue'; });
  await page.waitForSelector('.gallery-grid, .modal-content', { timeout: 10000 });
  await sleep(1500);

  const catalogueProbe = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.gallery-grid > div'));
    const first = cards[0];
    const text = first ? first.innerText : '';
    return {
      cardCount: cards.length,
      firstCard: text.slice(0, 220),
      hasCJK: /[\u4e00-\u9fa5]/.test(text),
      categoryLabels: Array.from(document.querySelectorAll('.gallery-grid span'))
        .map((s) => s.textContent?.trim() ?? '')
        .filter((t) => t && t.length < 20)
        .slice(0, 12),
    };
  });
  check('本体库渲染出卡片', catalogueProbe.cardCount > 0, `${catalogueProbe.cardCount} 张`);
  check('卡片说明是中文', catalogueProbe.hasCJK, catalogueProbe.firstCard.replace(/\n/g, ' | '));

  // search + filter labels
  const uiProbe = await page.evaluate(() => {
    const input = document.querySelector('.modal-content input[type="text"]');
    const selects = Array.from(document.querySelectorAll('.modal-content select'));
    return {
      placeholder: input?.getAttribute('placeholder') ?? '',
      selectOptions: selects.flatMap((s) => Array.from(s.querySelectorAll('option')).map((o) => o.textContent?.trim())),
      bodyText: document.querySelector('.modal-content')?.innerText.slice(0, 400) ?? '',
    };
  });
  check('搜索框提示是中文', /搜索/.test(uiProbe.placeholder), uiProbe.placeholder);
  check('分类下拉是中文', uiProbe.selectOptions.some((o) => o && /零售|医疗|金融|制造业/.test(o)), uiProbe.selectOptions.join(' / '));

  await page.screenshot({ path: `${ROOT}/docs/assets/catalogue-zh.png` });

  check('页面无运行时报错', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} checks passed ===`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
  process.exitCode = 1;
}
