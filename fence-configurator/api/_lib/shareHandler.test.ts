import { describe, it, expect } from 'vitest';
import { handleCreate, handleRead, shareIdFor, MAX_BODY_BYTES, type ShareStore } from './shareHandler.js';
import golden from '../../src/app/__fixtures__/golden.json' with { type: 'json' };
import { SNAPSHOT_VERSION } from '../../src/app/snapshot.js';

const snapshot = {
  v: SNAPSHOT_VERSION,
  shape: golden.defaultShape,
  colorScheme: golden.defaultColorScheme,
  profileScheme: golden.defaultProfileScheme,
};

function memoryStore(): ShareStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    setIfAbsent: async (key, value) => (data.has(key) ? false : (data.set(key, value), true)),
    get: async (key) => data.get(key) ?? null,
  };
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://x.test/api/share', { method: 'POST', body, headers });
const get = (id: string) => new Request(`https://x.test/api/share?id=${id}`);

describe('POST /api/share', () => {
  it('stores a valid snapshot and returns an 8-char base62 id', async () => {
    const store = memoryStore();
    const res = await handleCreate(post(JSON.stringify(snapshot)), store);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(JSON.parse(store.data.get(`share:${id}`)!)).toEqual(snapshot);
  });

  it('returns the same id for the same design (no duplicate rows)', async () => {
    const store = memoryStore();
    const a = await (await handleCreate(post(JSON.stringify(snapshot)), store)).json();
    const res = await handleCreate(post(JSON.stringify(snapshot, null, 2)), store);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(a.id);
    expect(store.data.size).toBe(1);
  });

  it('picks a salted id when the content id is taken by a different design', async () => {
    const store = memoryStore();
    const content = JSON.stringify(snapshot);
    store.data.set(`share:${await shareIdFor(content)}`, 'something else');
    const { id } = await (await handleCreate(post(content), store)).json();
    expect(id).toBe(await shareIdFor(content, 1));
  });

  it('rejects invalid JSON and invalid snapshots', async () => {
    const store = memoryStore();
    expect((await handleCreate(post('{nope'), store)).status).toBe(400);
    expect((await handleCreate(post(JSON.stringify({ ...snapshot, v: SNAPSHOT_VERSION + 1 })), store)).status).toBe(400);
    expect(store.data.size).toBe(0);
  });

  it('rejects oversized bodies', async () => {
    const store = memoryStore();
    const big = JSON.stringify({ ...snapshot, pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await handleCreate(post(big), store)).status).toBe(413);
    expect((await handleCreate(post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) }), store)).status).toBe(413);
  });
});

describe('GET /api/share', () => {
  it('round-trips a stored snapshot', async () => {
    const store = memoryStore();
    const { id } = await (await handleCreate(post(JSON.stringify(snapshot)), store)).json();
    const res = await handleRead(get(id), store);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    // What Vercel's CDN reads — without it every first open hits Redis.
    expect(res.headers.get('cache-control')).toContain('s-maxage=31536000');
    expect(await res.json()).toEqual(snapshot);
  });

  it('404s unknown ids without caching, 400s malformed ids', async () => {
    const store = memoryStore();
    const missing = await handleRead(get('AAAAAAAA'), store);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect((await handleRead(get('../etc'), store)).status).toBe(400);
  });
});

describe('share format v3', () => {
  const v3 = {
    v: 3,
    colors: ['3a3f44', 'e8e6e1'],
    profiles: [['type-1', 'size-1']],
    post: 0,
    legs: [[1, 0, 30, 12, 0]],
    junctions: '',
    fields: [[[1, '01', '00', '01']]],
  };

  it('stores a v3 snapshot as posted (not expanded) and serves it back', async () => {
    const store = memoryStore();
    const res = await handleCreate(post(JSON.stringify(v3)), store);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(store.data.get(`share:${id}`)).toBe(JSON.stringify(v3));
    expect(await (await handleRead(get(id), store)).json()).toEqual(v3);
  });

  it('rejects a malformed v3', async () => {
    const store = memoryStore();
    const bad = { ...v3, fields: [[[1, '01', '0', '01']]] };
    expect((await handleCreate(post(JSON.stringify(bad)), store)).status).toBe(400);
    expect(store.data.size).toBe(0);
  });

  it('still accepts v2 from a tab opened before the change', async () => {
    const store = memoryStore();
    expect((await handleCreate(post(JSON.stringify(snapshot)), store)).status).toBe(201);
  });
});
