// End-to-end check of figure settings and axes (M9). Run `npm run build && npx vite preview` first.
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
  const svg = () => p.locator('.plot-svg').innerHTML();
  const dfield = (sel, label) => p.locator(`${sel} .field`, { has: p.locator('label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input, select').first();
  const setD = async (sel, label, text) => { const f = dfield(sel, label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const prop = (label) => p.locator('.properties .field', { has: p.locator('label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input').first();
  const setProp = async (label, text) => { const f = prop(label); await f.click(); await f.fill(text); await f.press('Enter'); };

  await p.click('.tool:has-text("Sine")');
  await p.click('.tool:has-text("Square")');

  // Settings dialog: dark preset, legend outside, serif warning
  await p.click('button[aria-label^="Figure settings"]');
  await dfield('.settings-dialog', 'Preset').selectOption('dark');
  assert((await svg()).includes('fill="#0f141c"'), 'Dark technical preset applied on screen');
  await dfield('.settings-dialog', 'Position').selectOption('outside-right');
  await dfield('.settings-dialog', 'Font').selectOption('serif');
  assert((await p.locator('.settings-dialog .warn').innerText()).includes('Only Inter is embedded'), 'PDF font warning for serif');
  assert((await svg()).includes('STIX Two Text'), 'serif font family in the figure');
  await p.screenshot({ path: path.join(out, 'm9-settings.png') });
  await p.click('.settings-dialog button:has-text("Reset to preset")');
  assert(!(await svg()).includes('STIX Two Text'), 'reset removes overrides');
  await dfield('.settings-dialog', 'Preset').selectOption('presentation');
  await p.keyboard.press('Escape');
  assert((await svg()).includes('font-size="17"'), 'Presentation preset: 17 px text');

  // Axes dialog via status bar range
  await p.click('.range-btn');
  assert(await p.locator('.axes-dialog section.focused[data-axis="x"]').count() === 1, 'status-bar range opens Axes with the time axis focused');
  await setD('.axes-dialog section[data-axis="x"]', 'From', '5m');
  await setD('.axes-dialog section[data-axis="x"]', 'To', '15m');
  assert((await p.locator('.range-btn').innerText()).startsWith('5 ms → 15 ms'), 'zoom to interval 5–15 ms');
  await setD('.axes-dialog section[data-axis="x"]', 'Title', 't (ms)');
  assert((await svg()).includes('>t (ms)</text>'), 'custom time-axis title');
  await p.keyboard.press('Escape');

  // Log scale on a positive signal: make the sine 2 ± 1 V via offset
  await p.locator('.signal-list .row').nth(0).click();
  await setProp('Offset', '2');
  await p.click('.seg button:has-text("Stacked")');
  const box = await p.locator('.plot-host').boundingBox();
  await p.mouse.dblclick(box.x + 30, box.y + 120); // y-axis area of the first panel
  const focused = await p.locator('.axes-dialog section.focused').getAttribute('data-axis');
  assert(focused && focused.startsWith('stack-'), 'double-click on a vertical axis opens its settings: ' + focused);
  const logBox = p.locator('.axes-dialog section.focused label:has-text("Logarithmic scale") input');
  assert(!(await logBox.isDisabled()), 'log scale allowed for a positive signal');
  await logBox.check();
  const logLabels = await p.evaluate(() => [...document.querySelectorAll('.plot-svg text')].map((t) => t.textContent));
  assert(logLabels.includes('1') && logLabels.includes('10'), 'log axis labelled by decades');
  const sqLog = p.locator('.axes-dialog section[data-axis^="stack-"]').nth(1).locator('label:has-text("Logarithmic scale") input');
  assert(await sqLog.isDisabled(), 'log scale disabled for the ±1 V square (not positive)');
  await p.click('.axes-dialog button:has-text("Done")');
  await p.screenshot({ path: path.join(out, 'm9-axes.png') });

  // Persisted in the project
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const f = path.join(out, 'style.wlab'); await dl.saveAs(f);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const fig = j.project.figures[0];
  assert(fig.stylePreset === 'presentation' && fig.axes.x.title === 't (ms)' && Object.values(fig.axes.y).some((a) => a.log), 'style preset and axis settings saved in .wlab');
  assert(j.view.xRange[0] === 0.005 && j.view.xRange[1] === 0.015, 'visible interval saved');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
