import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, payloadFromHash } from './share';
import { parseProjectFile, serializeProject } from './project-file';
import { DEFAULT_PWM } from '../../state/pwm';
import { actions, editor } from '../../state/store';

describe('share links', () => {
  it('round-trips a project exactly (through compression)', async () => {
    actions.newProject();
    actions.createPwm({ ...DEFAULT_PWM, topology: 'three-phase', load: true });
    const text = serializeProject(editor.getState().project);
    const payload = await encodeShare(text);
    expect(payload[0]).toBe('d');
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe
    const back = await decodeShare(payload);
    expect(JSON.parse(back)).toEqual(JSON.parse(text));
    expect(parseProjectFile(back).project.signals.length).toBe(editor.getState().project.signals.length);
  });

  it('is much shorter than the file', async () => {
    const text = serializeProject(editor.getState().project);
    const payload = await encodeShare(text);
    expect(payload.length).toBeLessThan(text.length / 3);
  });

  it('rejects damaged, unknown and oversized payloads with a clear error, never a crash', async () => {
    await expect(decodeShare('')).rejects.toThrow(/does not contain/);
    await expect(decodeShare('x!!!')).rejects.toThrow();
    await expect(decodeShare('zAAAA')).rejects.toThrow(/unknown version/);
    await expect(decodeShare('dAAAAAAAA')).rejects.toThrow(); // not a deflate stream
    // A bomb: ~12 MB of zeros compress to a few kB; opening it must stop at the limit.
    const zeros = '0'.repeat(12 * 1024 * 1024);
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    void w.write(new TextEncoder().encode(zeros)).then(() => w.close());
    const chunks: Uint8Array[] = [];
    const r = cs.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
    }
    let bin = '';
    for (const c of chunks) bin += String.fromCharCode(...c);
    const payload = 'd' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expect(decodeShare(payload)).rejects.toThrow(/allowed size/);
  }, 60000);

  it('reads the payload from a fragment only in the exact form', () => {
    expect(payloadFromHash('#share=dAbC-_9')).toBe('dAbC-_9');
    expect(payloadFromHash('#share=')).toBeNull();
    expect(payloadFromHash('#other=dAbC')).toBeNull();
    expect(payloadFromHash('#share=dAb C')).toBeNull();
    expect(payloadFromHash('')).toBeNull();
  });
});
