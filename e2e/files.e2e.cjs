// End-to-end check of save/open (.wlab) and PNG/SVG/PDF export (M5, acceptance Tests 7 and 8).
// Run `npm run build && npx vite preview` first. Uses pdftotext/pdffonts (poppler) when available.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-'));
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 820 }, acceptDownloads: true });
  // Force the download / file-chooser code path (the native pickers cannot be automated).
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear());
  const field = (label) => p.locator('.properties .field', { has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
  const setField = async (label, text) => { const f = field(label); await f.click(); await f.fill(text); await f.press('Enter'); };
  const rename = async (i, name) => { await p.locator('.signal-list .row').nth(i).locator('.name').dblclick(); await p.keyboard.press('Control+a'); await p.keyboard.type(name); await p.keyboard.press('Enter'); };

  // Build a project: V_{grid} sine 325 V, I_{L} square 150 Hz with delay, pulse hidden.
  await p.click('.tool:has-text("Sine")');
  await setField('Amplitude', '325');
  await rename(0, 'V_{grid}');
  await p.click('.tool:has-text("Square")');
  await setField('Frequency', '150');
  await setField('Delay', '1m');
  await rename(1, 'I_{L}');
  await setField('Unit', 'A');
  await p.click('.tool:has-text("Pulse train")');
  await p.locator('.signal-list .row').nth(2).locator('button[title="Hide"]').click();
  await p.click('.seg button:has-text("Stacked")');
  await p.locator('.name-btn').click(); await p.keyboard.press('Control+a'); await p.keyboard.type('Inverter demo'); await p.keyboard.press('Enter');
  const listBefore = await p.locator('.signal-list .name').allInnerTexts();
  assert(listBefore[0] === 'Vgrid' && (await p.locator('.signal-list .name sub').first().innerText()) === 'grid', 'math markup rendered in the signal list');
  const svgOnScreen = await p.locator('.plot-svg').innerHTML();
  assert(svgOnScreen.includes('font-size="8.64">grid</tspan>'), 'math markup rendered in the plot (tspan)');
  const exportSvgText = async () => {
    await p.keyboard.press('Control+Shift+s');
    await p.click('.export-dialog .fmt button:has-text("SVG")');
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
    const f = path.join(out, 'roundtrip-' + Date.now() + '.svg'); await d.saveAs(f);
    return fs.readFileSync(f, 'utf8');
  };
  const figureBefore = await exportSvgText();

  // --- Save (Ctrl+S) -> download ---
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const wlab = path.join(out, dl.suggestedFilename()); await dl.saveAs(wlab);
  assert(dl.suggestedFilename() === 'Inverter demo.wlab', 'save downloads "Inverter demo.wlab"');
  assert(await p.locator('.dirty').count() === 0, 'unsaved marker cleared after save');
  const json = JSON.parse(fs.readFileSync(wlab, 'utf8'));
  assert(json.format === 'wavelab-project' && json.project.signals.length === 3, 'file holds 3 signal definitions');
  assert(!JSON.stringify(json).match(/\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*,/), 'file contains no sample arrays');

  // --- New project, then Open the saved file ---
  await p.click('button[aria-label="New project"]');
  assert((await p.locator('.signal-list .row').count()) === 0, 'new project is empty');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await chooser.setFiles(wlab);
  await p.waitForSelector('.signal-list .row');
  const listAfter = await p.locator('.signal-list .name').allInnerTexts();
  assert(JSON.stringify(listAfter) === JSON.stringify(listBefore), 'Test 7: signal list restored: ' + listAfter.join(', '));
  assert((await p.locator('.name-btn').innerText()) === 'Inverter demo', 'project name restored');
  assert(await p.locator('.seg button.on:has-text("Stacked")').count() === 1, 'stacked mode restored');
  const figureAfter = await exportSvgText();
  assert(figureAfter === figureBefore, 'Test 7: reopened figure is identical (exported SVG byte-for-byte)');
  await p.click('.export-dialog .fmt button:has-text("PNG")').catch(() => {});
  await p.locator('.signal-list .row').nth(1).click();
  assert(await field('Frequency').inputValue() === '150 Hz' && await field('Delay').inputValue() === '1 ms', 'parameters restored (150 Hz, 1 ms delay)');
  assert(await field('Unit').inputValue() === 'A', 'unit restored');
  assert(await p.locator('.signal-list .row.hidden').count() === 1, 'hidden state restored');
  assert(await p.locator('.dirty').count() === 0, 'freshly opened project is not dirty');

  // --- Invalid file ---
  const bad = path.join(out, 'bad.wlab');
  const broken = JSON.parse(JSON.stringify(json)); broken.project.signals[0].timing.frequency = -1;
  fs.writeFileSync(bad, JSON.stringify(broken));
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
  await ch2.setFiles(bad);
  await p.waitForTimeout(300);
  assert((await p.locator('.notice').innerText()).includes('signals[0].timing.frequency must be between 1 µHz and 1 THz'), 'invalid file rejected with field path');
  assert((await p.locator('.signal-list .row').count()) === 3, 'current project kept after a failed open');

  // --- Export dialog ---
  await p.keyboard.press('Control+Shift+s');
  await p.waitForSelector('.export-dialog');
  await p.screenshot({ path: path.join(out, 'm5-export-dialog.png') });
  const exp = async (fmt) => {
    await p.click(`.export-dialog .fmt button:has-text("${fmt.toUpperCase()}")`);
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
    const f = path.join(out, d.suggestedFilename()); await d.saveAs(f);
    if (fmt !== 'pdf') await p.keyboard.press('Control+Shift+s');
    return f;
  };
  // PNG 2x (1000x600 default -> 2000x1200)
  const png = await exp('png');
  const pb = fs.readFileSync(png);
  const w = pb.readUInt32BE(16), h = pb.readUInt32BE(20);
  assert(pb.slice(1, 4).toString() === 'PNG' && w === 2000 && h === 1200, `PNG 2x is 2000×1200 (got ${w}×${h})`);
  // SVG
  const svgF = await exp('svg');
  const svg = fs.readFileSync(svgF, 'utf8');
  assert(svg.startsWith('<?xml') && svg.includes('width="1000" height="600"'), 'SVG has XML header and 1000×600 size');
  assert(svg.includes('>Time (ms)</text>') && svg.includes('>grid</tspan>') && /<path d="M/.test(svg), 'SVG has editable text, math tspans and vector paths');
  assert(!svg.includes('data:font'), 'SVG does not embed fonts (stays editable/light)');
  // PDF on A4 landscape
  await p.click('.export-dialog .fmt button:has-text("PDF")');
  await p.locator('.export-dialog .field', { has: p.locator('label:text-is("Page size")') }).locator('select').selectOption('A4');
  const pdf = await exp('pdf');
  const pdfBuf = fs.readFileSync(pdf);
  assert(pdfBuf.slice(0, 5).toString() === '%PDF-', 'PDF file signature');
  try {
    const info = execFileSync('pdfinfo', [pdf], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    assert(/Page size:\s+841\.89 x 595\.27/.test(info), 'PDF page is A4 landscape (841.89 × 595.28 pt)');
    const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    assert(text.includes('Time (ms)') && text.includes('Vgrid') && text.includes('IL (A)'), 'PDF text: axis title and math-markup names (' + JSON.stringify(text.match(/V\s*grid|I\s*L \(A\)|Time \(ms\)/g)) + ')');
    const fonts = execFileSync('pdffonts', [pdf], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    assert(/Inter\s+CID TrueType\s+Identity-H\s+yes/.test(fonts), 'PDF embeds the Inter font (subset)');
    execFileSync('pdftoppm', ['-png', '-r', '60', '-singlefile', pdf, path.join(out, 'm5-pdf-render')], { stdio: 'ignore' });
  } catch (e) { assert(false, 'poppler checks: ' + e.message); }

  // PNG transparent
  await p.keyboard.press('Control+Shift+s');
  await p.click('.export-dialog .fmt button:has-text("PNG")');
  await p.locator('.export-dialog label:has-text("Transparent background") input').check();
  await p.screenshot({ path: path.join(out, 'm5-export-transparent.png') });
  const [d2] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
  const tp = path.join(out, 'transparent.png'); await d2.saveAs(tp);
  const alpha = await p.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return [g.getImageData(2, 2, 1, 1).data[3], g.getImageData(img.width / 2, img.height / 2, 1, 1).data[3]];
  }, fs.readFileSync(tp).toString('base64'));
  assert(alpha[0] === 0, 'transparent PNG: corner pixel alpha = 0');
  console.log('outputs in', out);
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
