# WaveLab

Browser-based mathematical waveform editor. Waveforms are mathematical objects, not drawings.

## Development
```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (math engine + acceptance tests)
npm run typecheck
npm run build      # production build into dist/
```

## Status
| Milestone | Content | Status |
|---|---|---|
| M0 | Project setup, SI units, document model | ✅ |
| M1 | Signal engine: sine, cosine, square, pulse, triangle, sawtooth, DC | ✅ |
| M2 | Plot engine (overlay/stacked, zoom/pan, exact edges) | ⏳ |
| M3 | Editor interface | ⏳ |
| M4 | Positioning and snapping (configurable modes) | ⏳ |
| M5 | Save/open .wlab, PNG/SVG/PDF export, GitHub Pages | ⏳ |

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for the mathematical conventions.
