// Broad usage / stress suite: drives the app the way a user would, through every tool, dialog,
// option combination, view manipulation, layout and a random-action ("monkey") run, and collects
// FINDINGS instead of stopping at the first failure. Run `npm run build && npx vite preview` first.
//
//   node e2e/stress.e2e.cjs [outDir] [area,area,…]     areas: tools waveforms dialogs views export layouts monkey keyboard touch big
//
// Each step is followed by a scan: page errors, console errors, a responsiveness probe (freeze
// detection), overlapping text in the plot, "NaN"/"undefined"/"Infinity" in the interface, and
// horizontal page overflow. The exit code is 1 when there are findings.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL = process.env.WAVELAB_URL || 'http://localhost:4173/WaveLab/';
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'wavelab-stress-'));
const only = (process.argv[3] || '').split(',').filter(Boolean);
const want = (a) => only.length === 0 || only.includes(a);
fs.mkdirSync(out, { recursive: true });

let shots = 0;
const findings = [];
const seen = new Set();
let area = '';
let stepName = '';
function note(kind, msg) {
  const key = `${kind}|${msg}`.slice(0, 300);
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ area, step: stepName, kind, msg: String(msg).slice(0, 600) });
  console.log(`FINDING [${kind}] (${area} / ${stepName}) ${String(msg).slice(0, 300)}`);
}

let browser, ctx, p;
const pageErrors = [];
async function openPage(viewport = { width: 1400, height: 900 }) {
  if (ctx) await ctx.close().catch(() => {});
  ctx = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  p.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await p.goto(URL);
  await p.waitForSelector('.toolbar');
}

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label} ${ms}ms`)), ms))]);

/** True if the page answers (animation frame + evaluate) within 8 s; a stuck page is replaced. */
async function responsive() {
  try {
    await withTimeout(p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(1)))), 8000, 'responsive');
    return true;
  } catch {
    note('FREEZE', 'the page stopped responding for more than 8 s');
    const vp = p.viewportSize();
    await openPage(vp || undefined).catch(() => {});
    return false;
  }
}

async function scan(tag = '') {
  if (!(await responsive())) return;
  while (pageErrors.length) note('ERROR', pageErrors.shift());
  let r;
  try {
    r = await withTimeout(p.evaluate(() => {
      const res = { overlaps: [], bad: [], overflow: null };
      // overlapping text in any plot
      for (const svg of document.querySelectorAll('.plot-svg')) {
        const ts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim());
        const bb = ts.map((t) => ({ r: t.getBoundingClientRect(), s: t.textContent.trim() }));
        for (let i = 0; i < bb.length; i++) for (let j = i + 1; j < bb.length; j++) {
          const a = bb[i].r, b = bb[j].r;
          if (a.width && b.width && a.left < b.right - 1.5 && b.left < a.right - 1.5 && a.top < b.bottom - 1.5 && b.top < a.bottom - 1.5) res.overlaps.push(`${bb[i].s} / ${bb[j].s}`);
        }
      }
      // suspicious values in the interface
      const txt = document.body.innerText;
      for (const m of txt.matchAll(/\b(NaN|undefined|Infinity|\[object Object\])\b/g)) res.bad.push(m[0]);
      for (const i of document.querySelectorAll('input')) if (/NaN|undefined|Infinity/.test(i.value)) res.bad.push('input value ' + i.value);
      const de = document.documentElement;
      if (de.scrollWidth > innerWidth + 2) res.overflow = `${de.scrollWidth} > ${innerWidth}`;
      return res;
    }), 8000, 'scan');
  } catch (e) {
    note('SCAN', e.message);
    return;
  }
  if (r.overlaps.length && shots < 12) { shots++; await p.screenshot({ path: path.join(out, `overlap-${shots}.png`) }).catch(() => {}); }
  if (r.overlaps.length) note('OVERLAP', `text overlap${tag}: ${[...new Set(r.overlaps)].slice(0, 6).join('; ')}`);
  if (r.bad.length) note('BAD-VALUE', `${tag} ${[...new Set(r.bad)].join(', ')} shown in the interface`);
  if (r.overflow) note('OVERFLOW', `horizontal page overflow ${r.overflow}${tag}`);
}

async function step(name, fn) {
  stepName = name;
  const t0 = Date.now();
  try {
    await withTimeout(fn(), 40000, name);
  } catch (e) {
    note('STEP-FAILED', e.message.split('\n')[0]);
  }
  const dt = Date.now() - t0;
  if (dt > 12000) note('SLOW', `${dt} ms`);
  await scan();
}

async function newProject() {
  await p.keyboard.press('Escape').catch(() => {});
  if (await p.locator('.modal-backdrop').count()) await p.keyboard.press('Escape').catch(() => {});
  if (await p.locator('.recovery-banner').count()) await p.click('.recovery-banner button:has-text("Discard")').catch(() => {});
  if (await p.locator('.phone-tabs').count()) { await p.click('button[aria-label="More actions"]').catch(() => {}); await p.click('.popover.menu button:has-text("New project")').catch(() => {}); }
  else await p.click('button[title="New project"]').catch(() => {});
  await p.waitForTimeout(80);
}
const tools = () => p.locator('.tool');
/** In the phone layout the toolbox lives in the "Add" tab, and selecting a signal switches away from it. */
async function addTab() { if (await p.locator('.phone-tabs').count()) await p.click('.phone-tabs button:has-text("Add")').catch(() => {}); }
async function closeModals() {
  for (let i = 0; i < 3 && (await p.locator('.modal-backdrop').count()); i++) {
    const prim = p.locator('.modal footer button.primary');
    if (await prim.count() && (await prim.first().isEnabled().catch(() => false))) await prim.first().click().catch(() => {});
    else await p.keyboard.press('Escape');
    await p.waitForTimeout(60);
  }
}
const labelInput = (scope, text) => p.locator(`${scope} .field`, { has: p.locator('label', { hasText: text }) }).locator('input, select').first();

// ---------------------------------------------------------------------------------------------
async function areaTools() {
  // every toolbox entry, with two signals present and the first selected
  await openPage();
  const n = await tools().count();
  console.log(`toolbox entries: ${n}`);
  for (let i = 0; i < n; i++) {
    const label = (await tools().nth(i).innerText().catch(() => `#${i}`)).trim().split('\n')[0];
    await step(`tool ${i}: ${label}`, async () => {
      await newProject();
      await p.click('.tool:has-text("Sine")');
      await p.click('.tool:has-text("Square")');
      await p.locator('.signal-list .row').first().click();
      await tools().nth(i).click();
      await p.waitForTimeout(150);
      await closeModals();
      await p.waitForTimeout(150);
    });
  }
}

