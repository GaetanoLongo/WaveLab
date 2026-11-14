// End-to-end check of the spectrum dialog and CSV exports (M12). Run `npm run build && npx vite preview` first.
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
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const sfield = (label) => p.locator('.spectrum-dialog .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input, select').first();
  const summary = async (k) => p.locator('.spectrum-summary div', { has: p.locator(`dt:text-is("${k}")`) }).locator('dd').innerText();
  const row = async (order) => p.locator('table.harmonics tbody tr', { has: p.locator(`td:first-child:text-is("${order}")`) }).locator('td').allInnerTexts();

  await p.click('.tool:has-text("Square")');
  await p.click('button[aria-label^="Spectrum"]');
  assert(await p.locator('.spectrum-dialog').count() === 1, 'spectrum dialog opens');
  assert(await sfield('Fundamental').inputValue() === '50 Hz', 'fundamental auto = 1/period = 50 Hz');
  assert(await summary('THD') === '48.34 %', 'square THD = 48.34 %: ' + await summary('THD'));
  assert(await summary('DC') === '0 V', 'DC 0 V');
  const r3 = await row('3');
  assert(r3[1] === '150 Hz' && r3[2] === '424.41 mV', '3rd harmonic 150 Hz, 4/(3π) = 424.41 mV: ' + r3.join(' | '));
  assert(await row('2').then((r) => r.length) === 0, 'even harmonics absent');
  await sfield('Scale').selectOption('percent');
  assert((await row('3'))[2] === '33.33 %', '3rd = 33.33 % of the fundamental');
  await sfield('Scale').selectOption('db');
  assert((await row('3'))[2] === '-9.5 dB', '3rd = −9.5 dB');
  assert(await p.locator('.bar-chart rect.bar').count() > 10, 'bar chart drawn');
  await p.screenshot({ path: path.join(out, 'm12-spectrum.png') });

  // Harmonics CSV
  const [d1] = await Promise.all([p.waitForEvent('download'), p.click('.spectrum-dialog button:has-text("Export CSV")')]);
  const h = fs.readFileSync(await d1.path(), 'utf8').trim().split('\n');
  assert(h[0].startsWith('order,frequency_Hz,amplitude_peak') && h.length === 52, 'harmonics CSV: header + 51 rows (orders 0–50)');
  assert(Math.abs(Number(h[2].split(',')[2]) - 4 / Math.PI) < 1e-9, 'CSV fundamental = 4/π');

  // Non-matching fundamental → warning
  const f = sfield('Fundamental'); await f.click(); await f.fill('60'); await f.press('Enter');
  assert(await p.locator('.spectrum-dialog .warn').count() === 1, 'warning when the window is not a whole number of periods');
  await p.click('.spectrum-dialog button:has-text("Done")');

  // Sample CSV with exact edges
  await p.keyboard.press('Control+Shift+s');
  await p.click('.export-dialog .fmt button:has-text("CSV")');
  const n = p.locator('.export-dialog .field', { has: p.locator('label:text-is("Samples")') }).locator('input');
  await n.click(); await n.fill('5'); await n.press('Enter');
  const [d2] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
  const lines = fs.readFileSync(await d2.path(), 'utf8').trim().split('\n');
  assert(lines[0] === 't [s],Square [V]', 'sample CSV header');
  const at10 = lines.filter((l) => l.startsWith('0.01,'));
  assert(at10.length === 2 && at10[0] === '0.01,1' && at10[1] === '0.01,-1', 'jump at 10 ms exported as two rows (1 then −1): ' + JSON.stringify(at10));
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
