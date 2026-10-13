/**
 * POST /api/share        body: DesignSnapshot → { id }
 * GET  /api/share?id=…   → DesignSnapshot
 *
 * Upstash Redis via the Vercel Marketplace integration — see
 * _lib/redisEnv.ts for which env var names are accepted.
 */

import { Redis } from '@upstash/redis';
import { handleCreate, handleRead, type ShareStore } from './_lib/shareHandler.js';
import { resolveRedisEnv, redisEnvNames } from './_lib/redisEnv.js';

// Read through globalThis: Vercel type-checks api/ with its own config, which
// doesn't load @types/node, so a bare `process` fails its check.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

function createStore(): ShareStore | null {
  const creds = resolveRedisEnv(env);
  if (!creds) return null;
  const { url, token } = creds;
  // Keep values as raw strings — the default would JSON.parse them on read.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    setIfAbsent: async (key, value) => (await redis.set(key, value, { nx: true })) === 'OK',
    get: (key) => redis.get<string>(key),
  };
}

const store = createStore();

async function withStore(handler: (store: ShareStore) => Promise<Response>): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (!store) {
    const body = { error: 'storage_not_configured', envNamesSeen: redisEnvNames(env) };
    return new Response(JSON.stringify(body), { status: 503, headers });
  }
  try {
    return await handler(store);
  } catch (err) {
    console.error('[api/share]', err);
    return new Response(JSON.stringify({ error: 'storage_error' }), { status: 502, headers });
  }
}

export function POST(request: Request): Promise<Response> {
  return withStore((s) => handleCreate(request, s));
}

export function GET(request: Request): Promise<Response> {
  return withStore((s) => handleRead(request, s));
}