const FUZZ = ['0', '-1', '1e9', '1e-12', '1e400', 'abc', '', '0.5k', '1u', '-0', '1e15', '3.14159265358979', '1/0'];
async function areaWaveforms() {
  await openPage();
  const waveforms = ['Sine', 'Cosine', 'Square', 'Pulse train', 'Triangle', 'Sawtooth', 'Inverted sawtooth', 'DC', 'Exponential rise', 'Exponential decay', 'Damped sinusoid', 'Custom piecewise', 'Chirp (linear)', 'Chirp (log)', 'Noise', 'Clock', 'Single pulse', 'NRZ', 'RZ', 'Manchester', 'Bit sequence', 'PRBS'];
  for (const w of waveforms) {
    await step(`waveform ${w}: defaults`, async () => {
      await newProject();
      await p.click(`.tool:has-text("${w}")`, { timeout: 4000 });
      await p.waitForTimeout(120);
    });
    const fields = await p.locator('.properties .field input:not([type=checkbox]):not([type=color]):not([type=range])').count().catch(() => 0);
    for (let k = 0; k < fields; k++) {
      for (const v of FUZZ) {
        await step(`waveform ${w}: field ${k} = "${v}"`, async () => {
          const f = p.locator('.properties .field input:not([type=checkbox]):not([type=color]):not([type=range])').nth(k);
          if (!(await f.isVisible().catch(() => false)) || (await f.isDisabled().catch(() => true))) return;
          await f.click(); await f.fill(v); await f.press('Enter');
          await p.keyboard.press('Escape');
        });
      }
    }
    // after the fuzz, undo everything and redo: must stay consistent
    await step(`waveform ${w}: undo ×30 / redo ×30`, async () => {
      await p.locator('.plot-host').click({ position: { x: 5, y: 5 } }).catch(() => {});
      for (let i = 0; i < 30; i++) await p.keyboard.press('Control+z');
      for (let i = 0; i < 30; i++) await p.keyboard.press('Control+y');
    });
  }
}

