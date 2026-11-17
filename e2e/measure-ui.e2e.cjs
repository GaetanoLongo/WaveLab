// Numbers shown by the Measure panel and the Spectrum dialog, checked against closed-form values.
// Run `npm run build && npx vite preview` first.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

/** "3.2094 V", "100 mV", "1.5 kHz", "30.00 %", "−2 V" → number in base units. */
function num(text) {
  const t = text.replace(/−/g, '-').replace(/\s+/g, ' ').trim();
  const m = /^(-?[\d.]+(?:e[+-]?\d+)?)\s*(%|[pnuµmkMG]?)(?:[A-Za-zΩ°]*)$/.exec(t);
  if (!m) return NaN;
  const f = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9 }[m[2] === '%' ? '' : m[2]];
  return Number(m[1]) * (m[2] === '%' ? 0.01 : f);
}

(async () => {
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(url); await p.waitForSelector('.toolbox');
  const prop = (label) => p.locator('.properties .field', { has: p.locator('label', { hasText: new RegExp('^' + label + '$') }) }).locator('input').first();
  const setProp = async (label, text) => { const f = prop(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const tool = (name) => p.locator('.tool', { hasText: new RegExp('^' + name) }).first();
  const stat = async (name) => num(await p.locator('.measure .m-grid dt', { hasText: new RegExp(`^${name}$`) }).first().locator('xpath=following-sibling::dd[1]').innerText());
  const near = (got, want, rel, msg) => assert(Math.abs(got - want) <= rel * Math.max(1e-12, Math.abs(want)) + 1e-12, `${msg}: ${got} vs ${want}`);
  const fresh = async () => { await p.click('button[title="New project"]'); };
  // The visible window is two periods (40 ms) of a 50 Hz signal: whole periods.

  await fresh(); await tool('Sine').click();
  await setProp('Amplitude', '3'); await setProp('Offset', '1.5');
  await p.waitForTimeout(500);
  near(await stat('Mean'), 1.5, 1e-4, 'sine mean');
  near(await stat('RMS'), Math.sqrt(1.5 ** 2 + 9 / 2), 1e-4, 'sine rms');
  near(await stat('Pk-pk'), 6, 1e-6, 'sine pk-pk');
  near(await stat('Freq'), 50, 1e-4, 'sine frequency');

  await fresh(); await tool('Square').click();
  await setProp('High level', '5'); await setProp('Low level', '-2'); await setProp('Duty cycle', '30');
  await p.waitForTimeout(500);
  near(await stat('Mean'), -2 + 0.3 * 7, 1e-4, 'square mean');
  near(await stat('RMS'), Math.sqrt(0.3 * 25 + 0.7 * 4), 1e-4, 'square rms');
  near(await stat('Duty'), 0.3, 1e-3, 'square duty');
  near(await stat('Pk-pk'), 7, 1e-6, 'square pk-pk');

  await fresh(); await tool('Triangle').click();
  await setProp('Amplitude', '4'); await p.waitForTimeout(500);
  near(await stat('RMS'), 4 / Math.sqrt(3), 1e-4, 'triangle rms');
  near(await stat('Crest'), Math.sqrt(3), 1e-3, 'triangle crest factor √3');

  // Spectrum dialog: THD of a ±1 square wave
  await fresh(); await tool('Square').click();
  await setProp('High level', '1'); await setProp('Low level', '-1');
  await p.click('.measure button:has-text("Spectrum")'); await p.waitForSelector('.modal');
  await p.waitForTimeout(600);
  const summary = await p.locator('.spectrum-summary').innerText();
  const thdTxt = /THD\s*([\d.,]+)\s*%/.exec(summary.replace(/\s+/g, ' '));
  assert(thdTxt, 'the spectrum shows a THD: ' + summary.replace(/\s+/g, ' ').slice(0, 120));
  if (thdTxt) near(Number(thdTxt[1].replace(',', '.')), 48.34, 0.01, 'THD of a square wave (%)');
  const fund = /Fundamental\s*([\d.,]+)\s*V/.exec(summary.replace(/\s+/g, ' '));
  if (fund) near(Number(fund[1].replace(',', '.')), 4 / Math.PI, 0.002, 'fundamental of a ±1 square wave (4/π)');
  await p.keyboard.press('Escape');

  // Cursors: Δt, 1/Δt and the level between cursor positions typed in
  await fresh(); await tool('Sine').click();
  await p.click('.measure button:has-text("Time cursors")');
  const mf = (l) => p.locator('.measure .field', { has: p.locator('label', { hasText: new RegExp('^' + l + '$') }) }).locator('input').first();
  for (const [l, v] of [['Cursor 1', '5m'], ['Cursor 2', '15m']]) { const f = mf(l); await f.click(); await f.fill(v); await f.press('Enter'); }
  await p.waitForTimeout(400);
  near(await stat('Δt'), 0.01, 1e-9, 'Δt between the cursors');
  near(await stat('1/Δt'), 100, 1e-6, '1/Δt');
  const dy = await stat('ΔY');
  near(Math.abs(dy), 2, 1e-6, '|ΔY| between the peak at 5 ms and the trough at 15 ms');

  near(await stat('Mean'), 0, 1e-6, 'mean between the peak and the trough of a sine (symmetric: 0)');
  // Measuring between the cursors changes the window: 0…10 ms is one half period of the sine: mean = 2A/π
  for (const [l, v] of [['Cursor 1', '0'], ['Cursor 2', '10m']]) { const f = mf(l); await f.click(); await f.fill(v); await f.press('Enter'); }
  await p.waitForTimeout(500);
  near(await stat('Mean'), 2 / Math.PI, 1e-4, 'mean of a half period of a sine (2A/π)');

  assert(errs.length === 0, 'no page errors: ' + errs.join('; '));
  await b.close();
})().catch((e) => { console.log('FAIL: exception', e.message); process.exit(1); });
