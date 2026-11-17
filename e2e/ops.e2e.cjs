// End-to-end check of derived signals (M6): operations, expression editor, PWM, dependencies.
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const field = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
  const setField = async (label, text) => { const f = field(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const names = () => p.locator('.signal-list .name').allInnerTexts();
  const select = (i) => p.locator('.signal-list .row').nth(i).click();
  const expr = p.locator('.expr-input');

  // Test 3 through the UI: Sine + Sine(60°)
  await p.click('.tool:has-text("Sine")');
  await setField('Amplitude', '10');
  await p.click('.tool:has-text("Sine")');
  await setField('Amplitude', '10');
  await setField('Phase', '60');
  await select(0);
  await p.click('.tool:has-text("Add")');
  assert(JSON.stringify(await names()) === JSON.stringify(['Sine', 'Sine 2', 'Sum']), 'Add creates "Sum": ' + await names());
  assert(await expr.inputValue() === 'Sine + [Sine 2]', 'expression shows names: ' + await expr.inputValue());
  assert(await p.locator('.properties .kind').innerText() === 'Expression', 'properties show the expression panel');

  // Rename through "Name =" and edit with autocomplete
  await expr.click(); await expr.fill('');
  await p.keyboard.type('Vsum = Sin');
  const sugg = await p.locator('.suggest li').allInnerTexts();
  assert(sugg.some((s) => s.startsWith('Sine')) && sugg.some((s) => s.startsWith('sin()')), 'autocomplete offers signals and functions: ' + sugg.map((s) => s.split('\n')[0]).join(', '));
  await p.keyboard.press('Enter'); // accept "Sine"
  await p.keyboard.type(' + [Si');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); // second suggestion: Sine 2
  await p.keyboard.press('Enter'); // apply
  assert((await names())[2] === 'Vsum', 'renamed via "Vsum = …"');
  assert(await expr.inputValue() === 'Sine + [Sine 2]', 'expression applied: ' + await expr.inputValue());

  // Error with position marker
  await expr.click(); await expr.fill('Sine + Foo'); await expr.press('Escape').catch(() => {});
  await expr.click(); await expr.fill('Sine + Foo');
  await p.locator('.properties h2').click(); // blur → tries to apply
  await p.waitForTimeout(100);
  const errTxt = await p.locator('.expr-error').innerText().catch(() => '');
  assert(errTxt.includes('Unknown signal “Foo”') && (await p.locator('.expr-error mark').innerText()) === 'F', 'error shown with position marker');
  await expr.click(); await expr.press('Escape');
  assert(await expr.inputValue() === 'Sine + [Sine 2]', 'Escape restores the stored expression');

  // Delete protection
  await select(0);
  await p.keyboard.press('Delete');
  assert((await p.locator('.alert-dialog').innerText()).includes('Vsum'), 'input used by an expression cannot be deleted (popup names the dependent)');
  await p.click('.alert-dialog button.primary');

  // PWM: triangle carrier 1 kHz, reference = Sine (10 V) → make reference 0.8 amplitude
  await p.click('.tool:has-text("Triangle")');
  await setField('Frequency', '1k');
  await setField('Amplitude', '10');
  await select(0);
  await setField('Amplitude', '8');
  // B must be the carrier: reorder so the triangle follows Sine
  const rows = p.locator('.signal-list .row');
  await rows.nth(3).dragTo(rows.nth(1), { targetPosition: { x: 40, y: 4 } });
  await select(0);
  await p.click('.tool:has-text("Compare A > B")');
  const exprText = await expr.inputValue();
  assert(exprText === 'Sine > Triangle', 'comparator expression: ' + exprText);
  assert(await p.locator('.properties .kind').innerText() === 'Logic expression', 'logic expression detected');
  await setField('High level', '15');
  await p.click('.seg button:has-text("Stacked")');
  // Count vertical edges of the PWM trace over the 40 ms view (2 per carrier period → 80)
  const edges = await p.evaluate(() => {
    const paths = [...document.querySelectorAll('.plot-svg path[data-signal]')];
    const d = paths[paths.length - 1].getAttribute('d');
    const pts = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    let n = 0; for (let i = 1; i < pts.length; i++) if (pts[i][0] === pts[i - 1][0] && pts[i][1] !== pts[i - 1][1]) n++;
    return n;
  });
  assert(edges === 80, `PWM shows 80 vertical edges in 40 ms (1 kHz switching): ${edges}`);
  await p.screenshot({ path: path.join(out, 'm6-pwm.png') });

  // Undo removes the comparator in one step (level change first)
  await p.keyboard.press('Escape');
  // Undo stack: stacked mode, high level, comparator → three steps.
  for (let i = 0; i < 3; i++) await p.keyboard.press('Control+z');
  assert(!(await names()).includes('Comparison'), 'Ctrl+Z ×3 removes the comparator (mode, level, creation)');
  for (let i = 0; i < 3; i++) await p.keyboard.press('Control+y');
  assert((await names()).includes('Comparison'), 'Ctrl+Y ×3 restores it');

  // Save → open round trip keeps expressions
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const f = path.join(out, 'ops.wlab'); await dl.saveAs(f);
  await p.click('button[aria-label="New project"]');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await ch.setFiles(f);
  await p.waitForSelector('.signal-list .row');
  await p.locator('.signal-list .row', { hasText: 'Comparison' }).click();
  assert(await expr.inputValue() === 'Sine > Triangle' && await field('High level').inputValue() === '15 V', 'expression and logic level restored after reopen');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
