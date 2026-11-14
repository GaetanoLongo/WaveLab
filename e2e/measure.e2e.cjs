// End-to-end check of cursors and measurements (M8). Run `npm run build && npx vite preview` first.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-'));
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const prop = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
  const setProp = async (label, text) => { const f = prop(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const mfield = (label) => p.locator('.measure .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
  const setM = async (label, text) => { const f = mfield(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const mval = async (name) => p.locator('.measure .m-grid dt', { hasText: new RegExp(`^${name}$`) }).first().locator('xpath=following-sibling::dd[1]').innerText();

  // 0/5 V square, 30 % duty, 50 Hz
  await p.click('.tool:has-text("Square")');
  await setProp('High level', '5');
  await setProp('Low level', '0');
  await setProp('Duty cycle', '30');
  assert(await p.locator('.measure').count() === 1, 'measurement panel under the plot');
  assert(await mval('Duty') === '30.00 %' || (await mval('Duty')).startsWith('30'), 'visible window: duty 30 %: ' + await mval('Duty'));

  await p.click('.measure button:has-text("Time cursors")');
  await setM('Cursor 1', '0.5m');
  await setM('Cursor 2', '20.5m');
  assert(await mval('Δt') === '20 ms' && await mval('1/Δt') === '50 Hz', 'Δt = 20 ms, 1/Δt = 50 Hz');
  assert(await mval('Duty') === '30.00 %', 'one period between cursors: duty 30.00 %');
  assert(await mval('Mean') === '1.5 V', 'mean 1.5 V: ' + await mval('Mean'));
  assert(await mval('RMS') === '2.7386 V', 'RMS √7.5 = 2.7386 V: ' + await mval('RMS'));
  assert(await mval('Max') === '5 V' && await mval('Min') === '0 V', 'max 5 V, min 0 V');

  // Drag cursor 1 near the falling edge at 6 ms → snaps exactly
  const g = await p.evaluate(() => { const r = document.querySelector('.plot-svg clipPath rect'); return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') }; });
  const host = await p.locator('.plot-host').boundingBox();
  const tx = (t) => host.x + g.x + (t / 0.04) * g.w;
  await p.mouse.move(tx(0.0005), host.y + g.y + 60);
  await p.mouse.down();
  await p.mouse.move(tx(0.0062), host.y + g.y + 60, { steps: 8 });
  const tip = await p.locator('.drag-tip').innerText();
  await p.mouse.up();
  assert(tip.includes('Falling edge'), 'drag guide names the snap target: ' + tip);
  assert(await mfield('Cursor 1').inputValue() === '6 ms', 'cursor 1 snapped exactly to the falling edge (6 ms): ' + await mfield('Cursor 1').inputValue());
  assert(await mval('Δt') === '14.5 ms', 'Δt updates to 14.5 ms');

  // Level cursors; drag B to ~5 V → snaps to the level
  await p.click('.measure button:has-text("Level cursors")');
  assert(await mfield('Cursor A').inputValue() === '1.25 V' && await mfield('Cursor B').inputValue() === '3.75 V', 'level cursors at 25 % / 75 % of the range');
  const yB = await p.evaluate(() => {
    const lines = [...document.querySelectorAll('.plot-svg line')].filter((l) => l.getAttribute('stroke') === '#6741d9');
    return +lines[1].getAttribute('y1');
  });
  const yTop = await p.evaluate(() => { const d = document.querySelector('.plot-svg path[data-signal]').getAttribute('d'); return Math.min(...[...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => +m[1])); });
  await p.mouse.move(host.x + g.x + 300, host.y + yB);
  await p.mouse.down();
  await p.mouse.move(host.x + g.x + 300, host.y + yTop + 4, { steps: 6 });
  await p.mouse.up();
  assert(await mfield('Cursor B').inputValue() === '5 V', 'level cursor B snapped to 5 V: ' + await mfield('Cursor B').inputValue());
  assert(await mval('ΔAB') === '3.75 V', 'ΔAB = 3.75 V');
  await p.screenshot({ path: path.join(out, 'm8-measure.png') });

  // Export: cursors only on request
  const exportSvg = async (include) => {
    await p.keyboard.press('Control+Shift+s');
    await p.click('.export-dialog .fmt button:has-text("SVG")');
    const cb = p.locator('.export-dialog label:has-text("Include measurement cursors") input');
    if ((await cb.isChecked()) !== include) await cb.click();
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
    const f = path.join(out, `cursors-${include}.svg`); await d.saveAs(f);
    return fs.readFileSync(f, 'utf8');
  };
  assert(!(await exportSvg(false)).includes('#c2255c'), 'export without cursors by default');
  assert((await exportSvg(true)).includes('#c2255c'), 'export includes cursors when requested');

  // Cursors survive save/reopen
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const f = path.join(out, 'measure.wlab'); await dl.saveAs(f);
  await p.click('button[aria-label="New project"]');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await ch.setFiles(f);
  await p.waitForSelector('.signal-list .row');
  assert(await mfield('Cursor 1').inputValue() === '6 ms' && await mfield('Cursor B').inputValue() === '5 V', 'cursor positions restored after reopen');

  // Phone: Measure tab
  const ph = await b.newContext({ ...devices['iPhone 13'] });
  const q = await ph.newPage();
  await q.goto(url); await q.evaluate(() => localStorage.clear()); await q.reload();
  await q.locator('.tool:has-text("Sine")').first().tap();
  await q.locator('.phone-tabs button:has-text("Measure")').tap();
  assert(await q.locator('.measure.phone').count() === 1, 'phone: Measure tab shows the panel');
  await q.locator('.measure button:has-text("Time cursors")').tap();
  assert(await q.locator('.measure .field').count() === 2, 'phone: time cursors editable');
  const w = await q.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert(w[0] <= w[1], 'phone: no horizontal scroll');
  await q.screenshot({ path: path.join(out, 'm8-phone.png') });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
