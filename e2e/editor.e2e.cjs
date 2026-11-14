// End-to-end check of the editor UI. Run `npm run build && npx vite preview` first, then `npm run e2e`.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const sp = process.argv[2] || require('os').tmpdir();
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 820 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.waitForSelector('.toolbox');
  const names = async () => p.locator('.signal-list .name').allInnerTexts();
  const field = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
  const setField = async (label, text) => { const f = field(label); await f.click(); await f.fill(text); await f.press('Enter'); };

  // Acceptance test 1 through the UI
  await p.click('.tool:has-text("Square")');
  await setField('High level', '230');
  await setField('Low level', '-230');
  assert(await field('Amplitude').inputValue() === '230 V', 'amplitude shows 230 V');
  assert(await field('Period').inputValue() === '20 ms', 'period shows 20 ms');
  await setField('Period', '10m');
  assert(await field('Frequency').inputValue() === '100 Hz', 'period 10m -> 100 Hz');
  await p.keyboard.press('Control+z');
  assert(await field('Frequency').inputValue() === '50 Hz', 'Ctrl+Z restores 50 Hz');
  await p.keyboard.press('Control+y');
  assert(await field('Frequency').inputValue() === '100 Hz', 'Ctrl+Y redoes 100 Hz');
  await p.keyboard.press('Control+z');

  // invalid input
  const fq = field('Frequency'); await fq.click(); await fq.fill('abc'); await fq.press('Enter');
  assert(await p.locator('.field-error').count() === 1, 'invalid input flagged');
  await fq.press('Escape');
  assert(await field('Frequency').inputValue() === '50 Hz' && await p.locator('.field-error').count() === 0, 'Escape reverts invalid input');
  await fq.click(); await fq.fill('77'); await fq.press('Escape');
  assert(await field('Frequency').inputValue() === '50 Hz', 'Escape discards a valid but uncommitted edit');
  await fq.click(); await fq.fill('60'); await p.locator('.properties h2').click();
  assert(await field('Frequency').inputValue() === '60 Hz', 'blur commits a valid edit');
  await p.keyboard.press('Control+z');

  // Sine + phase 120 -> phase as time
  await p.click('.tool:has-text("Sine")');
  await setField('Phase', '120');
  assert((await field('Phase as time').inputValue()) === '6.66667 ms', 'phase 120° at 50 Hz = 6.66667 ms (got ' + await field('Phase as time').inputValue() + ')');
  assert((await p.locator('.readout').last().innerText()).includes('earlier'), 'net shift says earlier');
  await p.click('.seg button:has-text("Stacked")');
  await p.screenshot({ path: sp + '/m3-editor.png' });

  // shortcuts: duplicate, delete
  await p.locator('.plot-host').click({ position: { x: 5, y: 5 } }); // focus plot (empty click -> deselect)
  await p.locator('.signal-list .row').nth(1).click();
  await p.keyboard.press('Control+d');
  assert(JSON.stringify(await names()) === JSON.stringify(['Square', 'Sine', 'Sine copy']), 'Ctrl+D duplicates after original: ' + await names());
  await p.keyboard.press('Delete');
  assert((await names()).length === 2, 'Delete removes selected');

  // copy/paste
  await p.locator('.signal-list .row').nth(0).click();
  await p.keyboard.press('Control+c');
  await p.keyboard.press('Control+v');
  assert((await names()).includes('Square copy'), 'Ctrl+C / Ctrl+V pastes a copy');

  // lock
  await p.locator('.signal-list .row').nth(0).locator('button[title="Lock"]').click();
  await p.locator('.signal-list .row').nth(0).click();
  assert(await field('Frequency').isDisabled(), 'locked signal fields are disabled');
  await p.keyboard.press('Delete');
  assert((await p.locator('.notice').innerText()).includes('locked'), 'deleting locked signal shows notice');
  await p.locator('.signal-list .row').nth(0).locator('button[title="Unlock"]').click();

  // rename via double-click
  await p.locator('.signal-list .row').nth(1).locator('.name').dblclick();
  await p.keyboard.press('Control+a'); await p.keyboard.type('Vref'); await p.keyboard.press('Enter');
  assert((await names())[1] === 'Vref', 'rename via double-click');

  // drag reorder: move first row below last
  const rows = p.locator('.signal-list .row');
  await rows.nth(0).dragTo(rows.nth(2), { targetPosition: { x: 50, y: 18 } });
  assert(JSON.stringify(await names()) === JSON.stringify(['Vref', 'Sine', 'Square']), 'drag reorder: ' + await names());

  // hide
  await rows.nth(0).locator('button[title="Hide"]').click();
  const panels = await p.locator('.plot-svg clipPath').count();
  assert(panels === 2, 'hidden signal removed from stacked plot (panels=' + panels + ')');
  await rows.nth(0).locator('button[title="Show"]').click();

  // click a trace selects it: top panel is Vref (sine). Click at t where sine crosses...
  await p.locator('.signal-list .row').nth(2).click();
  const host = await p.locator('.plot-host').boundingBox();
  // find a data path for first trace and click a point on it via evaluate
  const pt = await p.evaluate(() => {
    const path = document.querySelector('.plot-svg path[data-signal]');
    const len = path.getTotalLength(); const q = path.getPointAtLength(len * 0.3);
    return { x: q.x, y: q.y, id: path.getAttribute('data-signal') };
  });
  await p.mouse.click(host.x + pt.x, host.y + pt.y);
  assert((await p.locator('.signal-list .row.selected .name').innerText()) === 'Vref', 'clicking a trace selects it');

  // dirty + new project confirm
  assert(await p.locator('.dirty').count() === 1, 'unsaved indicator shown');
  p.once('dialog', d => d.accept());
  await p.click('button[aria-label="New project"]');
  assert((await names()).length === 0 && await p.locator('.dirty').count() === 0, 'New project (confirmed) resets');
  await p.screenshot({ path: sp + '/m3-empty.png' });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