// ---------------------------------------------------------------------------------------------
async function runDialog(tool, dlg, configure, label) {
  await step(label, async () => {
    await newProject();
    await p.click(`.tool:has-text("${tool}")`);
    await p.waitForSelector(dlg);
    await configure();
    const prim = p.locator(`${dlg} footer button.primary`);
    if (await prim.isEnabled()) await prim.click();
    else await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  });
}
async function selectOptions(dlg, idx) {
  return p.locator(`${dlg} select`).nth(idx).evaluate((s) => [...s.options].map((o) => o.value)).catch(() => []);
}
async function areaDialogs() {
  await openPage();
  // PWM: topology × (reference for 3-phase) × carrier, with load and dead time
  const dlg = '.pwm-dialog';
  await step('open PWM to list options', async () => { await p.click('.tool:has-text("PWM generator")'); await p.waitForSelector(dlg); });
  const topologies = await selectOptions(dlg, 0);
  await closeModals();
  for (const topo of topologies) {
    const refs = topo === 'three-phase' ? ['sine', 'third', 'svpwm', 'dpwm'] : ['sine'];
    for (const ref of refs) for (const carrier of ['triangle', 'saw-up', 'saw-down']) for (const extra of ['plain', 'load+dead']) {
      await runDialog('PWM generator', dlg, async () => {
        await p.locator(`${dlg} select`).nth(0).selectOption(topo);
        if (topo === 'three-phase') await p.locator(`${dlg} select`).nth(1).selectOption(ref);
        await p.locator(`${dlg} select`).nth(topo === 'three-phase' ? 2 : 1).selectOption(carrier);
        if (extra === 'load+dead') {
          await p.locator(`${dlg} input[type=checkbox]`).nth(1).check().catch(() => {});
          const dt = labelInput(dlg, 'Dead time'); await dt.click(); await dt.fill('2u'); await dt.press('Enter');
          await p.locator(`${dlg} input[type=checkbox]`).nth(2).check().catch(() => {});
        }
      }, `PWM ${topo}/${ref}/${carrier}/${extra}`);
    }
  }
  // PWM odd parameters
  for (const [fc, f1, m] of [['14', '170.37', '0.8'], ['50', '50', '1'], ['100k', '0', '0.5'], ['1.05k', '1', '2'], ['1k', '60', '0']]) {
    await runDialog('PWM generator', dlg, async () => {
      for (const [l, v] of [['Carrier f', fc], ['Reference f', f1], ['Modulation index', m]]) { const f = labelInput(dlg, l); await f.click(); await f.fill(v); await f.press('Enter'); }
    }, `PWM fc=${fc} f1=${f1} m=${m}`);
  }

  // Rectifier
  await step('open rectifier to list options', async () => { await p.click('.tool:has-text("Rectifier")'); await p.waitForSelector('.rectifier-dialog'); });
  const rtops = await selectOptions('.rectifier-dialog', 0);
  await closeModals();
  for (const t of rtops) for (const load of [false, true]) {
    await runDialog('Rectifier', '.rectifier-dialog', async () => {
      await p.locator('.rectifier-dialog select').nth(0).selectOption(t);
      if (load) await p.locator('.rectifier-dialog input[type=checkbox]').first().check().catch(() => {});
    }, `rectifier ${t} load=${load}`);
  }

  // Modulation
  await step('open modulation to list options', async () => { await p.click('.tool:has-text("AM / FM / PM")'); await p.waitForSelector('.modal'); });
  const kinds = await selectOptions('.modal', 0);
  const msgs = await selectOptions('.modal', 1);
  await closeModals();
  for (const k of kinds) for (const m of msgs) {
    await runDialog('AM / FM / PM', '.modal', async () => {
      await p.locator('.modal select').nth(0).selectOption(k);
      await p.locator('.modal select').nth(1).selectOption(m);
    }, `modulation ${k}/${m}`);
  }
  for (const [fc, fm] of [['1k', '1k'], ['100', '10k'], ['1M', '1']]) {
    await runDialog('AM / FM / PM', '.modal', async () => {
      for (const [l, v] of [['Carrier f', fc], ['Message f', fm]]) { const f = labelInput('.modal', l); await f.click(); await f.fill(v); await f.press('Enter'); }
    }, `modulation fc=${fc} fm=${fm}`);
  }

  // Protocols
  for (const proto of ['UART', 'SPI', 'I²C']) for (const data of ['Hi', 'Hello World, this is a long message!', 'é€\u0001', '']) {
    await runDialog('UART / SPI', '.protocol-dialog', async () => {
      await p.locator(`.protocol-dialog .seg button:has-text("${proto}")`).click();
      const f = p.locator('.protocol-dialog .field:has(label:text-is("Data")) input'); await f.fill(data);
    }, `protocol ${proto} data="${data.slice(0, 12)}"`);
  }
  for (const [parity, bits, stop, clk] of [['even', '7', '2', true], ['odd', '5', '1', false], ['none', '8', '1', true]]) {
    await runDialog('UART / SPI', '.protocol-dialog', async () => {
      await p.locator('.protocol-dialog .seg button:has-text("UART")').click(); // the dialog remembers its last protocol
      await p.locator('.protocol-dialog select[aria-label="Parity"]').selectOption(parity);
      await p.locator('.protocol-dialog select[aria-label="Data bits"]').selectOption(bits);
      await p.locator('.protocol-dialog select[aria-label="Stop bits"]').selectOption(stop);
      if (clk) await p.locator('.protocol-dialog .check:has-text("bit clock") input').check();
    }, `UART ${parity}/${bits}/${stop}/clock=${clk}`);
  }
  for (const mode of ['0', '1', '2', '3']) {
    await runDialog('UART / SPI', '.protocol-dialog', async () => {
      await p.locator('.protocol-dialog .seg button:has-text("SPI")').click();
      await p.locator('.protocol-dialog select').first().selectOption(mode).catch(() => {});
      await p.locator('.protocol-dialog .field:has(label:text-is("MISO data")) input').fill('A5 5A');
    }, `SPI mode ${mode} with MISO`);
  }
}

