/**
 * Placeholder shell. The editor UI is built in milestones M2–M3; until then the
 * app states plainly that only the math engine exists.
 */
export function App() {
  return (
    <main className="shell">
      <h1>WaveLab</h1>
      <p>Mathematical waveform editor — v{__APP_VERSION__}</p>
      <p className="note">
        Under construction: the signal engine is implemented and tested (milestone M1). The plot
        engine and editor interface arrive in milestones M2–M3.
      </p>
    </main>
  );
}
