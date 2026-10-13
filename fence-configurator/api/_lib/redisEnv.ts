/**
 * Finds the Upstash REST credentials in the environment. The Vercel
 * Marketplace integration names them KV_REST_API_*, plain Upstash setups use
 * UPSTASH_REDIS_REST_*, and connecting a store with a custom prefix prepends
 * it (e.g. STORAGE_KV_REST_API_URL). URL and token must share one prefix so
 * two connected stores can never be mixed.
 */

type Env = Record<string, string | undefined>;

const PAIRS = [
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
] as const;

export function resolveRedisEnv(env: Env): { url: string; token: string } | null {
  for (const [urlName, tokenName] of PAIRS) {
    // Unprefixed first, then prefixed in a stable order.
    const urlKeys = Object.keys(env)
      .filter((k) => k === urlName || k.endsWith(`_${urlName}`))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    for (const urlKey of urlKeys) {
      const url = env[urlKey];
      const token = env[urlKey.slice(0, -urlName.length) + tokenName];
      if (url && token) return { url, token };
    }
  }
  return null;
}

/** Names only, never values — returned by the 503 so a misconfiguration can be diagnosed from a browser. */
export function redisEnvNames(env: Env): string[] {
  return Object.keys(env)
    .filter((k) => /KV_|REDIS|UPSTASH/.test(k))
    .sort();
}
