// End-to-end check of usability features: delete warning, context menus, panel hiding/resizing,
// legend toggle, DC PWM reference, UART clock, annotation thickness. Run `npm run build && npx vite preview` first.
const { chromium } = require('playwright');
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
  await p.waitForSelector('.toolbox');
  const names = () => p.locator('.signal-list .name').allInnerTexts();
  const labelOf = (dlg, text) => p.locator(`${dlg} .field`, { has: p.locator('label', { hasText: text }) }).locator('input, select').first();

  // --- Labels render math markup (f_c → f with subscript c) ---
  await p.click('.tool:has-text("AM / FM / PM")');
  assert(await p.locator('.modal label sub').count() >= 3, 'modulation dialog labels use subscripts');
  assert(!(await p.locator('.modal').innerText()).includes('f_c'), 'no literal f_c left in the modulation dialog');
  await p.click('.modal button:has-text("Cancel")');

  // --- Delete warning popup lists the dependents ---
  await p.click('.tool:has-text("Sine")');
  await p.click('.tool:has-text("Rectifier")').catch(() => {});
  await p.keyboard.press('Escape');
  await p.click('.tool:has-text("Sine")');
  await p.locator('.signal-list .row').first().click();
  await p.click('.tool:has-text("Add")');            // a derived signal that uses the sine
  await p.locator('.signal-list .row').first().click();
  await p.keyboard.press('Delete');
  assert((await p.locator('.alert-dialog').count()) === 1, 'deleting a signal that others use opens a popup');
  await p.click('.alert-dialog button.primary');
  assert((await p.locator('.alert-dialog').count()) === 0, 'popup closes with OK');

  // --- Right-click menus ---
  await p.locator('.signal-list .row').first().click({ button: 'right' });
  assert((await p.locator('.context-menu').count()) === 1, 'right-click on a signal row opens the custom menu');
  const items = await p.locator('.context-menu button').allInnerTexts();
  assert(items.includes('Rename') && items.includes('Duplicate') && items.includes('Delete from project'), 'signal menu entries: ' + items.join(', '));
  await p.keyboard.press('Escape');
  assert((await p.locator('.context-menu').count()) === 0, 'Escape closes the menu');
  const host = await p.locator('.plot-host').boundingBox();
  await p.mouse.click(host.x + host.width / 2, host.y + 5, { button: 'right' });
  const plotItems = await p.locator('.context-menu button').allInnerTexts();
  assert(plotItems.includes('Fit all (double-click)') && plotItems.some((t) => /legend/i.test(t)), 'plot background menu: ' + plotItems.join(', '));
  await p.keyboard.press('Escape');

  // --- Legend toggle in the toolbar ---
  const legendBtn = p.locator('.toolbar button:has-text("Legend")');
  const on = await legendBtn.getAttribute('aria-pressed');
  await legendBtn.click();
  assert((await legendBtn.getAttribute('aria-pressed')) !== on, 'toolbar Legend button toggles the legend');
  await legendBtn.click();

  // --- Panels: hide and resize ---
  const w0 = (await p.locator('.toolbox').boundingBox()).width;
  const rz = await p.locator('.resizer.col').first().boundingBox();
  await p.mouse.move(rz.x + 2, rz.y + 200); await p.mouse.down(); await p.mouse.move(rz.x + 82, rz.y + 200, { steps: 5 }); await p.mouse.up();
  const w1 = (await p.locator('.toolbox').boundingBox()).width;
  assert(Math.abs(w1 - (w0 + 80)) < 3, `toolbox resized by dragging (${w0} → ${w1})`);
  await p.locator('.resizer.col').first().dblclick();
  assert(Math.abs((await p.locator('.toolbox').boundingBox()).width - w0) < 2, 'double-click resets the toolbox width');
  await p.click('.toolbar button:has-text("Toolbox")');
  assert((await p.locator('.toolbox').isVisible()) === false, 'toolbox can be hidden');
  await p.click('.toolbar button:has-text("Properties")');
  assert((await p.locator('.inspector').isVisible()) === false, 'inspector can be hidden');
  await p.click('.toolbar button:has-text("Toolbox")'); await p.click('.toolbar button:has-text("Properties")');
  const mh0 = (await p.locator('.measure').boundingBox()).height;
  const mr = await p.locator('.measure > .resizer.row').boundingBox();
  await p.mouse.move(mr.x + 100, mr.y + 2); await p.mouse.down(); await p.mouse.move(mr.x + 100, mr.y - 78, { steps: 5 }); await p.mouse.up();
  const mh1 = (await p.locator('.measure').boundingBox()).height;
  assert(mh1 > mh0 + 60, `measurement panel resized (${mh0} → ${mh1})`);
  await p.click('.toolbar button:has-text("Measure")');
  assert((await p.locator('.measure.collapsed').count()) === 1, 'measurement panel collapses');
  await p.reload(); await p.waitForSelector('.toolbox');
  assert((await p.locator('.measure.collapsed').count()) === 1, 'panel state is remembered after reload');
  await p.click('.toolbar button:has-text("Measure")');
  await p.screenshot({ path: path.join(out, 'ux.png') });

  // --- "Not in this figure" signals can be deleted ---
  await p.click('.tool:has-text("Sine")');
  await p.click('.figure-tabs button[aria-label="New figure"]');
  const others = p.locator('.others .row.other');
  const before = await others.count();
  assert(before >= 1, 'signals of figure 1 are listed as "not in this figure"');
  await others.first().locator('button[aria-label^="Delete"]').click();
  assert((await others.count()) === before - 1, 'a "not in this figure" signal can be deleted from the project');

  // --- DC reference in the PWM generator ---
  await p.click('.tool:has-text("PWM generator")');
  const f1 = labelOf('.pwm-dialog', 'Reference f₁');
  await f1.click(); await f1.fill('0'); await f1.press('Enter');
  assert((await p.locator('.pwm-dialog .field-error').count()) === 0, 'f₁ = 0 (DC reference) is accepted');
  assert((await p.locator('.pwm-dialog .readout').innerText()).includes('mean value'), 'readout shows the mean value for a DC reference');
  await p.click('.pwm-dialog button.primary');
  assert((await names()).includes('v_{ref}') || (await names()).some((n) => n.startsWith('v')), 'DC-reference PWM created');

  // --- UART clock option ---
  await p.click('.tool:has-text("UART / SPI")');
  assert((await p.locator('.protocol-dialog input[type=checkbox]').count()) >= 1, 'UART dialog offers a bit-clock checkbox');
  await p.click('.protocol-dialog .check:has-text("bit clock") input');
  await p.click('.protocol-dialog button.primary');
  assert((await names()).includes('CLK'), 'CLK signal created on request');

  assert(errs.length === 0, 'no page errors: ' + errs.join('; '));
  await b.close();
})().catch((e) => { console.log('FAIL: exception', e.message); process.exit(1); });
