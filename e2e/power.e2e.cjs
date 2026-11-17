// End-to-end checks of F1 (power electronics II): rectifiers, zero-sequence PWM, load currents, power metrics.
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
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const dfield = (dlg, label) => p.locator(`${dlg} .field`, { has: p.locator('label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input, select').first();
  const setD = async (dlg, label, v) => { const f = dfield(dlg, label); await f.click(); await f.fill(v); await f.press('Enter'); };
  const measure = async (label) => p.locator('.measure .m-grid dt', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::dd[1]').innerText();

  // --- Rectifier: full-wave thyristor bridge, R load, α = 60° ---
  await p.click('.tool:has-text("Rectifier / phase control")');
  assert(await p.locator('.rectifier-dialog').count() === 1, 'rectifier dialog opens');
  await dfield('.rectifier-dialog', 'Topology').selectOption('full-scr');
  await setD('.rectifier-dialog', 'Firing angle α', '60');
  const readout = await p.locator('.rectifier-dialog .readout dd').first().innerText();
  assert(readout.startsWith('155.3'), 'expected mean V_m(1+cos α)/π = 155.3 V: ' + readout);
  await p.click('.rectifier-dialog button.primary');
  await p.locator('.signal-list .row', { hasText: 'vo' }).first().click();
  // Measure over exactly one period: 0…20 ms is the default view.
  const mean = await measure('Mean');
  assert(mean.startsWith('155.3'), 'measured mean of v_o = 155.3 V: ' + mean);
  await p.screenshot({ path: path.join(out, 'rectifier.png') });

  // --- Three-phase SVPWM with load and dead time ---
  await p.click('button[aria-label^="New"]').catch(() => {});
  p.on('dialog', (d) => d.accept());
  await p.click('.tool:has-text("PWM generator")');
  const P = '.pwm-dialog';
  await dfield(P, 'Topology').selectOption('three-phase');
  await dfield(P, 'Reference').selectOption('svpwm');
  await setD(P, 'Modulation index m', '1.1');
  assert(await p.locator(`${P} .warn`).count() === 0, 'm = 1.1 is still linear with SVPWM (no warning)');
  await setD(P, 'Carrier fc', '2550');
  await setD(P, 'Dead time td', '4u');
  await p.locator(`${P} .check`, { hasText: 'Load currents' }).locator('input').check();
  await setD(P, 'L', '20m');
  await p.click(`${P} button.primary`);
  const names = await p.locator('.signal-list .row .name').allInnerTexts();
  assert(names.includes('ia') && names.includes('vaN,dt') && names.includes('vref,a'), 'load currents, dead-time voltages and SVPWM references created');
  await p.locator('.signal-list .row', { hasText: 'vAB' }).first().click();
  await p.click('button[aria-label^="Spectrum"]');
  const fund = await p.locator('.spectrum-summary div', { has: p.locator('dt:text-is("Fundamental")') }).locator('dd').innerText();
  assert(fund.startsWith('381'), 'v_AB fundamental √3/2·1.1·400 = 381 V: ' + fund);
  await p.click('.spectrum-dialog button:has-text("Done")');
  await p.screenshot({ path: path.join(out, 'svpwm.png') });

  // --- Power metrics: v_aN,dt × i_a ---
  await p.locator('.signal-list .row', { hasText: 'vaN,dt' }).first().click();
  await p.locator('.measure select[aria-label="Current signal"]').selectOption({ label: 'ia' });
  const pf = await measure('PF');
  const dpf = await measure('DPF');
  const pW = await measure('P');
  // R = 10 Ω, ωL = 6.28 Ω → cos φ₁ = 10/11.81 = 0.847
  assert(Math.abs(parseFloat(dpf) - 0.8467) < 0.01, 'displacement PF ≈ R/|Z| = 0.847: ' + dpf);
  assert(parseFloat(pf) < parseFloat(dpf) + 1e-3 && parseFloat(pW) > 0, `PF ≤ DPF and P > 0 (PF ${pf}, P ${pW})`);
  assert((await measure('Crest')) !== '—' && (await measure('Form')) !== '—', 'crest and form factors shown');
  await p.locator('.measure').screenshot({ path: path.join(out, 'power.png') });

  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log('screenshots in', out);
})();
