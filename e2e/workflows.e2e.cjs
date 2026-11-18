// End-to-end user workflows (start to finish), not single features.
// Run `npm run build && npx vite preview` first.   node e2e/workflows.e2e.cjs [outDir] [w1,w2,w3,w5,w7]
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-wf-'));
  const only = (process.argv[3] || 'w1,w2,w3,w5,w7').split(',');
  const url = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dlgMsgs = []; p.on('dialog', (d) => { dlgMsgs.push(d.message()); d.accept(); });
  for (let i = 0; i < 20; i++) { try { await p.goto(url); break; } catch { await p.waitForTimeout(300); } }
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.toolbox');

  const field = (label) => p.locator('.properties .field', { has: p.locator('label', { hasText: new RegExp('^' + esc(label) + '$') }) }).locator('input, select').first();
  const setField = async (label, v) => { const f = field(label); await f.click(); await f.fill(v); await f.press('Enter'); };
  const dfield = (dlg, label) => p.locator(`${dlg} .field`, { has: p.locator('label', { hasText: new RegExp('^' + esc(label) + '$') }) }).locator('input, select').first();
  const setD = async (dlg, label, v) => { const f = dfield(dlg, label); await f.click(); await f.fill(v); await f.press('Enter'); };
  const tool = (n) => p.locator('.tool', { hasText: new RegExp('^' + esc(n)) }).first();
  const fresh = async () => { await p.click('button[aria-label="New project"]'); };
  const rows = () => p.locator('.signal-list .row:not(.other) .name').allInnerTexts();
  const selectRow = async (name) => { await p.locator('.signal-list .row', { hasText: name }).first().click(); };
  const stat = async (name) => (await p.locator('.measure .m-grid dt', { hasText: new RegExp('^' + name + '$') }).first().locator('xpath=following-sibling::dd[1]').innerText()).replace(/\s+/g, ' ');
  const svgText = () => p.locator('.plot-svg text').evaluateAll((els) => els.map((e) => e.textContent));
  const exportSvg = async (name) => {
    await p.keyboard.press('Control+Shift+s');
    await p.click('.export-dialog .fmt button:has-text("SVG")');
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('.export-dialog button.primary')]);
    const f = path.join(out, name); await d.saveAs(f);
    return fs.readFileSync(f, 'utf8');
  };
  const save = async (name) => { const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]); const f = path.join(out, name); await dl.saveAs(f); return f; };
  const open = async (f) => { const [c] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]); await c.setFiles(f); await p.waitForTimeout(400); };
  /** No text element overlaps another one in the figure (bounding boxes). */
  const overlaps = () => p.evaluate(() => {
    const els = [...document.querySelectorAll('.plot-svg text')].filter((e) => e.textContent.trim() && e.getBoundingClientRect().width > 0);
    const r = els.map((e) => [e.getBoundingClientRect(), e.textContent]);
    const bad = [];
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i][0], c = r[j][0];
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 2 && h > 2) bad.push(`${r[i][1]} / ${r[j][1]}`);
    }
    return bad;
  });
  const t0 = Date.now();
  const timed = async (label, fn, limitMs) => { const s = Date.now(); const v = await fn(); const d = Date.now() - s; assert(d < limitMs, `${label} took ${d} ms (< ${limitMs})`); return v; };

  // ---------------------------------------------------------------------------------------------
  if (only.includes('w1')) {
    console.log('--- W1: student, half-bridge PWM with an RL load, report, save, reopen');
    await fresh();
    await tool('PWM generator').click();
    const D = '.pwm-dialog';
    await dfield(D, 'Topology').selectOption('half');
    await setD(D, 'Modulation index m', '0.8');
    await setD(D, 'Carrier fc', '5k');
    await p.click(`${D} button.primary`);
    const names = await rows();
    assert(names.length >= 3, 'PWM created signals: ' + names.join(', '));
    const vo = names.includes('vout') ? 'vout' : names[names.length - 1];
    await selectRow(vo);
    await p.waitForTimeout(700);
    const mean = await stat('Mean'); const rms = await stat('RMS');
    console.log('   v_out mean', mean, 'rms', rms);
    // load current through an RL low-pass
    await tool('RLC low-pass').click().catch(() => {});
    const exprIn = p.locator('.expr-input');
    if (await exprIn.count()) console.log('   expression:', await exprIn.inputValue());
    await p.waitForTimeout(500);
    assert(await p.locator('.plot-svg').count() === 1, 'figure still shown after adding the filter');
    // spectrum of the PWM output
    await selectRow(vo);
    await p.click('button[aria-label^="Spectrum"]');
    await p.waitForSelector('.spectrum-summary');
    const sum = (await p.locator('.spectrum-summary').innerText()).replace(/\s+/g, ' ');
    console.log('   spectrum:', sum.slice(0, 120));
    assert(/Fundamental/.test(sum), 'the spectrum reports a fundamental');
    await p.click('.spectrum-dialog button:has-text("Done")');
    // annotate, rename project, export, save, reopen
    await p.locator('.name-btn').click(); await p.keyboard.press('Control+a'); await p.keyboard.type('Buck report'); await p.keyboard.press('Enter');
    const svg1 = await exportSvg('w1.svg');
    assert(svg1.includes('<svg') && svg1.length > 2000, 'figure exported (' + svg1.length + ' bytes)');
    const f = await save('w1.wlab');
    const before = await rows();
    await fresh();
    await open(f);
    assert(JSON.stringify(await rows()) === JSON.stringify(before), 'reopened project lists the same signals');
    const svg2 = await exportSvg('w1b.svg');
    assert(svg1 === svg2, 'the reopened figure exports identically');
    assert((await overlaps()).length === 0, 'no overlapping text in the PWM figure: ' + (await overlaps()).join('; '));
  }

  // ---------------------------------------------------------------------------------------------
  if (only.includes('w2')) {
    console.log('--- W2: lab report from a scope CSV (semicolon, decimal comma, header with units)');
    await fresh();
    const tau = 2e-3, v0 = 5;
    const lines = ['# exported by scope', 'Time [us];Channel A [V];Channel B [mV]'];
    for (let i = 0; i < 1500; i++) {
      const t = i * 4; // us
      const y = i < 250 ? 0 : v0 * (1 - Math.exp(-(t - 1000) / 1e6 / tau)); // RC step at 1 ms
      lines.push(`${t};${y.toFixed(5).replace('.', ',')};${(Math.sin(i / 20) * 100).toFixed(2).replace('.', ',')}`);
    }
    const csv = path.join(out, 'scope_semicolon.csv'); fs.writeFileSync(csv, lines.join('\n') + '\n');
    const [c] = await Promise.all([p.waitForEvent('filechooser'), p.click('.tool:has-text("Import CSV data")')]);
    await c.setFiles(csv); await p.waitForSelector('.modal');
    const sel0 = await p.locator('.modal select').first().inputValue();
    const unit = await p.locator('.modal select').nth(1).inputValue();
    assert(sel0 === '0', 'time column found (' + sel0 + ')');
    assert(unit === 'us' || unit === 'µs' || unit === 'u', 'time unit read from "[us]": ' + unit);
    await p.click('.modal footer button.primary');
    const names = await rows();
    assert(names.length === 2, 'two channels imported: ' + names.join(', '));
    await selectRow(names[0]);
    await p.waitForTimeout(700);
    const edges = (await p.locator('.measure .edges').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log('   edges:', edges.slice(0, 160));
    assert(/Rise/.test(edges), 'rise time shown for the RC step');
    const mm = /Rise[^\d]*([\d.,]+)\s*([mµun]?s)/.exec(edges);
    if (mm) {
      const k = { s: 1, ms: 1e-3, 'µs': 1e-6, us: 1e-6, ns: 1e-9 }[mm[2]];
      const rise = Number(mm[1].replace(',', '.')) * k;
      const frac = 1 - Math.exp(-(5.996e-3 - 1e-3) / tau); // the data stops before the final value
      const want = tau * Math.log((1 - 0.1 * frac) / (1 - 0.9 * frac));
      assert(Math.abs(rise - want) < 0.06 * want, `rise time ${rise} vs closed form for the recorded span ${want}`);
    }
    // overlay the theoretical response
    await tool('Low-pass filter').click().catch(() => {});
    await p.waitForTimeout(400);
    const svg = await exportSvg('w2.svg');
    assert(svg.length > 2000, 'exported');
    assert((await overlaps()).length === 0, 'no overlaps: ' + (await overlaps()).join('; '));
  }

  // ---------------------------------------------------------------------------------------------
  if (only.includes('w3')) {
    console.log('--- W3: digital designer, UART + SPI timing diagram at several zooms');
    await fresh();
    const D = '.protocol-dialog';
    await tool('UART / SPI / I²C').click();
    await p.click(`${D} .seg button:has-text("UART")`);
    await dfield(D, 'Data').fill('Hello!');
    await p.click(`${D} button.primary`);
    let t = await svgText();
    assert(t.includes("0x48 'H'") && t.includes("0x21 '!'"), 'UART text decoded');
    assert((await overlaps()).length === 0, 'UART default zoom: no overlaps: ' + (await overlaps()).join('; '));
    // change the data of the existing frame, then zoom
    for (const z of [1, 2, 3]) {
      await p.locator('.plot-svg').hover();
      await p.mouse.wheel(0, -400);
      await p.waitForTimeout(250);
      const o = await overlaps();
      assert(o.length === 0, `UART after zoom step ${z}: no overlaps ${o.join('; ')}`);
    }
    await fresh();
    await tool('UART / SPI / I²C').click();
    await p.click(`${D} .seg button:has-text("SPI")`);
    await dfield(D, 'Format').selectOption('hex');
    await dfield(D, 'Data').fill('A5 3C 00 FF 12');
    await p.click(`${D} button.primary`);
    const o = await overlaps();
    assert(o.length === 0, 'SPI 5 bytes: no overlaps ' + o.join('; '));
    await p.setViewportSize({ width: 800, height: 700 }); await p.waitForTimeout(300);
    const o2 = await overlaps();
    assert(o2.length === 0, 'SPI at 800 px: no overlaps ' + o2.join('; '));
    await p.setViewportSize({ width: 1400, height: 900 });
    const svg = await exportSvg('w3.svg');
    assert(svg.includes('0xA5'), 'timing diagram exported with labels');
  }

  // ---------------------------------------------------------------------------------------------
  if (only.includes('w5')) {
    console.log('--- W5: a long session (≈ 300 random edits + undo/redo), time and memory per step');
    await fresh();
    const kinds = ['Sine', 'Square', 'Triangle', 'Pulse train', 'Sawtooth'];
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const heap0 = await p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
    const slow = [];
    for (let i = 0; i < 300; i++) {
      const a = Math.floor(rnd() * 8);
      const s = Date.now();
      try {
        if (a === 0 && (await p.locator('.signal-list .row').count()) < 12) await tool(kinds[Math.floor(rnd() * kinds.length)]).click();
        else if (a === 1) { const n = await p.locator('.signal-list .row:not(.other)').count(); if (n) await p.locator('.signal-list .row:not(.other)').nth(Math.floor(rnd() * n)).click(); }
        else if (a === 2) await p.keyboard.press('Control+z');
        else if (a === 3) await p.keyboard.press('Control+Shift+z');
        else if (a === 4) { await p.locator('.plot-svg').hover(); await p.mouse.wheel(0, (rnd() - 0.5) * 800); }
        else if (a === 5) { const f = field('Frequency'); if (await f.count()) { await f.click(); await f.fill(String(Math.round(10 + rnd() * 5000))); await f.press('Enter'); } }
        else if (a === 6) await p.click(rnd() < 0.5 ? '.seg button:has-text("Stacked")' : '.seg button:has-text("Overlay")');
        else if (a === 7 && (await p.locator('.signal-list .row:not(.other)').count()) > 3) { await p.keyboard.press('Delete'); }
      } catch (e) { /* element vanished: fine */ }
      const d = Date.now() - s;
      if (d > 2500) slow.push(`step ${i} action ${a}: ${d} ms`);
    }
    const heap1 = await p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
    console.log('   heap MB:', (heap0 / 1e6).toFixed(0), '→', (heap1 / 1e6).toFixed(0), ' elapsed s:', ((Date.now() - t0) / 1000).toFixed(0));
    assert(slow.length === 0, 'no step slower than 2.5 s: ' + slow.join('; '));
    assert(heap1 === 0 || heap1 < 400e6, 'memory stays reasonable');
    assert((await p.locator('.plot-svg').count()) === 1, 'the figure is still alive');
  }

  // ---------------------------------------------------------------------------------------------
  if (only.includes('w7')) {
    console.log('--- W7: recovery: delete, undo, reload with unsaved work, corrupted files, bad share link');
    await fresh();
    await tool('Sine').click(); await tool('Square').click();
    await p.locator('.signal-list .row').first().click();
    await p.keyboard.press('Delete');
    assert((await rows()).length === 1, 'delete removes one signal');
    await p.keyboard.press('Control+z');
    assert((await rows()).length === 2, 'undo brings it back');
    // unsaved work and a reload: is the user warned?
    let warned = false;
    p.once('beforeunload', () => {});
    const hadDirty = await p.locator('.dirty').count();
    console.log('   dirty marker shown for unsaved work:', hadDirty);
    assert(hadDirty === 1, 'unsaved marker is shown');
    const guard = await p.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
    console.log('   beforeunload guard active:', guard);
    assert(guard, 'closing the tab with unsaved work asks for confirmation');
    // corrupted files
    const bad = [['empty.wlab', ''], ['junk.wlab', 'not json at all'], ['trunc.wlab', '{"format":"wavelab-project","project":{"signals":['], ['wrong.wlab', '{"format":"other"}'], ['nul.wlab', '\u0000\u0000\u0000']];
    for (const [n, c] of bad) {
      const f = path.join(out, n); fs.writeFileSync(f, c);
      const before = await rows(); dlgMsgs.length = 0; const nBefore = await p.locator('[role=alert]').count();
      await open(f);
      await p.waitForTimeout(300);
      const shown = (dlgMsgs.join(' ') + ' ' + (await p.locator('.modal, [role=alert]').allInnerTexts()).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 110);
      assert(shown.length > 0, n + ': the user is told what went wrong');
      assert(JSON.stringify(await rows()) === JSON.stringify(before), `${n}: the current project is untouched. Message: "${shown}"`);
      await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
    }
    // a good file saved earlier opens after corrupted ones
    const good = await save('w7.wlab');
    await fresh(); await open(good);
    assert((await rows()).length === 2, 'a good file still opens after the bad ones');
    // damaged share link
    await p.goto(url + '#share=dAAAA_broken'); await p.waitForTimeout(600);
    assert((await p.locator('.toolbox').count()) === 1, 'a damaged share link leaves the app usable');
    await p.goto(url);
  }

  assert(errs.length === 0, 'no page errors: ' + errs.join('; '));
  await b.close();
})().catch((e) => { console.log('FAIL: exception', e.message); process.exit(1); });
