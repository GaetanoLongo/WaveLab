// End-to-end check of the PWM module. Run `npm run build && npx vite preview` first.
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
  const dfield = (label) => p.locator('.pwm-dialog .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input, select').first();
  const setD = async (label, v) => { const f = dfield(label); await f.click(); await f.fill(v); await f.press('Enter'); };

  await p.click('.tool:has-text("PWM generator")');
  assert(await p.locator('.pwm-dialog').count() === 1, 'PWM dialog opens');
  await dfield('Topology').selectOption('three-phase');
  await setD('Dead time t_d', '2u');
  assert((await p.locator('.pwm-dialog .readout').innerText()).includes('277.1 V'), 'expected v_AB fundamental √3/2·0.8·400 = 277.1 V shown');
  await setD('Modulation index m', '1.2');
  assert(await p.locator('.pwm-dialog .warn').count() === 1, 'overmodulation warning for m > 1');
  await setD('Modulation index m', '0.8');
  await p.click('.pwm-dialog button.primary');

  const heads = await p.locator('.group-head .group-name').allInnerTexts();
  assert(heads.some((h) => h.startsWith('Modulation')) && heads.some((h) => h.startsWith('Gates (dead time)')) && heads.some((h) => h.startsWith('Voltages')), 'groups created: ' + heads.map((h) => h.split('\n')[0]).join(', '));
  const names = await p.locator('.signal-list .row:not(.other) .name').allInnerTexts();
  assert(names.includes('SA+') && names.includes('SC-') && names.includes('vAB'), 'gate and voltage signals created');
  assert(await p.locator('.seg button.on:has-text("Stacked")').count() === 1, 'stacked mode');

  // Spectrum of v_AB
  await p.locator('.signal-list .row', { hasText: 'vAB' }).click();
  await p.click('button[aria-label^="Spectrum"]');
  const fund = await p.locator('.spectrum-summary div', { has: p.locator('dt:text-is("Fundamental")') }).locator('dd').innerText();
  assert(fund.startsWith('277.1'), 'spectrum: v_AB fundamental ≈ 277.1 V: ' + fund);
  await p.click('.spectrum-dialog button:has-text("Done")');
  await p.screenshot({ path: path.join(out, 'pwm.png') });

  // Three-phase set and complementary pair from the toolbox
  await p.click('.tool:has-text("Three-phase set")');
  assert(await p.locator('.group-head .group-name', { hasText: 'Three-phase' }).count() === 1, 'three-phase set in its own shared group');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