// ---------------------------------------------------------------------------------------------
async function buildComplexProject() {
  await newProject();
  await addTab();
  await p.click('.tool:has-text("PWM generator")');
  await p.waitForSelector('.pwm-dialog');
  await p.locator('.pwm-dialog footer button.primary').click();
  await p.waitForTimeout(500);
  // lowpass on the selected output
  await addTab();
  await p.click('.tool:has-text("Low-pass (RC)")').catch(() => {});
  await p.waitForTimeout(300);
  await addTab();
  await p.click('.tool:has-text("Sine")');
}
async function areaViews() {
  await openPage();
  await step('build PWM + lowpass project', buildComplexProject);
  const host = () => p.locator('.plot-host').first();
  const box = async () => host().boundingBox();
  await step('wheel zoom in ×40', async () => { const b = await box(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 40; i++) await p.mouse.wheel(0, -300); await p.waitForTimeout(300); });
  await step('wheel zoom out ×80', async () => { const b = await box(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 80; i++) await p.mouse.wheel(0, 300); await p.waitForTimeout(300); });
  await step('pan drag', async () => { const b = await box(); await p.mouse.move(b.x + 300, b.y + 200); await p.mouse.down(); await p.mouse.move(b.x + 100, b.y + 220, { steps: 10 }); await p.mouse.up(); });
  await step('double-click fit', async () => { const b = await box(); await p.mouse.dblclick(b.x + 400, b.y + 300); await p.waitForTimeout(300); });
  await step('shift box zoom', async () => { const b = await box(); await p.keyboard.down('Shift'); await p.mouse.move(b.x + 200, b.y + 100); await p.mouse.down(); await p.mouse.move(b.x + 350, b.y + 250, { steps: 6 }); await p.mouse.up(); await p.keyboard.up('Shift'); });
  for (const [lo, hi] of [['0', '1e-9'], ['0', '1e6'], ['-1e6', '1e6'], ['1', '1'], ['5', '2'], ['0', '1e-15']]) {
    await step(`axes time range ${lo} … ${hi}`, async () => {
      await p.click('.range-btn');
      await p.waitForSelector('.modal');
      const fs = p.locator('.modal .field input');
      const f0 = labelInput('.modal', /^(From|Start|Min)/); const f1 = labelInput('.modal', /^(To|End|Max)/);
      await f0.click(); await f0.fill(lo); await f0.press('Enter'); await f1.click(); await f1.fill(hi); await f1.press('Enter');
      void fs;
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    });
  }
  await step('fit all', async () => { await p.click('button[aria-label="Fit all signals (double-click plot)"], button[title^="Fit all"]').catch(() => {}); await p.waitForTimeout(300); });
  await step('stacked / overlay toggles', async () => { for (let i = 0; i < 4; i++) { await p.click('.seg button:has-text("Stacked")'); await p.click('.seg button:has-text("Overlay")'); } });
  await step('time cursors + level cursors', async () => { await p.click('.measure button:has-text("Time cursors")'); await p.click('.measure button:has-text("Level cursors")'); await p.waitForTimeout(300); });
  await step('legend / panels toggles', async () => { for (const t of ['Legend', 'Toolbox', 'Properties', 'Measure']) { await p.click(`.toolbar button:has-text("${t}")`); await p.click(`.toolbar button:has-text("${t}")`); } });
  for (const sel of ['Spectrum…', 'XY…', 'Eye…']) {
    await step(`measure ▸ ${sel}`, async () => { await p.click(`.measure button:has-text("${sel}")`); await p.waitForSelector('.modal'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); });
  }
  await step('spectrum on every signal', async () => {
    const n = await p.locator('.signal-list .row').count();
    for (let i = 0; i < Math.min(n, 12); i++) { await p.locator('.signal-list .row').nth(i).click(); await p.click('.measure button:has-text("Spectrum…")'); await p.waitForSelector('.modal'); await p.waitForTimeout(500); await scan(` spectrum of signal ${i}`); await p.keyboard.press('Escape'); }
  });
  await step('figures: add / duplicate / grid / delete', async () => {
    await p.click('.figure-tabs button[aria-label="New figure"]'); await p.click('.figure-tabs button[aria-label="Duplicate figure"]');
    const grid = p.locator('.grid-controls button, .figure-tabs button:has-text("Grid")').first(); if (await grid.count()) await grid.click().catch(() => {});
    await p.waitForTimeout(500);
    for (let i = 0; i < 2; i++) { await p.locator('.figure-tabs button[aria-label="Delete figure"]').last().click().catch(() => {}); }
  });
  await step('delete every signal one by one (with dependents)', async () => {
    for (let i = 0; i < 60 && (await p.locator('.signal-list .row').count()); i++) {
      await p.locator('.signal-list .row').last().click(); await p.keyboard.press('Delete');
      if (await p.locator('.alert-dialog').count()) { await p.click('.alert-dialog button.primary'); await p.locator('.signal-list .row').first().click(); await p.keyboard.press('Delete'); if (await p.locator('.alert-dialog').count()) await p.click('.alert-dialog button.primary'); }
    }
  });
  await step('undo everything', async () => { await p.locator('.plot-host').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); for (let i = 0; i < 80; i++) await p.keyboard.press('Control+z'); await p.waitForTimeout(500); });
}

// ---------------------------------------------------------------------------------------------
async function areaExport() {
  await openPage();
  await step('build project', buildComplexProject);
  await step('open export dialog', async () => { await p.click('button[aria-label^="Export PNG"]'); await p.waitForSelector('.modal'); });
  const sel = await p.locator('.modal select').first().evaluate((s) => [...s.options].map((o) => o.value)).catch(() => []);
  console.log('export formats/options:', sel.join(','));
  await closeModals();
  for (const fmt of sel) {
    await step(`export format ${fmt}`, async () => {
      await p.click('button[aria-label^="Export PNG"]'); await p.waitForSelector('.modal');
      await p.locator('.modal select').first().selectOption(fmt);
      const dl = p.waitForEvent('download', { timeout: 15000 });
      await p.locator('.modal footer button.primary').click();
      const d = await dl; const f = path.join(out, `export-${fmt}-${d.suggestedFilename()}`); await d.saveAs(f);
      const size = fs.statSync(f).size; if (size < 200) note('EXPORT', `${fmt} export is only ${size} bytes`);
      await closeModals();
    });
  }
  await step('save project file, new project, reopen it', async () => {
    const dl = p.waitForEvent('download', { timeout: 15000 });
    await p.click('button[aria-label="Save as…"]');
    const d = await dl; const f = path.join(out, 'saved.wlab'); await d.saveAs(f);
    const before = await p.locator('.signal-list .row').count();
    await newProject();
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
    await chooser.setFiles(f);
    await p.waitForTimeout(800);
    const after = await p.locator('.signal-list .row').count();
    if (after !== before) note('FILE', `reopened project has ${after} signals, saved had ${before}`);
  });
}

