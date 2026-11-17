import { beforeEach, describe, expect, it } from 'vitest';
import { compiled } from './compiled';
import { DEFAULT_PROTOCOL, parseBytes, type ProtocolConfig } from './protocols';
import { actions, editor } from './store';

const sig = (name: string) => {
  const p = editor.getState().project;
  const s = p.signals.find((x) => x.name === name);
  if (!s) throw new Error(`no signal ${name}`);
  return compiled(s, p);
};
const make = (patch: Partial<ProtocolConfig>) => {
  const err = actions.createProtocol({ ...DEFAULT_PROTOCOL, ...patch });
  expect(err).toBeNull();
};
const bit = (v: number) => (v > 1.65 ? 1 : 0);
const toByte = (bits: number[]) => bits.reduce((a, b) => a * 2 + b, 0);

beforeEach(() => actions.newProject());

describe('serial protocols decode back to the payload', () => {
  it('parses text and hex payloads', () => {
    expect(parseBytes('Hi', 'text')).toEqual([0x48, 0x69]);
    expect(parseBytes('48 0x69,ff', 'hex')).toEqual([0x48, 0x69, 0xff]);
    expect(parseBytes('4g', 'hex')).toBeNull();
  });

  it('UART bit clock is optional and rises in the middle of each bit', () => {
    make({ protocol: 'uart', data: 'Hi' });
    expect(() => sig('CLK')).toThrow();
    make({ protocol: 'uart', data: 'Hi', uartClock: true });
    const clk = sig('CLK');
    const T = 1 / 9600;
    expect(bit(clk.value(0.25 * T))).toBe(0);
    expect(bit(clk.value(0.75 * T))).toBe(1);
    expect(bit(clk.value(1.25 * T))).toBe(0);
    expect(bit(clk.value(1.75 * T))).toBe(1);
  });

  it('UART 8E1: start bit, LSB first, even parity, stop; idle high', () => {
    make({ protocol: 'uart', data: 'Hi', parity: 'even', baud: 9600 });
    const tx = sig('TX');
    const T = 1 / 9600;
    expect(bit(tx.value(-1))).toBe(1);
    const out: number[] = [];
    // Frames start after 1 idle bit; frame = 1 + 8 + 1 + 1 stop + 1 gap = 12 bits.
    for (let f = 0; f < 2; f++) {
      const s0 = 1 + f * 12;
      expect(bit(tx.value((s0 + 0.5) * T))).toBe(0); // start
      const d = Array.from({ length: 8 }, (_, i) => bit(tx.value((s0 + 1 + i + 0.5) * T)));
      const byte = toByte([...d].reverse());
      const parity = bit(tx.value((s0 + 9.5) * T));
      expect((d.filter((x) => x).length + parity) % 2).toBe(0);
      expect(bit(tx.value((s0 + 10.5) * T))).toBe(1); // stop
      out.push(byte);
    }
    expect(out).toEqual([0x48, 0x69]);
    const anns = editor.getState().project.figures[0]!.annotations!;
    expect(anns.filter((a) => a.kind === 'dim-t').map((a) => a.text)).toEqual(["0x48 'H'", "0x69 'i'"]);
  });

  for (const mode of [0, 1, 2, 3] as const) {
    it(`SPI mode ${mode}: MOSI sampled on the right clock edge gives the bytes`, () => {
      make({ protocol: 'spi', spiMode: mode, data: 'A5 3C', dataFormat: 'hex', miso: '0F', spiClock: 1e6 });
      const clk = sig('SCLK');
      const mosi = sig('MOSI');
      const miso = sig('MISO');
      const cpol = mode >= 2 ? 1 : 0;
      const cpha = mode % 2;
      // Sampling edges: leading (away from idle) for CPHA 0, trailing for CPHA 1.
      const edges = clk.features(0, 1e-4).features.filter((f) => f.kind === 'jump');
      const sampleEdges = edges.filter((f) => (bit(f.right) !== cpol) === (cpha === 0));
      expect(sampleEdges.length).toBe(16);
      const bits = sampleEdges.map((f) => bit(mosi.value(f.t)));
      expect([toByte(bits.slice(0, 8)), toByte(bits.slice(8))]).toEqual([0xa5, 0x3c]);
      expect(toByte(sampleEdges.slice(0, 8).map((f) => bit(miso.value(f.t))))).toBe(0x0f);
      expect(bit(sig('CS').value(sampleEdges[0]!.t))).toBe(0);
      expect(bit(clk.value(-1))).toBe(cpol);
    });
  }

  it('I²C write: START, address + W, ACKs, data, STOP', () => {
    make({ protocol: 'i2c', address: 0x50, read: false, data: '12 34', dataFormat: 'hex' });
    const sda = sig('SDA');
    const scl = sig('SCL');
    const rising = scl.features(0, 1).features.filter((f) => f.kind === 'jump' && f.right > f.left);
    const bits = rising.map((f) => bit(sda.value(f.t)));
    // 9 bits per byte: address+W, ACK, 0x12, ACK, 0x34, ACK, then the STOP clock
    expect(toByte(bits.slice(0, 8))).toBe(0xa0); // 0x50 << 1 | W
    expect(bits[8]).toBe(0);
    expect(toByte(bits.slice(9, 17))).toBe(0x12);
    expect(toByte(bits.slice(18, 26))).toBe(0x34);
    expect(bits[26]).toBe(0);
    // START and STOP: SDA edges while SCL is high
    const sdaEdges = sda.features(0, 1).features.filter((f) => f.kind === 'jump');
    const whileHigh = sdaEdges.filter((f) => bit(scl.value(f.t)) === 1);
    expect(whileHigh[0]!.right).toBeLessThan(whileHigh[0]!.left); // START: falling
    expect(whileHigh[whileHigh.length - 1]!.right).toBeGreaterThan(whileHigh[whileHigh.length - 1]!.left); // STOP: rising
    expect(whileHigh.length).toBe(2); // no other SDA change while SCL is high
  });

  it('I²C read ends with NACK', () => {
    make({ protocol: 'i2c', read: true, data: 'AA', dataFormat: 'hex' });
    const texts = editor.getState().project.figures[0]!.annotations!.map((a) => a.text);
    expect(texts).toContain('0x50 R');
    expect(texts[texts.length - 2]).toBe('N');
  });
});
