/**
 * Serial protocol frames (UART, SPI, I²C) as ordinary bit-sequence signals, with the
 * decoded fields as dimension annotations above the waveforms.
 *
 *  UART: idle high; start bit 0, data LSB first, optional parity, 1–2 stop bits (1).
 *  SPI:  mode = 2·CPOL + CPHA. CPHA 0: data valid before the leading clock edge (sampled
 *        on it, changed on the trailing edge); CPHA 1: changed on the leading edge, sampled
 *        on the trailing edge. CS active low; MSB first by default.
 *  I²C:  SDA/SCL idle high (open drain). START = SDA falls while SCL is high; data changes
 *        while SCL is low; 7-bit address + R/W (1 = read), ACK = 0 from the receiver
 *        (NACK = 1 after the last byte of a read); STOP = SDA rises while SCL is high.
 */

import type { Annotation } from '../core/model/project';
import type { BitsParams } from '../core/model/signal-defs';
import { setBuilder, type SignalSet } from './builder';

export type Protocol = 'uart' | 'spi' | 'i2c';

export interface ProtocolConfig {
  protocol: Protocol;
  /** Payload: text (each character = one byte) or hex bytes "48 65 0x6C". */
  data: string;
  dataFormat: 'text' | 'hex';
  high: number;
  low: number;
  // UART
  baud: number;
  dataBits: number;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1 | 2;
  /** Idle bits between UART frames. */
  gap: number;
  // SPI
  spiClock: number;
  spiMode: 0 | 1 | 2 | 3;
  lsbFirst: boolean;
  /** MISO payload (empty = no MISO line). */
  miso: string;
  // I²C
  i2cClock: number;
  /** 7-bit address. */
  address: number;
  read: boolean;
}

export const DEFAULT_PROTOCOL: ProtocolConfig = {
  protocol: 'uart',
  data: 'Hi',
  dataFormat: 'text',
  high: 3.3,
  low: 0,
  baud: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  gap: 1,
  spiClock: 1e6,
  spiMode: 0,
  lsbFirst: false,
  miso: '',
  i2cClock: 100e3,
  address: 0x50,
  read: false,
};

/** Bytes of a payload; null if the hex text is invalid. */
export function parseBytes(text: string, format: 'text' | 'hex'): number[] | null {
  if (format === 'text') return [...new TextEncoder().encode(text)];
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const m = /^(?:0x)?([0-9a-f]{1,2})$/i.exec(p);
    if (!m) return null;
    out.push(parseInt(m[1]!, 16));
  }
  return out;
}

