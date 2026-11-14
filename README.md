# WaveLab

Browser-based mathematical waveform editor. Waveforms are mathematical objects, not drawings.

## Development
```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (math engine + acceptance tests)
npm run typecheck
npm run build      # production build into dist/
npx vite preview   # serve the build, then in another shell:
npm run e2e        # browser end-to-end checks: editor, snapping, files & export (Playwright)
```

## Status
| Milestone | Content | Status |
|---|---|---|
| M0 | Project setup, SI units, document model | ✅ |
| M1 | Signal engine: sine, cosine, square, pulse, triangle, sawtooth, DC | ✅ |
| M2 | Plot engine (overlay/stacked, zoom/pan, exact edges) | ✅ |
| M3 | Editor interface | ✅ |
| M4 | Positioning and snapping (configurable modes) | ✅ |
| M5 | Save/open .wlab, PNG/SVG/PDF export, math markup, GitHub Pages | ✅ |

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for the mathematical conventions.

## Files and export
- **Projects** are saved as `.wlab` (readable JSON with the mathematical definitions, never samples).
  Ctrl+S saves, "Save as…" picks a new file, Ctrl+O or drag-and-drop opens one. In Chromium-based
  browsers Save writes back to the same file; in other browsers it downloads a copy.
- **Export** (Ctrl+Shift+S): PNG (1×/2×/4×, transparent option), SVG (vector, editable text),
  PDF (vector, Inter font embedded; page = figure size, A4, A3, Letter or custom).

## Math in labels
Signal names (shown in legends and axis titles) accept a small LaTeX-like markup:
`V_{out}`, `I_{RMS}^2`, `\omega t`, `\Delta t`, `\varphi`, `90^\circ`. Write `\_` for a literal underscore.

## Deployment
`.github/workflows/deploy.yml` builds, tests and publishes to GitHub Pages on every push to `main`.
One-time setup: repository Settings → Pages → Source: **GitHub Actions**.

## Third-party assets
- Inter font (subset), © The Inter Project Authors, SIL Open Font License 1.1 — `public/fonts/Inter-LICENSE.txt`.
