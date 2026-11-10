import { describe, expect, it } from 'vitest';
import request from 'supertest';

// Requires DATABASE_URL (see .env.example). Validation/auth paths do not touch the database.
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
const { createApp } = await import('../src/app');
const app = createApp();

describe('API', () => {
  it('health is public', async () => { expect((await request(app).get('/api/health')).status).toBe(200); });
  it('rejects unauthenticated ingestion', async () => { expect((await request(app).post('/api/ingest/logs').send({})).status).toBe(401); });
  it('protects data endpoints', async () => { expect((await request(app).get('/api/traces')).status).toBe(401); });
  it('validates login payload', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'nope' });
    expect(r.status).toBe(400); expect(r.body.ok).toBe(false);
  });
  it('returns JSON 404 for unknown routes', async () => { expect((await request(app).get('/api/nope')).status).toBe(404); });
});
