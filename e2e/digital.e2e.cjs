// End-to-end checks of F4: serial protocols, XY and eye views, RLC filters.
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const svgText = () => p.locator('.plot-svg text').evaluateAll((els) => els.map((e) => e.textContent));
  const D = '.protocol-dialog';
  const df = (l) => p.locator(`${D} .field`, { has: p.locator(`label:text-is("${l}")`) }).locator('input, select').first();

  // UART "Hi"
  await p.click('.tool:has-text("UART / SPI / I²C")');
  await p.click(`${D} .seg button:has-text("UART")`);
  await df('Data').fill('Hi');
  await p.click(`${D} button.primary`);
  let t = await svgText();
  assert(t.includes("0x48 'H'") && t.includes("0x69 'i'"), 'UART frame with decoded bytes');
  await p.screenshot({ path: path.join(out, 'uart.png') });

  // SPI mode 3 with MISO, then I²C read
  await p.click('button[aria-label^="New"]');
  await p.click('.tool:has-text("UART / SPI / I²C")');
  await p.click(`${D} .seg button:has-text("SPI")`);
  await df('Format').selectOption('hex');
  await df('Data').fill('A5 3C');
  await df('Mode').selectOption('3');
  await df('MISO data').fill('0F F0');
  await p.click(`${D} button.primary`);
  const names = await p.locator('.signal-list .row .name').allInnerTexts();
  assert(['CS', 'SCLK', 'MOSI', 'MISO'].every((n) => names.includes(n)), 'SPI lines created: ' + names.join(','));
  t = await svgText();
  assert(t.includes('0xA5') && t.includes('0xF0'), 'SPI bytes labelled on MOSI and MISO');
  await p.screenshot({ path: path.join(out, 'spi.png') });
  await p.click('button[aria-label^="New"]');
  await p.click('.tool:has-text("UART / SPI / I²C")');
  await p.click(`${D} .seg button:has-text("I²C")`);
  await df('Direction').selectOption('r');
  await p.click(`${D} button.primary`);
  t = await svgText();
  assert(t.includes('0x50 R') && t.includes('N') && t.includes('S') && t.includes('P'), 'I²C read: address, NACK, START and STOP labelled');
  await p.screenshot({ path: path.join(out, 'i2c.png') });

  // Eye: PRBS through an RLC low-pass
  await p.click('button[aria-label^="New"]');
  await p.click('.tool:has-text("PRBS")');
  await p.click('.tool:has-text("RLC low-pass")');
  const expr = await p.locator('.expr-input').inputValue();
  assert(expr.startsWith('lowpass2(PRBS7'), 'RLC low-pass tool: ' + expr);
  await p.locator('.expr-input').fill('lowpass2(PRBS7, 4k, 0.7)'); await p.locator('.expr-input').press('Enter');
  await p.click('.measure button:has-text("Eye…")');
  const info = await p.locator('.views-dialog .hint-text').last().innerText();
  const m = /Eye height at the centre: ([\d.]+) mV/.exec(info);
  assert(m && +m[1] > 100 && +m[1] < 1000, 'eye partly closed by the filter: ' + info);
  await p.locator('.views-dialog').screenshot({ path: path.join(out, 'eye.png') });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.views-dialog button:has-text("Export SVG")')]);
  assert(dl.suggestedFilename() === 'eye-diagram.svg', 'eye diagram exported as SVG');

  // XY: sine vs cosine
  await p.click('.views-dialog button:has-text("Done")');
  await p.click('button[aria-label^="New"]');
  await p.click('.tool:has-text("Sine")');
  await p.click('.tool:has-text("Cosine")');
  await p.click('.measure button:has-text("XY…")');
  await p.locator('.views-dialog .check input').check();
  const box = await p.locator('.views-dialog .views-plot clipPath rect').first().evaluate((r) => [+r.getAttribute('width'), +r.getAttribute('height')]);
  assert(Math.abs(box[0] - box[1]) < 1, 'equal scales: square plot area ' + box);
  await p.locator('.views-dialog').screenshot({ path: path.join(out, 'xy.png') });
  await p.click('.views-dialog button:has-text("Done")');

  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log('screenshots in', out);
})();
