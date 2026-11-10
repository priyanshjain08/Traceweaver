import { describe, expect, it } from 'vitest';
import { parseLogQuery, spanInputSchema, logInputSchema } from './index';

describe('parseLogQuery', () => {
  it('parses multiple conditions and quoted values', () => {
    const r = parseLogQuery('level:error service:payment-service message:"connection timeout"');
    expect(r).toEqual({ ok: true, conditions: [
      { field: 'level', value: 'error' }, { field: 'service', value: 'payment-service' }, { field: 'message', value: 'connection timeout' },
    ] });
  });
  it('returns empty conditions for blank input', () => {
    expect(parseLogQuery('   ')).toEqual({ ok: true, conditions: [] });
  });
  it('rejects unknown fields, bad levels, duplicates and unterminated quotes', () => {
    expect(parseLogQuery('foo:bar')).toMatchObject({ ok: false });
    expect(parseLogQuery('level:loud')).toMatchObject({ ok: false });
    expect(parseLogQuery('level:error level:warn')).toMatchObject({ ok: false });
    expect(parseLogQuery('message:"oops')).toMatchObject({ ok: false });
    expect(parseLogQuery('justtext')).toMatchObject({ ok: false });
  });
});

describe('ingest schemas', () => {
  it('rejects spans that end before they start', () => {
    const r = spanInputSchema.safeParse({ spanId: 'a', service: 's', operation: 'o', startTime: '2026-01-02T00:00:00Z', endTime: '2026-01-01T00:00:00Z' });
    expect(r.success).toBe(false);
  });
  it('applies defaults to logs', () => {
    const r = logInputSchema.parse({ timestamp: '2026-01-01T00:00:00Z', level: 'info', service: 'x', message: 'hi' });
    expect(r.environment).toBe('production');
  });
});
