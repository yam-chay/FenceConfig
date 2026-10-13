/**
 * POST /api/share        body: DesignSnapshot → { id }
 * GET  /api/share?id=…   → DesignSnapshot
 *
 * Upstash Redis via the Vercel Marketplace integration. The integration
 * names its env vars KV_REST_API_*; plain Upstash setups use UPSTASH_*.
 */

import { Redis } from '@upstash/redis';
import { handleCreate, handleRead, type ShareStore } from './_lib/shareHandler.js';

function createStore(): ShareStore | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
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
  if (!store) return new Response(JSON.stringify({ error: 'storage_not_configured' }), { status: 503, headers });
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
