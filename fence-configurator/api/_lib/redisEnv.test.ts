import { describe, it, expect } from 'vitest';
import { resolveRedisEnv, redisEnvNames } from './redisEnv.js';

describe('resolveRedisEnv', () => {
  it('reads the Marketplace names', () => {
    expect(resolveRedisEnv({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' })).toEqual({ url: 'u', token: 't' });
  });
  it('reads plain Upstash names', () => {
    expect(resolveRedisEnv({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' })).toEqual({ url: 'u', token: 't' });
  });
  it('reads names with a custom prefix', () => {
    expect(resolveRedisEnv({ STORAGE_KV_REST_API_URL: 'u', STORAGE_KV_REST_API_TOKEN: 't' })).toEqual({ url: 'u', token: 't' });
  });
  it('never pairs a URL with a token from a different prefix', () => {
    expect(resolveRedisEnv({ A_KV_REST_API_URL: 'u', B_KV_REST_API_TOKEN: 't' })).toBeNull();
  });
  it('ignores the read-only token', () => {
    expect(resolveRedisEnv({ KV_REST_API_URL: 'u', KV_REST_API_READ_ONLY_TOKEN: 'r' })).toBeNull();
  });
  it('prefers unprefixed names', () => {
    const env = { X_KV_REST_API_URL: 'xu', X_KV_REST_API_TOKEN: 'xt', KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' };
    expect(resolveRedisEnv(env)).toEqual({ url: 'u', token: 't' });
  });
});

describe('redisEnvNames', () => {
  it('lists related names only', () => {
    expect(redisEnvNames({ KV_URL: 'x', REDIS_URL: 'y', PATH: 'z', VERCEL_ENV: 'p' })).toEqual(['KV_URL', 'REDIS_URL']);
  });
});
