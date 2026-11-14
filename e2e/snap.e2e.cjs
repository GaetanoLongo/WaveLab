// End-to-end check of positioning/snapping (M4). Run `npm run build && npx vite preview` first.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const sp = process.argv[2] || require('os').tmpdir();
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 820 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const field = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
  await p.click('.tool:has-text("Square")');
  await p.click('.tool:has-text("Square")');
  await p.click('.seg button:has-text("Stacked")');
  const host = await p.locator('.plot-host').boundingBox();
  // geometry from the rendered svg: second panel clip rect
  const g = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.plot-svg clipPath rect')].map(e => ({ x: +e.getAttribute('x'), y: +e.getAttribute('y'), w: +e.getAttribute('width'), h: +e.getAttribute('height') }));
    return r;
  });
  const P = g[1]; // panel of "Square 2"
  const tx = (t) => host.x + P.x + (t / 0.04) * P.w;
  const yHigh = host.y + P.y + P.h * 0.08 + 2; // near the high level line (auto range pads 8 %)
  // find exact y of the high level: grab on the flat top between 2 and 8 ms
  const yTop = await p.evaluate((P) => {
    const path = document.querySelectorAll('.plot-svg path[data-signal]')[1];
    const d = path.getAttribute('d'); const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map(m => +m[1]);
    return Math.min(...ys);
  }, P);
  const grabY = host.y + yTop;

  // 1) drag ~9.7 ms → snaps rising edge (0) to the other signal's falling edge at 10 ms
  await p.mouse.move(tx(0.005), grabY); await p.mouse.down();
  await p.mouse.move(tx(0.005 + 0.0097), grabY, { steps: 8 });
  await p.screenshot({ path: sp + '/m4-drag.png' });
  const tip = await p.locator('.drag-tip').innerText();
  await p.mouse.up();
  assert(/edge → (Rising|Falling) edge · Square/.test(tip) && tip.startsWith('Δt +10 ms'), 'guide label shown: ' + tip);
  assert(await field('Delay').inputValue() === '10 ms', 'snapped delay = 10 ms (got ' + await field('Delay').inputValue() + ')');

  // 2) one undo step
  await p.keyboard.press('Control+z');
  assert(await field('Delay').inputValue() === '0 s', 'Ctrl+Z undoes the whole drag');

  // 3) grid snap: drag +2.3 ms → 2 ms
  await p.mouse.move(tx(0.005), grabY); await p.mouse.down();
  await p.mouse.move(tx(0.0073), grabY, { steps: 6 }); await p.mouse.up();
  assert(await field('Delay').inputValue() === '2 ms', 'grid snap to 2 ms (got ' + await field('Delay').inputValue() + ')');

  // 4) Alt = free
  await p.keyboard.press('Control+z');
  await p.keyboard.down('Alt');
  await p.mouse.move(tx(0.005), grabY); await p.mouse.down();
  await p.mouse.move(tx(0.0073), grabY, { steps: 6 }); await p.mouse.up();
  await p.keyboard.up('Alt');
  const free = await field('Delay').inputValue();
  assert(free !== '2 ms' && free.endsWith('ms'), 'Alt moves freely (got ' + free + ')');
  await p.keyboard.press('Control+z');

  // 5) phase snapping only
  await p.click('button[aria-label="Grid & snap settings"]');
  for (const l of ['Time grid', 'Signal edges', 'Zero crossings']) await p.locator('.snap-menu label', { hasText: l }).locator('input').uncheck();
  await p.locator('.snap-menu label', { hasText: 'Phase' }).first().locator('input').check();
  await p.screenshot({ path: sp + '/m4-snapmenu.png' });
  await p.keyboard.press('Escape');
  await p.mouse.move(tx(0.005), grabY); await p.mouse.down();
  await p.mouse.move(tx(0.0067), grabY, { steps: 6 }); await p.mouse.up(); // +1.7 ms → 2 × 15° = 1.6667 ms
  assert(await field('Delay').inputValue() === '1.66667 ms', 'phase snap 30° = 1.66667 ms (got ' + await field('Delay').inputValue() + ')');

  // settings persist after reload
  await p.reload();
  await p.click('button[aria-label="Grid & snap settings"]');
  assert(await p.locator('.snap-menu label', { hasText: 'Phase' }).first().locator('input').isChecked(), 'snap settings persist across reload');
  assert(!(await p.locator('.snap-menu label', { hasText: 'Time grid' }).locator('input').isChecked()), 'grid stays off after reload');
  await p.keyboard.press('Escape');

  // 6) alignment buttons + phase difference via UI
  await p.click('.tool:has-text("Sine")');
  await p.click('.tool:has-text("Sine")');
  await p.locator('.properties .field', { has: p.locator('label:text-is("Reference")') }).locator('select').selectOption({ label: 'Sine' });
  const sd = field('Set difference'); await sd.click(); await sd.fill('120'); await sd.press('Enter');
  assert(await field('Phase').inputValue() === '120°', 'set difference 120° → phase 120° (got ' + await field('Phase').inputValue() + ')');
  assert((await p.locator('.properties .readout').allInnerTexts()).some(t => t.includes('leads by 120° (6.667 ms)')), 'readout: leads by 120° (6.667 ms)');
  await p.click('.align-buttons button:has-text("+ peak")');
  assert((await p.locator('.notice').innerText()).includes('Aligned positive peaks'), 'align peaks reports success');
  assert((await p.locator('.properties .readout').allInnerTexts()).some(t => t.includes('in phase')), 'after aligning peaks: in phase');
  await p.screenshot({ path: sp + '/m4-align.png' });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