const hex = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`;
const show = (b: number) => (b >= 0x20 && b < 0x7f ? `${hex(b)} '${String.fromCharCode(b)}'` : hex(b));
const bitsOf = (b: number, n: number, lsbFirst: boolean) => {
  const s = Array.from({ length: n }, (_, i) => ((b >> (n - 1 - i)) & 1 ? '1' : '0')).join('');
  return lsbFirst ? [...s].reverse().join('') : s;
};

export interface ProtocolSet extends SignalSet {
  annotations: Array<Omit<Annotation, 'id'>>;
  /** Vertical range per signal id (room above the waveform for the labels). */
  yRanges: Record<string, [number, number]>;
  duration: number;
}

export function buildProtocol(c: ProtocolConfig, newId: (prefix: string) => string, colorStart = 0): ProtocolSet | string {
  const bytes = parseBytes(c.data, c.dataFormat);
  if (!bytes) return 'The data must be hex bytes such as “48 65 0x6C”.';
  if (!bytes.length) return 'Enter at least one byte of data.';
  if (bytes.length > 256) return 'At most 256 bytes.';
  const B = setBuilder(newId, colorStart);
  const H = c.high;
  const L = c.low;
  const D = H - L;
  const labelY = H + 0.25 * D;
  const anns: Array<Omit<Annotation, 'id'>> = [];
  const yRanges: Record<string, [number, number]> = {};
  const line = (name: string, bits: string, bitTime: number, idle: 'low' | 'high') => {
    const s = B.gen(name, 'V', 'bits', (d) => {
      const p: BitsParams = { bits, bitTime, high: H, low: L, encoding: 'nrz', repeat: false, idle };
      d.params = p;
    });
    yRanges[s.id] = [L - 0.15 * D, H + 0.55 * D];
    return s;
  };
  const dim = (on: string, t0: number, t1: number, text: string, color = '#1c2330') =>
    anns.push({ kind: 'dim-t', on, t0, t1, y0: labelY, y1: labelY, text, color });
  const label = (on: string, t: number, text: string, color = '#5b6577') =>
    anns.push({ kind: 'text', on, t0: t, t1: t, y0: labelY, y1: labelY, text, color });

  if (c.protocol === 'uart') {
    const T = 1 / c.baud;
    let s = '1'; // one idle bit before the first frame
    const fields: Array<{ start: number; byte: number; parityAt: number }> = [];
    for (const b of bytes) {
      const v = b & ((1 << c.dataBits) - 1);
      const start = s.length;
      s += '0' + bitsOf(v, c.dataBits, true);
      let parityAt = -1;
      if (c.parity !== 'none') {
        const ones = [...bitsOf(v, c.dataBits, true)].filter((x) => x === '1').length;
        parityAt = s.length;
        s += (c.parity === 'even' ? ones % 2 : (ones + 1) % 2) ? '1' : '0';
      }
      s += '1'.repeat(c.stopBits) + '1'.repeat(Math.max(0, Math.round(c.gap)));
      fields.push({ start, byte: v, parityAt });
    }
    const tx = line('TX', s, T, 'high');
    for (const f of fields) {
      label(tx.id, (f.start + 0.15) * T, 'S');
      dim(tx.id, (f.start + 1) * T, (f.start + 1 + c.dataBits) * T, show(f.byte));
      if (f.parityAt >= 0) label(tx.id, (f.parityAt + 0.15) * T, 'P');
    }
    return { signals: B.signals, groups: [B.group('UART', [tx])], annotations: anns, yRanges, duration: s.length * T };
  }

  if (c.protocol === 'spi') {
    const cpol = c.spiMode >= 2 ? 1 : 0;
    const cpha = c.spiMode % 2;
    const hT = 1 / (2 * c.spiClock); // half period = one cell
    const misoBytes = c.miso.trim() ? parseBytes(c.miso, c.dataFormat) : null;
    if (c.miso.trim() && !misoBytes) return 'The MISO data must be hex bytes.';
    const mosiBits = bytes.map((b) => bitsOf(b, 8, c.lsbFirst)).join('');
    const misoBits = misoBytes ? Array.from({ length: bytes.length }, (_, i) => bitsOf(misoBytes[i] ?? 0, 8, c.lsbFirst)).join('') : '';
    const N = mosiBits.length;
    // Cells: idle, lead, 2 per bit, trail, idle
    let cs = '1';
    let sclk = String(cpol);
    let mosi = '0';
    let miso = '0';
    const first = (bits: string) => (cpha === 0 ? bits[0]! : '0');
    cs += '0';
    sclk += String(cpol);
    mosi += first(mosiBits);
    miso += misoBits ? first(misoBits) : '0';
    for (let i = 0; i < N; i++) {
      cs += '00';
      sclk += cpha === 0 ? `${cpol}${1 - cpol}` : `${1 - cpol}${cpol}`;
      mosi += mosiBits[i]!.repeat(2);
      miso += misoBits ? misoBits[i]!.repeat(2) : '00';
    }
    cs += '01';
    sclk += `${cpol}${cpol}`;
    mosi += '00';
    miso += '00';
    const sCs = line('CS', cs, hT, 'high');
    const sClk = line('SCLK', sclk, hT, cpol ? 'high' : 'low');
    const sMosi = line('MOSI', mosi, hT, 'low');
    const sMiso = misoBits ? line('MISO', miso, hT, 'low') : null;
    bytes.forEach((b, k) => {
      const t0 = (2 + 16 * k) * hT;
      dim(sMosi.id, t0, t0 + 16 * hT, hex(b));
      if (sMiso && misoBytes) dim(sMiso.id, t0, t0 + 16 * hT, hex(misoBytes[k] ?? 0));
    });
    return {
      signals: B.signals,
      groups: [B.group(`SPI mode ${c.spiMode}`, [sCs, sClk, sMosi, ...(sMiso ? [sMiso] : [])])],
      annotations: anns,
      yRanges,
      duration: cs.length * hT,
    };
  }

  // I²C — quarter-period cells
  const qT = 1 / (4 * c.i2cClock);
  let sda = '11';
  let scl = '11';
  // START: SDA falls while SCL is high
  sda += '10';
  scl += '11';
  let prev = '0';
  const bitCell = (b: string) => {
    sda += prev + b + b + b;
    scl += '0011';
    prev = b;
  };
  const fields: Array<{ at: number; n: number; text: string }> = [];
  const acks: Array<{ at: number; text: string }> = [];
  const addr = ((c.address & 0x7f) << 1) | (c.read ? 1 : 0);
  fields.push({ at: sda.length, n: 8, text: `${hex(c.address & 0x7f)} ${c.read ? 'R' : 'W'}` });
  for (const b of bitsOf(addr, 8, false)) bitCell(b);
  acks.push({ at: sda.length, text: 'A' });
  bitCell('0');
  bytes.forEach((v, k) => {
    fields.push({ at: sda.length, n: 8, text: hex(v) });
    for (const b of bitsOf(v, 8, false)) bitCell(b);
    const nack = c.read && k === bytes.length - 1;
    acks.push({ at: sda.length, text: nack ? 'N' : 'A' });
    bitCell(nack ? '1' : '0');
  });
  // STOP: SDA rises while SCL is high
  sda += prev + '001';
  scl += '0011';
  sda += '11';
  scl += '11';
  const sSda = line('SDA', sda, qT, 'high');
  const sScl = line('SCL', scl, qT, 'high');
  label(sSda.id, 2 * qT, 'S');
  for (const f of fields) dim(sSda.id, (f.at + 1) * qT, (f.at + 1 + 4 * f.n) * qT, f.text);
  for (const a of acks) label(sSda.id, (a.at + 1.6) * qT, a.text, a.text === 'N' ? '#c0392b' : '#5b6577');
  label(sSda.id, (sda.length - 3) * qT, 'P');
  return { signals: B.signals, groups: [B.group('I²C', [sSda, sScl])], annotations: anns, yRanges, duration: sda.length * qT };
}