// ---------------------------------------------------------------------------------------------
async function areaLayouts() {
  const sizes = [[1920, 1080], [1400, 900], [1100, 700], [1024, 768], [820, 1180], [600, 900], [390, 844], [320, 568]];
  for (const [w, h] of sizes) {
    await openPage({ width: w, height: h });
    await step(`layout ${w}x${h}: build`, buildComplexProject);
    await step(`layout ${w}x${h}: protocol + modulation`, async () => {
      await addTab();
      await p.click('.tool:has-text("UART / SPI")'); await p.locator('.protocol-dialog .field:has(label:text-is("Data")) input').fill('Hello World');
      await p.locator('.protocol-dialog footer button.primary').click(); await p.waitForTimeout(500);
    });
    await step(`layout ${w}x${h}: screenshot + clipped elements`, async () => {
      await p.screenshot({ path: path.join(out, `layout-${w}x${h}.png`) });
      const bad = await p.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('button, input, select, label, h2, h3, .tool')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.right > innerWidth + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.textContent || el.value || '').trim().slice(0, 24)}" off-screen x=${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        return out.slice(0, 8);
      });
      if (bad.length) note('CLIPPED', `${w}x${h}: ${bad.join('; ')}`);
    });
    for (const dlg of ['PWM generator', 'Rectifier', 'AM / FM / PM']) {
      await step(`layout ${w}x${h}: dialog ${dlg} fits`, async () => {
        await addTab();
        await p.click(`.tool:has-text("${dlg}")`); await p.waitForSelector('.modal');
        const r = await p.evaluate(() => { const m = document.querySelector('.modal').getBoundingClientRect(); return { r: m.right, b: m.bottom, l: m.left, t: m.top, w: innerWidth, h: innerHeight }; });
        if (r.r > r.w + 1 || r.l < -1) note('DIALOG-CLIPPED', `${dlg} at ${w}x${h}: x ${Math.round(r.l)}..${Math.round(r.r)} of ${r.w}`);
        const foot = await p.evaluate(() => { const f = document.querySelector('.modal footer button.primary'); if (!f) return true; const r = f.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; });
        if (!foot) note('DIALOG-CLIPPED', `${dlg} at ${w}x${h}: the Create button is outside the viewport`);
        await p.keyboard.press('Escape');
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
async function areaMonkey() {
  let seed = Number(process.env.SEED || 20260101);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  await openPage();
  const log = [];
  const N = Number(process.env.MONKEY_STEPS || 400);
  for (let i = 0; i < N; i++) {
    const kind = pick(['tool', 'tool', 'tool', 'key', 'plot', 'plot', 'field', 'field', 'toolbar', 'row', 'tab', 'modal', 'wheel']);
    const desc = `monkey ${i}: ${kind}`;
    stepName = desc;
    try {
      await withTimeout((async () => {
        if (kind === 'tool') { const n = await tools().count(); const k = Math.floor(rnd() * n); log.push(`tool ${k}`); await tools().nth(k).click({ timeout: 2000 }); await p.waitForTimeout(40); }
        else if (kind === 'key') { const k = pick(['Control+z', 'Control+y', 'Control+d', 'Control+c', 'Control+v', 'Delete', 'Escape', 'Backspace']); log.push(`key ${k}`); await p.keyboard.press(k); }
        else if (kind === 'plot') { const b = await p.locator('.plot-host').first().boundingBox(); if (!b) return; const x = b.x + rnd() * b.width, y = b.y + rnd() * b.height; const act = pick(['click', 'right', 'drag', 'dbl']); log.push(`plot ${act}`); if (act === 'click') await p.mouse.click(x, y); else if (act === 'right') await p.mouse.click(x, y, { button: 'right' }); else if (act === 'dbl') await p.mouse.dblclick(x, y); else { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(b.x + rnd() * b.width, b.y + rnd() * b.height, { steps: 5 }); await p.mouse.up(); } }
        else if (kind === 'field') { const fs = p.locator('.properties .field input:not([type=checkbox]):not([type=color]):not([type=range])'); const n = await fs.count(); if (!n) return; const f = fs.nth(Math.floor(rnd() * n)); const v = pick(FUZZ); log.push(`field "${v}"`); if (await f.isEnabled()) { await f.click({ timeout: 1500 }); await f.fill(v); await f.press('Enter'); } }
        else if (kind === 'toolbar') { const bs = p.locator('.toolbar button'); const n = await bs.count(); const k = Math.floor(rnd() * n); const t = (await bs.nth(k).getAttribute('title').catch(() => '')) || ''; if (/^(Open|Save|New project)/.test(t)) return; log.push(`toolbar ${t}`); await bs.nth(k).click({ timeout: 1500 }); await p.waitForTimeout(40); }
        else if (kind === 'row') { const rs = p.locator('.signal-list .row'); const n = await rs.count(); if (!n) return; const r = rs.nth(Math.floor(rnd() * n)); const act = pick(['click', 'right']); log.push(`row ${act}`); await r.click({ button: act === 'right' ? 'right' : 'left', timeout: 1500 }); if (act === 'right') { const it = p.locator('.context-menu button'); const m = await it.count(); if (m) await it.nth(Math.floor(rnd() * m)).click({ timeout: 1500 }); } }
        else if (kind === 'tab') { const ts = p.locator('.figure-tabs .fig-name'); const n = await ts.count(); if (!n) return; log.push('figure tab'); await ts.nth(Math.floor(rnd() * n)).click({ timeout: 1500 }); }
        else if (kind === 'modal') { if (await p.locator('.modal-backdrop').count()) { log.push('modal confirm/close'); await closeModals(); } if (await p.locator('.alert-dialog').count()) await p.click('.alert-dialog button.primary'); if (await p.locator('.recovery-banner').count()) await p.click('.recovery-banner button:has-text("Discard")').catch(() => {}); }
        else if (kind === 'wheel') { const b = await p.locator('.plot-host').first().boundingBox(); if (!b) return; await p.mouse.move(b.x + rnd() * b.width, b.y + rnd() * b.height); log.push('wheel'); await p.mouse.wheel(0, pick([-800, -200, 200, 800])); }
      })(), 15000, desc);
    } catch (e) {
      const m = e.message.split('\n')[0];
      if (/TIMEOUT/.test(m)) note('MONKEY-STUCK', `${m}; last actions: ${log.slice(-6).join(' > ')}`);
      // ordinary locator timeouts (element absent/covered) are expected noise in a random run
    }
    if (i % 8 === 7) { await scan(` after ${log.slice(-4).join(' > ')}`); }
    // let the page leave any modal the monkey opened every now and then
    if (i % 25 === 24) await closeModals();
  }
  await scan(' end of monkey run');
  fs.writeFileSync(path.join(out, 'monkey-actions.txt'), log.join('\n'));
}

// ---------------------------------------------------------------------------------------------
async function areaKeyboard() {
  await openPage();
  await step('Tab through the whole page (focus must stay in the app and be visible)', async () => {
    await p.click('.tool:has-text("Sine")');
    await p.locator('body').press('Escape');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    const lost = [];
    const noRing = new Set();
    for (let i = 0; i < 140; i++) {
      await p.keyboard.press('Tab');
      const info = await p.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return { body: true };
        const cs = getComputedStyle(a);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
        const r = a.getBoundingClientRect();
        return { tag: a.tagName.toLowerCase(), cls: String(a.className).split(' ')[0], label: (a.getAttribute('aria-label') || a.title || a.textContent || '').trim().slice(0, 24), ring, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight };
      });
      if (info.body) lost.push(i);
      else {
        if (!info.visible) noRing.add(`${info.tag}.${info.cls} "${info.label}" focused but off-screen`);
        else if (!info.ring && info.tag !== 'input' && info.tag !== 'select') noRing.add(`${info.tag}.${info.cls} "${info.label}" has no visible focus indicator`);
      }
    }
    if (lost.length > 3) note('FOCUS-LOST', `focus fell back to the page body at Tab presses ${lost.slice(0, 8).join(', ')}`);
    if (noRing.size) note('NO-FOCUS-RING', [...noRing].slice(0, 6).join('; '));
  });

  for (const [tool, dlg] of [['PWM generator', '.pwm-dialog'], ['Rectifier', '.rectifier-dialog'], ['UART / SPI', '.protocol-dialog'], ['AM / FM / PM', '.modal']]) {
    await step(`dialog ${tool}: keyboard open, focus trap, Escape, focus return`, async () => {
      await newProject();
      await p.click('.tool:has-text("Sine")');
      const before = await p.locator('.signal-list .row').count();
      await p.locator(`.tool:has-text("${tool}")`).focus();
      await p.keyboard.press('Enter');
      await p.waitForSelector(dlg);
      let escaped = 0;
      for (let i = 0; i < 60; i++) {
        await p.keyboard.press('Tab');
        const inside = await p.evaluate((sel) => !!document.activeElement && !!document.activeElement.closest(sel), '.modal');
        if (!inside) escaped++;
      }
      if (escaped) note('FOCUS-TRAP', `${tool}: focus left the dialog ${escaped}× while pressing Tab`);
      // Shortcuts must not act on the project behind the dialog.
      await p.locator('.modal h2').click().catch(() => {});
      await p.keyboard.press('Delete');
      await p.keyboard.press('Control+d');
      await p.keyboard.press('Control+z');
      const during = await p.locator('.signal-list .row').count();
      if (during !== before) note('SHORTCUT-BEHIND-DIALOG', `${tool}: signals went from ${before} to ${during} while the dialog was open`);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      if (await p.locator('.modal-backdrop').count()) note('ESCAPE', `${tool}: Escape did not close the dialog`);
      const active = await p.evaluate(() => (document.activeElement === document.body ? 'body' : document.activeElement.tagName.toLowerCase()));
      if (active === 'body') note('FOCUS-RETURN', `${tool}: after closing, the focus is on the page body (keyboard users lose their place)`);
    });
  }

  await step('warning popup: keyboard works, shortcuts do not act behind it', async () => {
    await newProject();
    await p.click('.tool:has-text("Sine")');
    await p.click('.tool:has-text("Abs")'); // a derived signal that uses the sine
    await p.locator('.signal-list .row').first().click();
    await p.keyboard.press('Delete');
    if (!(await p.locator('.alert-dialog').count())) { note('ALERT', 'deleting a used signal did not open the warning'); return; }
    const n = await p.locator('.signal-list .row').count();
    await p.keyboard.press('Control+z'); await p.keyboard.press('Delete'); await p.keyboard.press('Control+d');
    if ((await p.locator('.signal-list .row').count()) !== n) note('SHORTCUT-BEHIND-DIALOG', 'shortcuts changed the project while the warning was open');
    await p.keyboard.press('Escape');
    if (await p.locator('.alert-dialog').count()) note('ESCAPE', 'Escape does not close the warning popup');
  });

  await step('context menu by keyboard (Shift+F10 / ContextMenu key) on the plot and a signal row', async () => {
    await newProject();
    await p.click('.tool:has-text("Sine")');
    await p.locator('.signal-list .row').first().focus();
    await p.keyboard.press('Shift+F10');
    await p.waitForTimeout(150);
    if (!(await p.locator('.context-menu').count())) note('KEYBOARD-CONTEXT-MENU', 'Shift+F10 on a signal row opens no menu (right-click works, keyboard users have no way to reach it)');
    await p.keyboard.press('Escape');
  });

  await step('Enter / Space activate toolbar buttons; arrow keys do not break the page', async () => {
    await newProject();
    await p.locator('button[title^="Zoom in"], button[aria-label^="Zoom in"]').first().focus();
    const before = await p.locator('.range-btn').innerText();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    if ((await p.locator('.range-btn').innerText()) === before) note('KEYBOARD', 'Enter on the Zoom in button did not zoom');
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) await p.keyboard.press(k);
  });
}

