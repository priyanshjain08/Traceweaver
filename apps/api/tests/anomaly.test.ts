import { describe, expect, it } from 'vitest';
import { detect, DEFAULT_THRESHOLDS, type WindowStats } from '../src/modules/anomaly';

const w = (o: Partial<WindowStats>): WindowStats => ({ service: 'payment-service', requests: 50, errors: 1, p95: 100, failedSpans: 1, ...o });

describe('detect', () => {
  it('flags error-rate spikes with explanation', () => {
    const f = detect([w({ errors: 30 })], [w({})]);
    const a = f.find((x) => x.type === 'error_rate_spike');
    expect(a).toBeDefined(); expect(a!.measured).toBeCloseTo(0.6); expect(a!.explanation).toContain('60.0%');
  });
  it('flags latency regressions relative to baseline', () => {
    expect(detect([w({ p95: 450 })], [w({ p95: 100 })]).some((x) => x.type === 'latency_increase')).toBe(true);
  });
  it('is quiet for healthy traffic', () => { expect(detect([w({})], [w({})])).toEqual([]); });
  it('ignores tiny windows', () => { expect(detect([w({ requests: 3, errors: 3 })], [w({})], { ...DEFAULT_THRESHOLDS, repeatedFailures: 99 })).toEqual([]); });
  it('detects unusual volume after normalising for window size', () => {
    expect(detect([w({ requests: 400 })], [w({ requests: 100 })], DEFAULT_THRESHOLDS, 1).some((x) => x.type === 'unusual_volume')).toBe(true);
  });
});
