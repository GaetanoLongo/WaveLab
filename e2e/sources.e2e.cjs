// End-to-end checks of F2 (signal generation): chirp, noise, PRBS, quantize / sample & hold, modulation.
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
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const field = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input, select').first();
  const setField = async (label, text) => { const f = field(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const readout = async (label) => p.locator('.properties .readout div', { has: p.locator(`dt:text-is("${label}")`) }).locator('dd').innerText();
  const measure = async (label) => p.locator('.measure .m-grid dt', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::dd[1]').innerText();

  // Chirp
  await p.click('.tool:has-text("Chirp (linear)")');
  assert((await readout('Cycles in the sweep')) === '11.000', 'linear chirp 50→500 Hz over 40 ms: 11 cycles');
  await field('Sweep').selectOption('log');
  assert((await readout('Sweep rate')).includes('oct/s'), 'log sweep shows octaves per second');

  // Noise (hold): exact RMS over one period
  await p.click('.tool:has-text("Noise")');
  await field('Between samples').selectOption('hold');
  await setField('Length', '100');
  await p.click('.range-btn');
  const xs = '.axes-dialog section[data-axis="x"]';
  const ax = async (l, v) => { const f = p.locator(xs).locator('.field', { has: p.locator(`label:text-is("${l}")`) }).locator('input'); await f.click(); await f.fill(v); await f.press('Enter'); };
  await ax('To', '10m'); await ax('From', '0');
  await p.keyboard.press('Escape');
  assert((await measure('RMS')).startsWith('100'), 'noise RMS over one period = σ = 100 mV: ' + await measure('RMS'));
  assert((await measure('Mean')).startsWith('0'), 'noise mean = 0');

  // PRBS
  await p.click('.tool:has-text("PRBS")');
  assert((await readout('Period')).startsWith('127 bits'), 'PRBS-7 period 127 bits');
  await field('Sequence').selectOption('9');
  assert((await readout('Period')).startsWith('511 bits'), 'PRBS-9 period 511 bits');

  // Quantize the chirp
  await p.locator('.signal-list .row', { hasText: 'Chirp' }).first().click();
  await p.click('.tool:has-text("Quantize")');
  assert((await p.locator('.expr-input').inputValue()).startsWith('quantize(Chirp, 0.1)'), 'Quantize creates quantize(A, 0.1)');
  await p.click('.tool:has-text("Sample & hold")');
  assert((await p.locator('.expr-input').inputValue()).startsWith('zoh(Quantized'), 'Sample & hold creates zoh(A, Ts)');
  await p.screenshot({ path: path.join(out, 'sources.png') });

  // FM with β = 1
  await p.click('button[aria-label^="New"]').catch(() => {});
  await p.click('.tool:has-text("AM / FM / PM")');
  const D = '.modulation-dialog';
  const df = (l) => p.locator(`${D} .field`, { has: p.locator(`label:text-is("${l}")`) }).locator('input, select').first();
  await df('Type').selectOption('fm');
  for (const [l, v] of [['Frequency deviation Δf', '100'], ['Message f_m', '100']]) { const f = df(l); await f.click(); await f.fill(v); await f.press('Enter'); }
  assert((await p.locator(`${D} .readout dd`).first().innerText()) === '1.000', 'β = Δf/f_m = 1');
  await p.click(`${D} button.primary`);
  await p.locator('.signal-list .row', { hasText: 'vFM' }).first().click();
  await p.click('button[aria-label^="Spectrum"]');
  const rows = await p.locator('.spectrum-dialog tbody tr').allInnerTexts();
  const carrier = rows.find((r) => r.startsWith('10\t') || r.startsWith('10 '));
  assert(carrier && carrier.includes('765'), 'FM carrier line = J0(1) = 0.765 V: ' + carrier);
  await p.locator('.spectrum-dialog').screenshot({ path: path.join(out, 'fm-spectrum.png') });
  await p.click('.spectrum-dialog button:has-text("Done")');

  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log('screenshots in', out);
})();
