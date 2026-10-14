/**
 * Before/after sizes of real share records. Not part of the suite — runs
 * only when SHARES_DIR points at a folder of raw share bodies, one file per
 * key (e.g. ZFwQTfiv.json, saved from GET /api/share?id=… or from Upstash):
 *
 *   SHARES_DIR=./shares npm run measure:shares
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { migrateSnapshot, isValidSnapshot, type DesignSnapshot } from '../src/app/snapshot';
import { bakeShareSnapshot } from '../src/app/bakeSnapshot';

const dir = process.env.SHARES_DIR;
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe.skipIf(!dir)('share sizes, before → after re-saving as v3', () => {
  it('measures every file in SHARES_DIR', () => {
    const rows = readdirSync(dir!)
      .filter((f) => f.endsWith('.json'))
      .map((file) => {
        const raw = readFileSync(join(dir!, file), 'utf8').trim();
        const parsed: unknown = JSON.parse(raw);
        const opened = migrateSnapshot(parsed);
        expect(isValidSnapshot(opened), file).toBe(true);
        const baked = bakeShareSnapshot(opened as DesignSnapshot);
        const after = baked ? JSON.stringify(baked) : JSON.stringify(opened);
        const d = opened as DesignSnapshot;
        return {
          key: file.replace(/\.json$/, ''),
          v: (parsed as { v: number }).v,
          legs: d.shape.legs.length,
          rules: d.colorScheme.boardRules.length + d.profileScheme.rules.length + d.profileScheme.spacerRules.length,
          before: bytes(raw),
          beforeGzip: gzipSync(raw).length,
          after: bytes(after),
          saved: `${((1 - bytes(after) / bytes(raw)) * 100).toFixed(1)}%`,
          v3: !!baked,
          json: after,
        };
      });
    console.table(rows.map(({ json: _json, ...r }) => r));
    for (const r of rows) console.log(`${r.key} (v3):\n${r.json}\n`);
  });
});
