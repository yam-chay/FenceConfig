/**
 * Design persistence — one snapshot format, three destinations:
 * localStorage (autosave in the editor), the short view link (/v/<id>,
 * stored server-side by /api/share), and the legacy URL-hash view link
 * (#view=…), which is also the fallback when the server is unreachable.
 *
 * The format and its versioning RULE live in snapshot.ts.
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Shape } from '../geometry/shape';
import type { ColorScheme, ProfileScheme } from '../scene/Scene';
import { SNAPSHOT_VERSION, isValidSnapshot, type DesignSnapshot } from './snapshot';

export type { DesignSnapshot };

const STORAGE_KEY = 'mld-fence-sim:design';
const VIEW_HASH_PREFIX = '#view=';

export type AppMode = 'edit' | 'view';

export interface InitialDesign {
  mode: AppMode;
  /** null in edit mode = no save yet; null in view mode = broken link (unless shareId is set). */
  design: DesignSnapshot | null;
  /** Short view link (/v/<id>): the design must still be fetched with fetchSharedDesign. */
  shareId?: string;
}

export function makeSnapshot(shape: Shape, colorScheme: ColorScheme, profileScheme: ProfileScheme): DesignSnapshot {
  return { v: SNAPSHOT_VERSION, shape, colorScheme, profileScheme };
}

function parseSnapshot(json: string | null): DesignSnapshot | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// localStorage — every call guarded: private mode, quota, disabled storage.
// ---------------------------------------------------------------------------

export function loadLocalDesign(): DesignSnapshot | null {
  try {
    return parseSnapshot(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveLocalDesign(snapshot: DesignSnapshot): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage unavailable — the editor keeps working, just without autosave.
  }
}

export function clearLocalDesign(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------
// View link — compressed snapshot in the hash. The hash never reaches the
// server, and needs no routing config on Vercel.
// ---------------------------------------------------------------------------

export function isViewHash(hash: string): boolean {
  return hash.startsWith(VIEW_HASH_PREFIX);
}

export function buildShareUrl(snapshot: DesignSnapshot): string {
  const encoded = compressToEncodedURIComponent(JSON.stringify(snapshot));
  return `${window.location.origin}${window.location.pathname}${VIEW_HASH_PREFIX}${encoded}`;
}

function decodeViewHash(hash: string): DesignSnapshot | null {
  try {
    return parseSnapshot(decompressFromEncodedURIComponent(hash.slice(VIEW_HASH_PREFIX.length)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Short view link — /v/<id>. vercel.json rewrites /v/* to index.html; the
// snapshot itself lives in Redis behind /api/share. Every failure resolves to
// null so callers can fall back (share button) or show the broken-link notice.
// ---------------------------------------------------------------------------

const SHORT_PATH_PREFIX = '/v/';
const SHARE_ID_RE = /^[0-9A-Za-z]{6,16}$/;
const SHARE_API = '/api/share';
const CREATE_TIMEOUT_MS = 6000;
const FETCH_TIMEOUT_MS = 12000;

/**
 * fetch with a timeout and an optional caller signal. Built by hand — the
 * AbortSignal.timeout/any helpers are missing on older iOS Safari, where a
 * throw here would surface to a customer as a "broken link".
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = window.setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** undefined = not a short-link path; null = short-link path with a malformed id. */
export function parseShortLinkPath(pathname: string): string | null | undefined {
  if (!pathname.startsWith(SHORT_PATH_PREFIX)) return undefined;
  const id = pathname.slice(SHORT_PATH_PREFIX.length).replace(/\/$/, '');
  return SHARE_ID_RE.test(id) ? id : null;
}

/** Stores the snapshot and returns /v/<id>, or null on any failure. */
export async function createShortShareUrl(snapshot: DesignSnapshot): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      SHARE_API,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) },
      CREATE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !SHARE_ID_RE.test(id)) return null;
    return `${window.location.origin}${SHORT_PATH_PREFIX}${id}`;
  } catch {
    return null;
  }
}

export async function fetchSharedDesign(id: string, signal?: AbortSignal): Promise<DesignSnapshot | null> {
  try {
    const res = await fetchWithTimeout(`${SHARE_API}?id=${encodeURIComponent(id)}`, {}, FETCH_TIMEOUT_MS, signal);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    // Re-validate: the catalog can change between when a link was made and now.
    return isValidSnapshot(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Read once at startup. A view hash or a /v/ path always means view mode —
 * even when broken. The hash is checked first so old links behave exactly as
 * before.
 */
export function readInitialDesign(): InitialDesign {
  const hash = window.location.hash;
  if (isViewHash(hash)) return { mode: 'view', design: decodeViewHash(hash) };
  const shareId = parseShortLinkPath(window.location.pathname);
  if (shareId !== undefined) return shareId ? { mode: 'view', design: null, shareId } : { mode: 'view', design: null };
  return { mode: 'edit', design: loadLocalDesign() };
}
