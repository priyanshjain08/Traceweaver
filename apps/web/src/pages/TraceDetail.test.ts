import { describe, expect, it } from 'vitest';
import { orderSpans } from './TraceDetail';

const sp = (spanId: string, parentSpanId: string | null, t: number) => ({ id: spanId, spanId, parentSpanId, service: 's', operation: 'o', startTime: new Date(t).toISOString(), endTime: new Date(t + 5).toISOString(), durationMs: 5, status: 'ok', attributes: {} });
describe('orderSpans', () => {
  it('orders depth-first with depths', () => {
    const r = orderSpans([sp('c', 'b', 3), sp('a', null, 0), sp('b', 'a', 1), sp('d', 'a', 2)]);
    expect(r.map((s) => `${s.spanId}${s.depth}`)).toEqual(['a0', 'b1', 'c2', 'd1']);
  });
  it('treats spans with unknown parents as roots', () => {
    expect(orderSpans([sp('x', 'missing', 0)])[0]!.depth).toBe(0);
  });
});