// ---------------------------------------------------------------------------------------------
async function areaTouch() {
  if (ctx) await ctx.close().catch(() => {});
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  p.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await p.goto(URL); await p.waitForSelector('.toolbar');
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const plot = async () => p.locator('.plot-host').first().boundingBox();
  const range = async () => (await p.locator('.range-btn').innerText()).replace(/\s+/g, ' ');

  await step('tap tools to add signals', async () => {
    await addTab();
    for (const t of ['Sine', 'Square', 'Triangle']) { await p.locator('.tool', { hasText: new RegExp(`^${t}$`) }).first().tap(); await addTab(); }
    if ((await p.locator('.phone-tabs').count()) === 0) note('LAYOUT', 'no phone tabs at 390 px');
  });
  await step('one-finger drag pans the time axis', async () => {
    const b = await plot(); const r0 = await range();
    await touch('touchStart', [[b.x + b.width * 0.7, b.y + b.height * 0.4]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[b.x + b.width * (0.7 - i * 0.05), b.y + b.height * 0.4]]);
    await touch('touchEnd', []);
    await p.waitForTimeout(300);
    if ((await range()) === r0) note('TOUCH', 'dragging with one finger did not pan');
  });
  await step('two-finger pinch zooms', async () => {
    const b = await plot(); const r0 = await range(); const cx = b.x + b.width / 2; const cy = b.y + b.height / 2;
    await touch('touchStart', [[cx - 20, cy], [cx + 20, cy]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 20 - i * 12, cy], [cx + 20 + i * 12, cy]]);
    await touch('touchEnd', []);
    await p.waitForTimeout(300);
    if ((await range()) === r0) note('TOUCH', 'pinching did not zoom');
  });
  await step('double-tap fits', async () => {
    const b = await plot(); await p.touchscreen.tap(b.x + 100, b.y + 100); await p.touchscreen.tap(b.x + 100, b.y + 100); await p.waitForTimeout(300);
  });
  await step('tap a trace selects it, tap empty deselects', async () => {
    const b = await plot();
    for (let i = 0; i < 6; i++) await p.touchscreen.tap(b.x + b.width * (0.2 + 0.1 * i), b.y + b.height * 0.5);
  });
  await step('touch targets are at least 32 px (toolbar, tabs, tools, row buttons)', async () => {
    await addTab();
    const small = await p.evaluate(() => [...document.querySelectorAll('button, .tool, [role=tab], select, input:not([type=hidden])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32) && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 18)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    if (small.length) note('SMALL-TOUCH-TARGETS', `${small.length} controls smaller than 32 px: ${small.slice(0, 6).join('; ')}`);
  });
  await step('rotate to landscape and back', async () => {
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(400); await scan(' landscape');
    await p.screenshot({ path: path.join(out, 'touch-landscape.png') });
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  });
}

// ---------------------------------------------------------------------------------------------
async function areaBig() {
  await openPage();
  const t = () => Date.now();
  await step('add 120 signals (time per add must stay flat)', async () => {
    const times = [];
    for (let i = 0; i < 120; i++) { const t0 = t(); await p.click(`.tool:has-text("${['Sine', 'Square', 'Triangle', 'Sawtooth'][i % 4]}")`); times.push(t() - t0); }
    const first = times.slice(0, 20).reduce((a, b) => a + b, 0) / 20; const last = times.slice(-20).reduce((a, b) => a + b, 0) / 20;
    console.log(`  add: first 20 avg ${first.toFixed(0)} ms, last 20 avg ${last.toFixed(0)} ms`);
    if (last > Math.max(1500, first * 6)) note('SCALING', `adding a signal slows from ${first.toFixed(0)} ms to ${last.toFixed(0)} ms with 120 signals`);
  });
  await step('stacked mode with 120 panels', async () => { await p.click('.seg button:has-text("Stacked")'); await p.waitForTimeout(800); });
  await step('zoom, pan and fit with 120 panels', async () => {
    const b = await p.locator('.plot-host').first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + 200);
    const t0 = t(); for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, -300); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
    const per = (t() - t0) / 10; console.log(`  wheel step with 120 panels: ${per.toFixed(0)} ms`);
    if (per > 1500) note('SCALING', `each wheel step takes ${per.toFixed(0)} ms with 120 stacked panels`);
    await p.mouse.dblclick(b.x + 300, b.y + 100);
  });
  await step('select every row with the keyboard-free mouse (120 clicks)', async () => {
    const n = await p.locator('.signal-list .row').count(); const t0 = t();
    for (let i = 0; i < n; i += 4) await p.locator('.signal-list .row').nth(i).click();
    const per = (t() - t0) / (n / 4); console.log(`  select: ${per.toFixed(0)} ms per click`);
    if (per > 1200) note('SCALING', `selecting a signal takes ${per.toFixed(0)} ms with ${n} signals`);
  });
  await step('operations chain 30 deep', async () => {
    await p.click('.seg button:has-text("Overlay")');
    await p.locator('.signal-list .row').first().click();
    for (let i = 0; i < 30; i++) { await p.click(`.tool:has-text("${['Absolute value', 'Low-pass (RC)', 'Negate', 'Moving average'][i % 4]}")`); }
    await p.waitForTimeout(500);
  });
  await step('undo 150 times, redo 150 times', async () => {
    await p.locator('.plot-host').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    const t0 = t(); for (let i = 0; i < 150; i++) await p.keyboard.press('Control+z'); const u = t() - t0;
    const t1 = t(); for (let i = 0; i < 150; i++) await p.keyboard.press('Control+y'); const r = t() - t1;
    console.log(`  undo×150 ${u} ms, redo×150 ${r} ms`);
    if (u > 40000 || r > 40000) note('SCALING', `undo ${u} ms / redo ${r} ms for 150 steps`);
  });
  await step('save and reopen the big project', async () => {
    const dl = p.waitForEvent('download', { timeout: 20000 });
    await p.click('button[aria-label="Save as…"]');
    const d = await dl; const f = path.join(out, 'big.wlab'); await d.saveAs(f);
    const kb = fs.statSync(f).size / 1024; console.log(`  file size ${kb.toFixed(0)} kB`);
    const before = await p.locator('.signal-list .row').count();
    await newProject();
    const t0 = t();
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label^="Open project"]')]);
    await chooser.setFiles(f); await p.waitForSelector('.signal-list .row');
    const ms = t() - t0; console.log(`  reopen ${ms} ms`);
    const after = await p.locator('.signal-list .row').count();
    if (after !== before) note('FILE', `reopened big project shows ${after} rows, saved ${before}`);
    if (ms > 15000) note('SCALING', `reopening takes ${ms} ms`);
  });
  await step('export PNG/SVG of the big project', async () => {
    await p.click('button[aria-label^="Export PNG"]'); await p.waitForSelector('.modal');
    for (const fmt of ['png', 'svg']) {
      const opt = await p.locator('.modal select').first().evaluate((s, f) => [...s.options].find((o) => o.value.toLowerCase().includes(f))?.value, fmt);
      if (!opt) continue;
      await p.locator('.modal select').first().selectOption(opt);
      const t0 = t(); const dl = p.waitForEvent('download', { timeout: 30000 }); await p.locator('.modal footer button.primary').click(); await dl;
      console.log(`  export ${fmt}: ${t() - t0} ms`);
    }
    await closeModals();
  });
}

// ---------------------------------------------------------------------------------------------
(async () => {
  browser = await chromium.launch();
  const runs = { tools: areaTools, waveforms: areaWaveforms, dialogs: areaDialogs, views: areaViews, export: areaExport, layouts: areaLayouts, monkey: areaMonkey, keyboard: areaKeyboard, touch: areaTouch, big: areaBig };
  for (const [name, fn] of Object.entries(runs)) {
    if (!want(name)) continue;
    area = name;
    console.log(`\n=== ${name} ===`);
    const t0 = Date.now();
    try { await fn(); } catch (e) { note('AREA-CRASH', e.message.split('\n')[0]); }
    console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s, ${findings.filter((f) => f.area === name).length} findings`);
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'stress-findings.json'), JSON.stringify(findings, null, 2));
  console.log(`\n${findings.length} findings; written to ${path.join(out, 'stress-findings.json')}`);
  process.exit(findings.length ? 1 : 0);
})();
