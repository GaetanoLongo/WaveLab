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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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

  if (await p.locator('.recovery-banner').count()) await p.click('.recovery-banner button:has-text("Discard")');
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

  // --- Protocol labels do not overlap (11-byte UART at the default zoom) ---
  const textOverlaps = () => p.evaluate(() => {
    const ts = [...document.querySelectorAll('.plot-svg text')].filter((t) => t.textContent.trim());
    const bb = ts.map((t) => { const r = t.getBoundingClientRect(); return { r, s: t.textContent }; });
    const bad = [];
    for (let i = 0; i < bb.length; i++) for (let j = i + 1; j < bb.length; j++) {
      const a = bb[i].r, b = bb[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(bb[i].s + ' / ' + bb[j].s);
    }
    return bad;
  });
  await p.click('.tool:has-text("UART / SPI")');
  await p.locator('.protocol-dialog .field:has(label:text-is("Data")) input').fill('Hello World');
  await p.click('.protocol-dialog button.primary');
  await p.waitForTimeout(500);
  const bad = await textOverlaps();
  assert(bad.length === 0, 'no overlapping text in the UART frame view: ' + bad.join(', '));

  // --- Context menu on a trace and on an annotation; annotation text size ---
  const pt = await p.evaluate(() => {
    const path = [...document.querySelectorAll('.plot-svg path[data-signal]')].find((e) => e.getAttribute('stroke-width') && e.getAttribute('stroke-opacity') !== '0.2') || document.querySelector('.plot-svg path[data-signal]');
    const len = path.getTotalLength(); const m = path.getScreenCTM(); const q = path.getPointAtLength(len * 0.5);
    return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
  });
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  const tItems = await p.locator('.context-menu button').allInnerTexts();
  assert(tItems.includes('Fit view to this signal') && tItems.includes('Duplicate'), 'right-click on a trace: ' + tItems.join(', '));
  await p.keyboard.press('Escape');
  const ann = await p.evaluate(() => { const t = [...document.querySelectorAll('.plot-svg text')].find((e) => e.textContent === 'S'); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(ann.x, ann.y, { button: 'right' });
  const aItems = await p.locator('.context-menu button').allInnerTexts();
  assert(aItems.includes('Edit annotation…') && aItems.includes('Delete annotation'), 'right-click on an annotation: ' + aItems.join(', '));
  await p.click('.context-menu button:has-text("Edit annotation")');
  const sizeField = p.locator('.annotations-dialog .ann-item.focused .field', { has: p.locator('label', { hasText: 'Text size' }) }).locator('input');
  const wBefore = await p.evaluate(() => { const t = [...document.querySelectorAll('.plot-svg text')].find((e) => e.textContent === 'S'); return t.getBoundingClientRect().width; });
  await sizeField.click(); await sizeField.fill('2'); await sizeField.press('Enter');
  await p.click('.annotations-dialog button:has-text("Done")');
  const wAfter = await p.evaluate(() => { const t = [...document.querySelectorAll('.plot-svg text')].find((e) => e.textContent === 'S'); return t.getBoundingClientRect().width; });
  assert(wAfter > wBefore * 1.5, `annotation text size multiplier works (${wBefore.toFixed(1)} → ${wAfter.toFixed(1)} px)`);

  // --- Share link: copy, open in a fresh page, same project ---
  await p.click('.toolbar button:has-text("New project"), button[title="New project"]').catch(() => {});
  await p.click('.tool:has-text("Sine")'); await p.click('.tool:has-text("Square")');
  const signalsBefore = await names();
  await p.click('.toolbar button:has-text("Share")');
  const link = await p.evaluate(() => navigator.clipboard.readText());
  assert(/#share=d?[A-Za-z0-9_-]+$/.test(link) || /#share=/.test(link), 'Share copies a link: ' + link.slice(0, 60) + '…');
  assert((await p.locator('.status .notice').innerText()).includes('Link copied'), 'a notice says the link was copied');
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await p2.waitForSelector('.signal-list .row');
  const signalsAfter = await p2.locator('.signal-list .name').allInnerTexts();
  assert(JSON.stringify(signalsAfter) === JSON.stringify(signalsBefore), 'the link opens the same signals: ' + signalsAfter);
  assert(!(await p2.evaluate(() => location.hash)), 'the fragment is removed from the address after opening');
  const badPage = await ctx.newPage();
  badPage.on("dialog", (d) => d.accept());
  await badPage.goto(url + '#share=dAAAAAAAA');
  await badPage.waitForSelector(".toolbar");
  assert(await badPage.locator(".toolbar").count() === 1, 'a damaged link does not break the app');
  await badPage.close(); await p2.close();

  // --- Edge and pulse measurements ---
  await p.click('button[title="New project"]').catch(() => {});
  await p.click('.tool:has-text("Square")');
  await p.click('.tool:has-text("Low-pass (RC)")');
  await p.waitForSelector('.measure .edges', { timeout: 8000 });
  const edgeText = await p.locator('.measure .edges').innerText();
  assert(/Rise/.test(edgeText) && /Fall/.test(edgeText) && /width/.test(edgeText), 'the Measure panel shows edge and pulse measurements: ' + edgeText.replace(/\s+/g, ' ').slice(0, 90));

  // --- CSV import (a scope-style export with the unit in the header) ---
  await p.click('button[title="New project"]').catch(() => {});
  const csvPath = path.join(out, 'scope.csv');
  const lines = ['Time (ms),CH1 (V),CH2 (V)'];
  for (let i = 0; i <= 400; i++) lines.push(`${(i * 0.05).toFixed(2)},${(2 * Math.sin((2 * Math.PI * 50 * i * 0.05) / 1000)).toFixed(5)},${i % 80 < 40 ? 3.3 : 0}`);
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.tool:has-text("Import CSV data")')]);
  await chooser.setFiles(csvPath);
  await p.waitForSelector('.modal');
  assert((await p.locator('.modal h2').innerText()).includes('scope.csv'), 'the import dialog opens for the file');
  assert((await p.locator('.modal select').first().inputValue()) === '0', 'the time column is found automatically');
  assert((await p.locator('.modal select').nth(1).inputValue()) === 'ms', 'the time unit is read from the header (ms)');
  assert((await p.locator('.modal .readout').innerText()).includes('401'), 'the dialog states the number of rows');
  await p.click('.modal footer button.primary');
  const imported = await p.locator('.signal-list .name').allInnerTexts();
  assert(imported.length === 2 && imported[0].startsWith('CH1'), 'two signals were created: ' + imported);
  await p.locator('.signal-list .row').first().click();
  await p.waitForTimeout(600);
  const maxText = await p.locator('.measure .m-grid').first().innerText();
  assert(/Max\s+2 V|Max\s+1\.99/.test(maxText), 'the imported signal measures like the data (peak ≈ 2 V): ' + maxText.replace(/\s+/g, ' ').slice(0, 60));
  await p.click('.tool:has-text("Absolute value")');
  assert((await p.locator('.signal-list .row').count()) === 3, 'imported data works with the operations');

  // --- Popovers stay inside the window at common laptop widths (the toolbar wraps there) ---
  for (const w of [1280, 1100, 900]) {
    await p.setViewportSize({ width: w, height: 800 });
    await p.waitForTimeout(300);
    const triggers = await p.locator('.toolbar .popover-anchor > button').count();
    for (let i = 0; i < triggers; i++) {
      await p.locator('.toolbar .popover-anchor > button').nth(i).click();
      await p.waitForTimeout(150);
      const r = await p.evaluate(() => { const e = document.querySelector('.popover'); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
      assert(r && r.l >= 0 && r.r <= w + 0.5 && r.b <= 800 + 0.5, `popover ${i} fits in the ${w}px window` + (r ? ` (x ${Math.round(r.l)}…${Math.round(r.r)}, bottom ${Math.round(r.b)})` : ' (not found)'));
      await p.keyboard.press('Escape');
      await p.mouse.click(w / 2, 400).catch(() => {});
    }
  }
  await p.setViewportSize({ width: 1400, height: 900 });

  assert(errs.length === 0, 'no page errors: ' + errs.join('; '));
  await b.close();
})().catch((e) => { console.log('FAIL: exception', e.message); process.exit(1); });
