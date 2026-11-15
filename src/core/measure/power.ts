/**
 * Power of a voltage/current pair over an interval [a, b] (exact integration):
 *
 *   P  = (1/T)∫ v·i dt                  active power
 *   S  = V_rms · I_rms                  apparent power
 *   PF = P / S                          (true) power factor
 *   N  = √(S² − P²)                     non-active power (includes harmonics; equals |Q|
 *                                       for sinusoids)
 * From the fundamentals (exact Fourier series over whole periods of f₁ from `t0`):
 *   P₁ = V₁·I₁·cos φ₁,  Q₁ = V₁·I₁·sin φ₁ (RMS values, φ₁ = angle of v₁ minus angle of i₁,
 *   Q₁ > 0 when the current lags: inductive), DPF = cos φ₁ (displacement power factor).
 */

import { integrateRange, productOf } from '../signals/operators';
import type { SignalEval } from '../signals/types';
import { measureInterval } from './measure';
import { harmonicSpectrum } from './spectrum';

export interface PowerMetrics {
  p: number;
  s: number;
  pf: number;
  n: number;
  vrms: number;
  irms: number;
  /** Fundamental quantities (NaN when no fundamental is given or found). */
  p1: number;
  q1: number;
  dpf: number;
  phi1Deg: number;
}

export function powerMetrics(v: SignalEval, i: SignalEval, a: number, b: number, fund?: { f1: number; periods: number; t0: number }): PowerMetrics {
  const span = b - a;
  const vm = measureInterval(v, a, b);
  const im = measureInterval(i, a, b);
  const p = span > 0 ? integrateRange(productOf(v, i), a, b) / span : NaN;
  const s = vm.rms * im.rms;
  const clean = (x: number) => (Math.abs(x) <= 1e-10 * s ? 0 : x);
  const pc = clean(p);
  let p1 = NaN;
  let q1 = NaN;
  let dpf = NaN;
  let phi1Deg = NaN;
  if (fund && fund.f1 > 0) {
    const o = { f1: fund.f1, periods: fund.periods, t0: fund.t0, maxOrder: 1 };
    const sv = harmonicSpectrum(v, o);
    const si = harmonicSpectrum(i, o);
    const N = Math.max(1, Math.round(fund.periods));
    const V1 = sv.amp[N]!;
    const I1 = si.amp[N]!;
    if (V1 > 0 && I1 > 0) {
      phi1Deg = (((sv.phaseDeg[N]! - si.phaseDeg[N]!) % 360) + 540) % 360 - 180;
      const phi = (phi1Deg * Math.PI) / 180;
      p1 = clean((V1 * I1 * Math.cos(phi)) / 2);
      q1 = clean((V1 * I1 * Math.sin(phi)) / 2);
      dpf = Math.cos(phi);
    }
  }
  return {
    p: pc,
    s,
    pf: s > 0 ? pc / s : NaN,
    n: clean(Math.sqrt(Math.max(0, s * s - p * p))),
    vrms: vm.rms,
    irms: im.rms,
    p1,
    q1,
    dpf,
    phi1Deg,
  };
}
