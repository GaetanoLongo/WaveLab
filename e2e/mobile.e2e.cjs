// Phone layout check (emulated iPhone 13): tabs, compact toolbar, pinch zoom, no horizontal overflow.
// Run `npm run build && npx vite preview` first.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-'));
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const noOverflow = async (where) => {
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1], `${where}: no horizontal page scroll (${w[0]} ≤ ${w[1]})`);
  };

  assert(await p.locator('.toolbar.compact').count() === 1, 'compact toolbar on phone');
  assert(await p.locator('.phone-tabs [role=tab]').count() === 3, 'tab bar with Add / Signals / Properties');
  assert(await p.locator('.toolbox').count() === 0 && await p.locator('.phone-panel .toolbox-inner').count() === 1, 'toolbox shown inside the Add tab');
  await noOverflow('empty project');
  await p.screenshot({ path: path.join(out, 'mobile-empty.png') });

  await p.locator('.tool:has-text("Square")').tap();
  assert(await p.locator('.phone-tabs [aria-selected=true]').innerText() === 'Properties', 'adding a waveform jumps to Properties');
  await p.locator('.phone-tabs button:has-text("Add")').tap();
  await p.locator('.tool:has-text("Sine")').first().tap();
  await p.locator('.phone-tabs button:has-text("Signals")').tap();
  assert(await p.locator('.signal-list .row').count() === 2, 'Signals tab lists 2 signals');
  assert((await p.locator('.phone-tabs button:has-text("Signals") .count').innerText()) === '2', 'tab shows the signal count');
  await noOverflow('signals tab');

  // input font ≥ 16 px (no iOS zoom on focus)
  await p.locator('.phone-tabs button:has-text("Properties")').tap();
  const fsz = await p.locator('.properties input').first().evaluate((e) => getComputedStyle(e).fontSize);
  assert(parseFloat(fsz) >= 16, 'inputs use ≥ 16 px text on touch screens: ' + fsz);
  await noOverflow('properties tab');
  await p.screenshot({ path: path.join(out, 'mobile-props.png') });

  // More menu
  await p.locator('button[aria-label="More actions"]').tap();
  const items = await p.locator('.popover.menu [role=menuitem]').allInnerTexts();
  assert(items.some((t) => t.includes('Open project')) && items.some((t) => t.includes('Delete')), '"⋯" menu holds file and edit actions');
  const box = await p.locator('.popover.menu').boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 390, 'menu fits on screen');
  await p.screenshot({ path: path.join(out, 'mobile-menu.png') });
  await p.locator('.popover.menu button:has-text("Zoom in")').tap();
  const st = await p.locator('.status span').first().innerText();
  assert(st.includes('→ 30 ms') || st.includes('10 ms → 30 ms'), 'menu Zoom in works: ' + st);

  // Pinch out with two fingers (raw touch events through CDP)
  await p.locator('button[aria-label="Fit all signals"]').tap();
  const host = await p.locator('.plot-host').boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const y = host.y + host.height / 2;
  const cx = host.x + host.width / 2 + 20;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((x, i) => ({ x, y, id: i })) });
  await touch('touchStart', [cx - 30, cx + 30]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [cx - 30 - 15 * k, cx + 30 + 15 * k]);
  await touch('touchEnd', []);
  await p.waitForTimeout(100);
  const span = await p.locator('.status span').first().innerText();
  const m = /span ([\d.]+) ms/.exec(span);
  assert(m && +m[1] < 20, 'pinch-out zooms in (span 40 ms → ' + (m ? m[1] : '?') + ' ms)');
  await p.screenshot({ path: path.join(out, 'mobile-pinch.png') });

  // Export dialog fits the screen
  await p.locator('button[aria-label="Export PNG / SVG / PDF"]').tap();
  const dlg = await p.locator('.export-dialog').boundingBox();
  assert(dlg.width <= 390 && dlg.x >= 0, 'export dialog fits the phone width');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
