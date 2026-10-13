/**
 * Short view links — storage-agnostic request handling for /api/share.
 * api/share.ts wires it to Upstash Redis; tests wire it to a Map.
 *
 * Links are permanent (no TTL): they are sent to customers. Ids are derived
 * from the snapshot's content, so sharing the same design twice returns the
 * same link instead of growing the store.
 */

import { isValidSnapshot } from '../../src/app/snapshot.js';

export interface ShareStore {
  /** Writes only if the key is new (Redis SET NX). Resolves true if written. */
  setIfAbsent(key: string, value: string): Promise<boolean>;
  get(key: string): Promise<string | null>;
}

/** A real design is a few KB; this only stops abuse of a public endpoint. */
export const MAX_BODY_BYTES = 256 * 1024;
const ID_LENGTH = 8;
const ID_RE = new RegExp(`^[0-9A-Za-z]{${ID_LENGTH}}$`);
const KEY_PREFIX = 'share:';
/** Extra salted attempts if a content hash prefix collides with a different design. */
const MAX_ID_ATTEMPTS = 4;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

/** 8 base62 chars (~47 bits) from the SHA-256 of the content + attempt salt. */
export async function shareIdFor(content: string, attempt = 0): Promise<string> {
  const input = attempt === 0 ? content : `${content}\n#${attempt}`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
  let n = 0n;
  for (const byte of digest.subarray(0, 8)) n = (n << 8n) | BigInt(byte);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += BASE62[Number(n % 62n)];
    n /= 62n;
  }
  return id;
}

export async function handleCreate(request: Request, store: ShareStore): Promise<Response> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!isValidSnapshot(parsed)) return json({ error: 'invalid_snapshot' }, 400);

  // Re-serialize so formatting differences don't produce different ids.
  const content = JSON.stringify(parsed);
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const id = await shareIdFor(content, attempt);
    const key = KEY_PREFIX + id;
    if (await store.setIfAbsent(key, content)) return json({ id }, 201);
    // Already stored: same design shared before → reuse; otherwise a collision → next salt.
    if ((await store.get(key)) === content) return json({ id }, 200);
  }
  return json({ error: 'id_collision' }, 500);
}

export async function handleRead(request: Request, store: ShareStore): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) return json({ error: 'invalid_id' }, 400);

  const content = await store.get(KEY_PREFIX + id);
  if (content === null) return json({ error: 'not_found' }, 404);

  // Content never changes for an id (writes are SET NX), so the CDN can keep it.
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
