// End-to-end checks of the S1 stabilisation fixes (stress-test findings).
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const field = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input, select').first();
  const setField = async (label, text) => { const f = field(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const expr = p.locator('.expr-input');
  const names = () => p.locator('.signal-list .name').allInnerTexts();
  const timed = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };

  // --- Freezes: fast sine with the measurement panel open ---
  await p.click('.tool:has-text("Sine")');
  const ms = await timed(async () => { await setField('Frequency', '100k'); await p.locator('.measure').innerText(); });
  assert(ms < 4000, `100 kHz sine renders and measures quickly (${ms} ms)`);
  await setField('Frequency', '50');

  // --- Period that would give an infinite frequency is refused ---
  await setField('Period', '1e-320');
  assert(await field('Period').getAttribute('aria-invalid') === 'true', 'period 1e-320 refused');
  await field('Period').press('Escape');
  assert((await field('Frequency').inputValue()).startsWith('50'), 'frequency unchanged');

  // --- Expression limits and constant arguments ---
  await p.click('.tool:has-text("Square")');
  await p.locator('.signal-list .row', { hasText: 'Square' }).click();
  await p.click('.tool:has-text("Expression…")');
  const apply = async (text) => { await expr.click(); await expr.fill(text); await expr.press('Enter'); await p.waitForTimeout(100); };
  await apply('rms(Square, 1e309)');
  assert((await p.locator('.expr-error').innerText().catch(() => '')).includes('out of range'), '1e309 rejected as out of range');
  await expr.press('Escape');
  const ms2 = await timed(async () => { await apply('movavg(Square, 1M)'); await p.locator('.measure').innerText(); });
  assert(ms2 < 4000 && (await p.locator('.expr-error').count()) === 0, `movavg over 1e6 s is accepted and fast (${ms2} ms)`);
  await apply('delay(Square, abs(-5m))');
  assert((await p.locator('.expr-error').count()) === 0, 'abs() of a constant accepted as a time argument');
  await apply('Square * 1T * 1f');
  assert((await p.locator('.expr-error').count()) === 0, 'T and f prefixes accepted in expressions');

  // --- Enter applies when the typed word is complete (t, e) ---
  await expr.click(); await expr.fill(''); await p.keyboard.type('Y = 0.25*t'); await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  assert((await names()).includes('Y') && (await expr.inputValue()) === '0.25 * t', 'Enter after "t" applies the expression: ' + await expr.inputValue());

  // --- Names: duplicates and "]" refused ---
  await setField('Name', 'Sine');
  assert((await names()).includes('Y') && (await p.locator('.notice').innerText()).includes('already called'), 'duplicate name refused with a notice');
  await setField('Name', 'a]b');
  assert(!(await names()).includes('a]b') && (await p.locator('.notice').innerText()).includes('cannot contain'), 'name with "]" refused');
  await apply('Sine = t');
  assert((await p.locator('.expr-error').innerText().catch(() => '')).includes('already called'), '"Name = expr" with a taken name refused');
  await expr.press('Escape');

  // --- Tick labels with a fractional fixed step ---
  await p.click('.range-btn');
  const xsec = '.axes-dialog section[data-axis="x"]';
  await p.locator(xsec).locator('.check', { hasText: 'Auto' }).locator('input').uncheck();
  const step = p.locator(xsec).locator('.field', { has: p.locator('label:text-is("Step")') }).locator('input');
  assert(!(await step.inputValue()).startsWith('1 s'), 'unticking Auto seeds the automatic step: ' + await step.inputValue());
  await step.click(); await step.fill('2.5m'); await step.press('Enter');
  await p.keyboard.press('Escape');
  const labels = await p.locator('.plot-svg text').evaluateAll((els) => els.map((e) => e.textContent));
  assert(labels.includes('2.5') && labels.includes('7.5'), 'time ticks 2.5, 7.5 … with a 2.5 ms step');
  assert(labels.some((l) => l.startsWith('−')), 'negative tick labels use the minus sign');

  // --- Recovery copy ---
  await p.waitForTimeout(1200);
  await p.reload();
  assert(await p.locator('.recovery-banner').count() === 1, 'recovery banner offered after reload');
  await p.click('.recovery-banner button:has-text("Restore")');
  assert((await names()).includes('Y') && (await p.locator('.dirty').count()) === 1, 'restored work, marked unsaved');
  await p.click('button[aria-label^="New"]').catch(() => {});
  await p.waitForTimeout(1200);
  await p.reload();
  assert(await p.locator('.recovery-banner').count() === 0, 'no banner once the work is discarded');

  // --- Spectrum: automatic fundamental for PWM whose pattern period is longer than 1/f1 ---
  await p.click('.tool:has-text("PWM generator")');
  const dfield = (label) => p.locator('.pwm-dialog .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input, select').first();
  await dfield('Topology').selectOption('full-bipolar');
  for (const [l, v] of [['Carrier frequency f_c', '1025'], ['Dead time t_d', '0']]) {
    const f = dfield(l); if (await f.count()) { await f.click(); await f.fill(v); await f.press('Enter'); }
  }
  await p.click('.pwm-dialog button.primary');
  await p.locator('.signal-list .row', { hasText: 'vAB' }).first().click();
  await p.click('button[aria-label^="Spectrum"]');
  const fund = await p.locator('.spectrum-summary div', { has: p.locator('dt:text-is("Fundamental")') }).locator('dd').innerText();
  assert(fund.startsWith('320'), 'auto fundamental = reference (320 V at 50 Hz): ' + fund);
  await p.click('.spectrum-dialog button:has-text("Done")');
  const gates = await p.locator('.signal-list .row .name').allInnerTexts();
  assert(gates.includes('SA+') && gates.includes('SA-'), 'upper and lower gates listed without dead time');

  // --- Malformed file values are refused quickly ---
  const huge = { format: 'wavelab-project', schemaVersion: 1, appVersion: 'x', savedAt: '', project: { name: 'x', signals: [], figures: [{ id: 'f', name: 'F', panels: [{ id: 'p', traces: [] }] }] }, view: { xRange: [-1e308, 1e308], yRanges: {} } };
  const bad = path.join(out, 'huge.wlab'); fs.writeFileSync(bad, JSON.stringify(huge));
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  const ms3 = await timed(async () => { await ch.setFiles(bad); await p.waitForTimeout(300); });
  assert(ms3 < 3000 && /±1e6 s|too large/.test(await p.locator('.notice').innerText()), `huge view range refused (${ms3} ms)`);

  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));

  // --- Phones in landscape: the panel area is usable ---
  for (const dev of ['iPhone 13 landscape', 'Pixel 7 landscape']) {
    const c2 = await b.newContext({ ...devices[dev] });
    const q = await c2.newPage();
    await q.goto(url); await q.evaluate(() => localStorage.clear()); await q.reload();
    const panel = await q.locator('.phone-panel').boundingBox();
    const vp = q.viewportSize();
    assert(panel && panel.height > 120 && panel.y + 40 < vp.height, `${dev}: panel visible (${panel && Math.round(panel.height)} px tall)`);
    await q.locator('.tool:has-text("Square")').tap();
    assert(await q.locator('.signal-list .row').count() + (await q.locator('.properties').count()) > 0, `${dev}: a waveform can be added`);
    const scrollW = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(scrollW <= 0, `${dev}: no horizontal page scroll`);
    await q.screenshot({ path: path.join(out, `${dev.replace(/ /g, '-')}.png`) });
    await c2.close();
  }

  await b.close();
  console.log('screenshots in', out);
})();
