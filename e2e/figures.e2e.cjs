// End-to-end check of groups and multiple figures (M11). Run `npm run build && npx vite preview` first.
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
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const prop = (label) => p.locator('.properties .field', { has: p.locator('label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('input').first();
  const setProp = async (label, text) => { const f = prop(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const panels = () => p.locator('.plot-svg clipPath').count();
  const rename = async (row, name) => { await row.locator('.name').dblclick(); await p.keyboard.press('Control+a'); await p.keyboard.type(name); await p.keyboard.press('Enter'); };

  // Three phases + a gate signal
  for (const [name, ph] of [['Va', '0'], ['Vb', '-120'], ['Vc', '120']]) {
    await p.click('.tool:has-text("Sine")');
    await setProp('Phase', ph);
    await rename(p.locator('.signal-list .row.selected'), name);
  }
  await p.click('.tool:has-text("Square")');
  await rename(p.locator('.signal-list .row.selected'), 'Gate');
  await p.click('.seg button:has-text("Stacked")');
  assert(await panels() === 4, 'stacked: 4 panels before grouping');

  // Group the phases: select Va → + Group, then drag Vb and Vc into it
  await p.locator('.signal-list .row', { hasText: 'Va' }).click();
  await p.click('.signal-list .group-add');
  assert(await p.locator('.group-head').count() === 2, 'two groups after "+ Group"');
  const head = p.locator('.group-head').nth(1);
  await head.locator('.group-name').dblclick();
  await p.keyboard.press('Control+a'); await p.keyboard.type('Phases'); await p.keyboard.press('Enter');
  for (const n of ['Vb', 'Vc']) {
    await p.locator('.signal-list .row', { hasText: n }).dragTo(p.locator('.group-head', { hasText: 'Phases' }));
  }
  const phases = await p.locator('.sig-group', { has: p.locator('.group-head', { hasText: 'Phases' }) }).locator('.row .name').allInnerTexts();
  assert(JSON.stringify(phases) === JSON.stringify(['Va', 'Vb', 'Vc']), 'drag-and-drop into the group: ' + phases.join(','));

  await p.locator('.group-head', { hasText: 'Phases' }).locator('button[aria-label="Share one panel"]').click();
  assert(await panels() === 2, 'shared group: phases in one panel + gate panel');
  const svg = await p.locator('.plot-svg').innerHTML();
  assert(svg.includes('>Va</text>') && svg.includes('>Vc</text>'), 'shared panel has its own legend');
  await p.screenshot({ path: path.join(out, 'm11-groups.png') });

  // Group hide-all
  await p.locator('.group-head', { hasText: 'Phases' }).locator('button[title="Hide all"]').click();
  assert(await panels() === 1, 'hide all hides the group');
  await p.locator('.group-head', { hasText: 'Phases' }).locator('button[title="Show all"]').click();

  // Second figure: empty, own zoom; add Gate from "Not in this figure"
  await p.click('.fig-add');
  assert(await p.locator('.fig-tab').count() === 2 && (await p.locator('.fig-tab.on .fig-name').innerText()) === 'Figure 2', 'new figure tab is active');
  assert(await p.locator('.signal-list .row:not(.other)').count() === 0, 'new figure starts empty');
  assert(await p.locator('.others').evaluate((e) => e.open), '"Not in this figure" opens automatically for an empty figure');
  await p.locator('.others .row', { hasText: 'Gate' }).locator('button[title="Show in this figure"]').click();
  assert(await p.locator('.signal-list .row:not(.other) .name').allInnerTexts().then((x) => x.join()) === 'Gate', 'existing signal added to the figure');
  await p.locator('.range-btn').click();
  const from = p.locator('.axes-dialog section[data-axis="x"] .field', { has: p.locator('label:text-is("To")') }).locator('input');
  await from.click(); await from.fill('5m'); await from.press('Enter');
  await p.keyboard.press('Escape');
  assert((await p.locator('.range-btn').innerText()).startsWith('0 s → 5 ms'), 'figure 2 zoomed to 0–5 ms');

  // Rename figure 2, switch back: figure 1 keeps its own view
  await p.locator('.fig-tab.on .fig-name').dblclick();
  await p.keyboard.press('Control+a'); await p.keyboard.type('Gate detail'); await p.keyboard.press('Enter');
  await p.locator('.fig-tab .fig-name', { hasText: 'Figure 1' }).click();
  assert((await p.locator('.range-btn').innerText()).startsWith('0 s → 40 ms'), 'figure 1 keeps its own zoom');
  assert(await panels() === 2, 'figure 1 still shows its groups');

  // Save → reopen
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const f = path.join(out, 'figures.wlab'); await dl.saveAs(f);
  await p.click('button[aria-label="New project"]');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await ch.setFiles(f);
  await p.waitForSelector('.fig-tab');
  const tabs = await p.locator('.fig-tab .fig-name').allInnerTexts();
  assert(JSON.stringify(tabs) === JSON.stringify(['Figure 1', 'Gate detail']), 'figures restored: ' + tabs.join(', '));
  assert(await panels() === 2 && await p.locator('.group-head', { hasText: 'Phases' }).count() === 1, 'groups and shared panel restored');
  await p.locator('.fig-tab .fig-name', { hasText: 'Gate detail' }).click();
  assert((await p.locator('.range-btn').innerText()).startsWith('0 s → 5 ms'), 'per-figure zoom restored');

  // Duplicate + delete
  await p.locator('.fig-tab.on button[aria-label="Duplicate figure"]').click();
  assert(await p.locator('.fig-tab').count() === 3, 'duplicate figure');
  await p.locator('.fig-tab.on button[aria-label="Delete figure"]').click();
  assert(await p.locator('.fig-tab').count() === 2, 'delete figure (signals stay in the project)');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
