// End-to-end check of the grid of figures. Run `npm run build && npx vite preview` first.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-'));
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();

  await p.click('.tool:has-text("Sine")');
  await p.click('.fig-add');
  await p.click('.tool:has-text("Square")');
  await p.click('.fig-add');
  await p.click('.tool:has-text("Triangle")');
  assert(await p.locator('.grid-controls button:has-text("Grid")').count() === 1, 'grid toggle appears with several figures');
  await p.click('.grid-controls button:has-text("Grid")');
  assert(await p.locator('.grid-cell').count() === 3, 'grid shows 3 figures');
  assert(await p.locator('.grid-cell.active .cell-head').innerText() === 'Figure 3', 'active figure highlighted');
  await p.locator('.grid-controls select[aria-label="Grid columns"]').selectOption('3');
  const boxes = await p.locator('.grid-cell').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  assert(new Set(boxes.map((v) => Math.round(v))).size === 1, '3 columns: one row');

  // Click into figure 1's plot → becomes active
  const c1 = p.locator('.grid-cell').nth(0).locator('.plot-host');
  const bb = await c1.boundingBox();
  await p.mouse.click(bb.x + bb.width / 2, bb.y + 30);
  assert(await p.locator('.grid-cell.active .cell-head').innerText() === 'Figure 1', 'clicking a cell activates its figure');
  const listNow = await p.locator('.signal-list .row:not(.other) .name').allInnerTexts();
  assert(listNow.join() === 'Sine', 'signal list follows the active cell: ' + JSON.stringify(listNow));

  // Link all time axes: wheel zoom in figure 1 zooms the others
  await p.locator('.grid-controls select[aria-label="Time axis linking"]').selectOption('all');
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  for (let i = 0; i < 4; i++) await p.mouse.wheel(0, -100);
  await p.waitForTimeout(150);
  const ticks = await p.locator('.grid-cell').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.plot-svg text')].map((t) => t.textContent).filter((t) => /^\d+(\.\d+)?$/.test(t)).slice(-3).join('|')));
  assert(ticks[0] && ticks[0] === ticks[1] && ticks[1] === ticks[2], 'linked: all three cells show the same time ticks: ' + ticks.join(' / '));
  await p.screenshot({ path: path.join(out, 'grid.png') });

  // Export the grid as SVG: one file with 3 figures
  await p.keyboard.press('Control+Shift+s');
  await p.locator('.export-dialog .field', { has: p.locator('label:text-is("Content")') }).locator('select').selectOption('grid');
  await p.click('.export-dialog .fmt button:has-text("SVG")');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
  const f = path.join(out, 'grid.svg'); await d.saveAs(f);
  const svg = fs.readFileSync(f, 'utf8');
  assert((svg.match(/clipPath id="wl-c\d+-clip-0"/g) || []).length === 3, 'grid export contains 3 figures');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
