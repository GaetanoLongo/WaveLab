// End-to-end check of the M10 waveforms. Run `npm run build && npx vite preview` first.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-'));
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const prop = (label) => p.locator('.properties .field', { has: p.locator('label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input, select').first();
  const setProp = async (label, text) => { const f = prop(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const mval = async (name) => p.locator('.measure .m-grid dt', { hasText: new RegExp(`^${name}$`) }).first().locator('xpath=following-sibling::dd[1]').innerText();
  const planned = await p.locator('.tool.planned').allInnerTexts();
  assert(!planned.some((t) => /Exponential|Damped|piecewise|NRZ|Manchester|Bit sequence/.test(t)), 'new waveforms are no longer marked "planned"');

  // Exponential rise
  await p.click('.tool:has-text("Exponential rise")');
  assert(await p.locator('.properties .kind').innerText() === 'Exponential', 'exponential properties');
  assert(await prop('Start time').count() === 1 && await prop('Frequency').count() === 0, 'one-shot timing: start time only');
  await setProp('Time constant τ', '2m');
  assert((await p.locator('.readout').first().innerText()).includes('4.394 ms'), '10–90 % time = τ·ln 9 = 4.394 ms');

  // Damped sinusoid
  await p.click('.tool:has-text("Damped sinusoid")');
  assert(await prop('Frequency').count() === 1 && await prop('Decay τ').count() === 1, 'damped: frequency and decay τ');

  // Piecewise: add a point, step interpolation
  await p.click('.tool:has-text("Custom piecewise")');
  const rows0 = await p.locator('table.points tbody tr').count();
  await p.click('.properties button:has-text("+ Add point")');
  assert(await p.locator('table.points tbody tr').count() === rows0 + 1, 'piecewise: add point');
  await p.locator('table.points tbody tr').last().locator('button').click();
  assert(await p.locator('table.points tbody tr').count() === rows0, 'piecewise: remove point');
  await prop('Interpolation').selectOption('step');

  // Bits: Manchester preset, edit the sequence, measure duty
  await p.click('.tool:has-text("Manchester")');
  assert(await prop('Encoding').inputValue() === 'manchester', 'Manchester preset');
  await setProp('Bits', '1 0 1 1');
  assert(await prop('Bits').inputValue() === '1011', 'bits field strips spaces');
  await setProp('Bits', '10x1');
  assert((await p.locator('.notice').innerText()).includes('only 0 and 1'), 'invalid bits rejected with a message');
  assert(await prop('Bits').inputValue() === '1011', 'rejected text reverts to the stored bits');
  await p.locator('.properties label:has-text("Repeat the frame") input').check();
  await p.click('.measure button:has-text("Time cursors")');
  const mf = (l) => p.locator('.measure .field', { has: p.locator('label', { hasText: new RegExp('^' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input').first();
  for (const [l, v] of [['Cursor 1', '0'], ['Cursor 2', '4m']]) { const f = mf(l); await f.click(); await f.fill(v); await f.press('Enter'); }
  assert(await mval('Duty') === '50.00 %', 'Manchester frame duty is exactly 50 %: ' + await mval('Duty'));

  await p.click('.seg button:has-text("Stacked")');
  await p.click('button[aria-label^="Fit all"]');
  await p.screenshot({ path: path.join(out, 'm10-waveforms.png') });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
