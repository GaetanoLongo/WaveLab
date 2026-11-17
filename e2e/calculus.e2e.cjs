// End-to-end check of integration, differentiation, moving average/RMS (M7, acceptance Test 4).
// Run `npm run build && npx vite preview` first.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-'));
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const field = (label) => p.locator('.properties .field', { has: p.locator('label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input, select').first();
  const setField = async (label, text) => { const f = field(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const expr = p.locator('.expr-input');
  const select = (name) => p.locator('.signal-list .row', { hasText: name }).first().click();
  // Vertices (pixels) of the n-th trace path and the panel geometry.
  const traceInfo = (n) => p.evaluate((n) => {
    // Main trace path of panel n ('last' = last panel): first non-halo path clipped to that panel.
    const rects = [...document.querySelectorAll('.plot-svg clipPath')];
    const idx = n === 'last' ? rects.length - 1 : n;
    const clipId = rects[idx].id;
    const path = [...document.querySelectorAll('.plot-svg path[data-signal]')].find(
      (e) => !e.getAttribute('stroke-opacity') && e.getAttribute('clip-path') === `url(#${clipId})`,
    );
    const d = path.getAttribute('d');
    const pts = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    const r = rects[idx].querySelector('rect');
    return { pts, x: +r.getAttribute('x'), w: +r.getAttribute('width') };
  }, n);

  // --- Acceptance Test 4: square 50 Hz ±10 V → Integration ---
  await p.click('.tool:has-text("Square")');
  await setField('High level', '10');
  await setField('Low level', '-10');
  await p.click('.tool:has-text("Integration")');
  assert(await expr.inputValue() === 'integral(Square, 0, 0)', 'Integration creates integral(Square, 0, 0)');
  assert(await field('Unit').inputValue() === 'V·s', 'integral unit is V·s');
  await p.click('.seg button:has-text("Stacked")');
  let tr = await traceInfo(1);
  const tOf = (x) => ((x - tr.x) / tr.w) * 0.04;
  const minY = Math.min(...tr.pts.map((q) => q[1]));
  const peaks = tr.pts.filter((q) => Math.abs(q[1] - minY) < 0.01).map((q) => tOf(q[0]));
  assert(peaks.length >= 2 && peaks.every((t) => Math.abs(t - 0.01) < 2e-5 || Math.abs(t - 0.03) < 2e-5), 'Test 4: integral peaks exactly at 10 ms and 30 ms: ' + peaks.map((t) => (t * 1e3).toFixed(4)).join(', '));
  const bottomY = Math.max(...tr.pts.map((q) => q[1]));
  const troughs = tr.pts.filter((q) => Math.abs(q[1] - bottomY) < 0.01).map((q) => tOf(q[0]));
  assert(troughs.some((t) => Math.abs(t - 0.02) < 2e-5) && troughs.some((t) => Math.abs(t) < 2e-5), 'Test 4: integral returns to the initial value at 0, 20, 40 ms');
  // straight segments: the vertex between 0 and 10 ms lies on the line (piecewise linear)
  const rising = tr.pts.filter((q) => tOf(q[0]) > 1e-4 && tOf(q[0]) < 0.0099);
  const dev = Math.max(...rising.map((q) => Math.abs(q[1] - (bottomY + (minY - bottomY) * (tOf(q[0]) / 0.01)))));
  assert(rising.length > 10 && dev < 0.5, `Test 4: piecewise linear (max deviation from the line ${dev.toFixed(3)} px over ${rising.length} vertices)`);

  // initial condition through the Operator section
  await setField('Initial value', '2');
  assert(await expr.inputValue() === 'integral(Square, 0, 2)', 'initial value 2 rewrites the expression');
  const yTicks = await p.evaluate(() => [...document.querySelectorAll('.plot-svg text')].map((t) => t.textContent));
  assert(yTicks.includes('2.1') || yTicks.includes('2.10') || yTicks.includes('2.08'), 'axis now around the initial value 2 V·s');
  await p.screenshot({ path: path.join(out, 'm7-integral.png') });

  // --- Differentiation of the square: impulse markers ---
  await select('Square');
  await p.click('.tool:has-text("Differentiation")');
  assert(await expr.inputValue() === 'deriv(Square)', 'Differentiation creates deriv(Square)');
  const labels = await p.evaluate(() => [...document.querySelectorAll('.plot-svg text')].map((t) => t.textContent).filter((t) => t.startsWith('δ·')));
  assert(labels.includes('δ·20 V') && labels.includes('δ·-20 V'), 'impulse markers labelled δ·±20 V: ' + [...new Set(labels)].join(', '));
  await p.screenshot({ path: path.join(out, 'm7-deriv.png') });
  await field('Ideal edges').selectOption('dfinite');
  assert(await expr.inputValue() === 'dfinite(Square, 200u)', 'finite rise/fall mode: dfinite(Square, 200u): ' + await expr.inputValue());
  const labels2 = await p.evaluate(() => [...document.querySelectorAll('.plot-svg text')].filter((t) => t.textContent.startsWith('δ·')).length);
  assert(labels2 === 0, 'no impulse markers in finite mode');
  await field('Ideal edges').selectOption('deriv');

  // --- Moving RMS of a 325 V sine over one period = 229.8 V (flat) ---
  await p.click('.tool:has-text("Sine")');
  await setField('Amplitude', '325');
  await p.click('.tool:has-text("RMS (moving)")');
  assert(await expr.inputValue() === 'rms(Sine, 20m)', 'RMS window defaults to one period: ' + await expr.inputValue());
  tr = await traceInfo('last');
  const ys = new Set(tr.pts.map((q) => q[1].toFixed(1)));
  assert(ys.size === 1, 'moving RMS over one period is flat (one y value): ' + [...ys].slice(0, 4).join(','));
  const ticks = await p.evaluate(() => [...document.querySelectorAll('.plot-svg text')].map((t) => t.textContent));
  assert(ticks.some((t) => /^2[23]\d(\.\d+)?$/.test(t)), 'RMS axis around 230 V');
  await setField('Window', '5m');
  assert(await expr.inputValue() === 'rms(Sine, 5m)', 'window edit rewrites the expression');
  await p.click('.properties button:has-text("Window = one period")');
  assert(await expr.inputValue() === 'rms(Sine, 20m)', '"one period" button restores 20 ms');

  // --- warning for impulses through a non-linear op ---
  await select('Derivative');
  await expr.click(); await expr.fill('abs(deriv(Square))'); await expr.press('Enter');
  assert((await p.locator('.properties .warn').allInnerTexts()).some((t) => t.includes('cannot pass through abs()')), 'warning shown for impulses through abs()');

  // --- save / reopen ---
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const f = path.join(out, 'calc.wlab'); await dl.saveAs(f);
  await p.click('button[aria-label="New project"]');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await ch.setFiles(f);
  await p.waitForSelector('.signal-list .row');
  await select('Integral');
  assert(await expr.inputValue() === 'integral(Square, 0, 2)', 'integral restored after reopen');
  await p.screenshot({ path: path.join(out, 'm7-all.png') });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
