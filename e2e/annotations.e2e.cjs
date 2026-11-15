// End-to-end checks of F3: annotations, TikZ export, clipboard, LaTeX-style labels.
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
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let promptText = 'v_{peak} = 1 V';
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? promptText : undefined));
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const svgText = () => p.locator('.plot-svg text').evaluateAll((els) => els.map((e) => e.textContent));
  await p.click('.tool:has-text("Square")');
  // Plot geometry from the SVG clip rect.
  const g = await p.evaluate(() => {
    const r = document.querySelector('.plot-svg clipPath rect');
    const host = document.querySelector('.plot-host').getBoundingClientRect();
    return { x: host.x + +r.getAttribute('x'), y: host.y + +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') };
  });
  const X = (ms) => g.x + (ms / 40) * g.w;
  const Y = (v, lo = -1.16, hi = 1.16) => g.y + ((hi - v) / (hi - lo)) * g.h;
  const tool = async (label) => { await p.click('button[aria-label="Annotations"]'); await p.click(`.annotate-menu button:has-text("${label}")`); };
  const drag = async (x0, y0, x1, y1) => { await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up(); };

  // Δt between the edges at 10 and 20 ms (snapping)
  await tool('Δt dimension');
  await drag(X(10.4), Y(0.5), X(19.7), Y(0.5));
  let texts = await svgText();
  assert(texts.includes('Δt = 10 ms'), 'Δt dimension snaps to the edges: ' + texts.filter((t) => t.startsWith('Δt')));
  // ΔV between the levels
  await tool('ΔV dimension');
  await drag(X(25), Y(0.97), X(25), Y(-0.98));
  texts = await svgText();
  assert(texts.includes('ΔV = 2 V'), 'ΔV dimension snaps to the levels: ' + texts.filter((t) => t.startsWith('ΔV')));
  // Text label with markup
  await tool('Text label');
  await p.mouse.click(X(31), Y(0.6));
  const tspans = await p.locator('.plot-svg text tspan').allTextContents();
  assert(tspans.includes('peak'), 'text label with subscript markup');
  // Arrow
  await tool('Arrow');
  await drag(X(13), Y(0.4), X(19.9), Y(0));
  assert(await p.locator('button[aria-label="Annotations"].active').count() === 0, 'tool switches off after placing');

  // Edit: double-click the Δt label line → dialog; change the label
  await p.click('button[aria-label="Annotations"]'); await p.click('.annotate-menu button:has-text("Edit annotations")');
  assert(await p.locator('.annotations-dialog .ann-item').count() === 4, 'edit dialog lists 4 annotations');
  const first = p.locator('.annotations-dialog .ann-item').first();
  const lbl = first.locator('.field', { has: p.locator('label:text-is("Label")') }).locator('input');
  await lbl.fill('T/2'); await lbl.press('Enter');
  await p.click('.annotations-dialog button:has-text("Done")');
  assert((await svgText()).includes('T/2'), 'custom dimension label');

  // Move by dragging the ΔV line, then delete with the keyboard, undo
  const before = await p.locator('.plot-svg').innerHTML();
  await drag(X(25), Y(0.3), X(28), Y(0.3));
  assert((await p.locator('.plot-svg').innerHTML()) !== before, 'dragging an annotation moves it');
  await p.keyboard.press('Delete');
  assert(!(await svgText()).includes('ΔV = 2 V'), 'Delete removes the selected annotation');
  await p.keyboard.press('Control+z');
  assert((await svgText()).includes('ΔV = 2 V'), 'undo restores it');

  // Δt from cursors
  await p.click('button:has-text("Time cursors")');
  await p.click('button[aria-label="Annotations"]'); await p.click('.annotate-menu button:has-text("Δt from time cursors")');
  assert((await p.locator('.plot-svg text').evaluateAll((els) => els.filter((e) => e.textContent.startsWith('Δt')).length)) >= 1, 'Δt dimension from the time cursors');

  // Save and reopen
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const file = path.join(out, 'ann.wlab'); await dl.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(saved.project.figures[0].annotations.length === 5, 'annotations saved in the file');
  await p.click('button[aria-label^="New"]');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await ch.setFiles(file); await p.waitForTimeout(300);
  assert((await svgText()).includes('T/2'), 'annotations restored after reopening');

  // Exports: SVG contains the annotation; TikZ download and clipboard
  await p.keyboard.press('Control+Shift+s');
  await p.click('.export-dialog .fmt button:has-text("TikZ")');
  const [tex] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog footer button.primary')]);
  const texFile = path.join(out, 'fig.tex'); await tex.saveAs(texFile);
  const src = fs.readFileSync(texFile, 'utf8');
  assert(src.includes('\\begin{groupplot}') && src.includes('{T/2}') && src.includes('\\end{document}'), 'TikZ file with groupplot and annotations');
  await p.keyboard.press('Control+Shift+s');
  await p.click('.export-dialog .fmt button:has-text("SVG")');
  await p.click('.export-dialog footer button:has-text("Copy")');
  await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('<?xml') && clip.includes('T/2'), 'SVG copied to the clipboard with the annotations');
  await p.click('.export-dialog .fmt button:has-text("PNG")');
  await p.click('.export-dialog footer button:has-text("Copy")');
  const ok = await p.waitForSelector('.export-dialog .copied:has-text("PNG image copied")', { timeout: 8000 }).then(() => true).catch(() => false);
  const errTxt = await p.locator('.export-dialog .warn').innerText().catch(() => '');
  assert(ok, 'PNG copied as an image ' + errTxt);
  await p.screenshot({ path: path.join(out, 'annotations.png') });
  await p.click('.export-dialog footer button:has-text("Cancel")');

  // LaTeX-style label
  await p.locator('.signal-list .row').first().click();
  const name = p.locator('.properties .field', { has: p.locator('label:text-is("Name")') }).locator('input');
  await name.fill('$\\hat{v}_{\\mathrm{out}}$'); await name.press('Enter');
  const leg = await p.locator('.signal-list .row .name').first().innerText();
  assert(leg.replace(/\s/g, '') === 'v̂out', 'LaTeX label ($, \\hat, \\mathrm) rendered: ' + JSON.stringify(leg));

  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log('screenshots in', out);
})();
