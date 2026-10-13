import { describe, it, expect } from 'vitest';
import { parseShortLinkPath } from './persistence';

describe('parseShortLinkPath', () => {
  it('extracts the id from /v/<id>', () => {
    expect(parseShortLinkPath('/v/aB3dE9xZ')).toBe('aB3dE9xZ');
    expect(parseShortLinkPath('/v/aB3dE9xZ/')).toBe('aB3dE9xZ');
  });
  it('flags a malformed id as a broken short link', () => {
    expect(parseShortLinkPath('/v/')).toBeNull();
    expect(parseShortLinkPath('/v/ab')).toBeNull();
    expect(parseShortLinkPath('/v/aB3d-9xZ')).toBeNull();
  });
  it('ignores every other path (editor, legacy hash links)', () => {
    expect(parseShortLinkPath('/')).toBeUndefined();
    expect(parseShortLinkPath('/view')).toBeUndefined();
  });
});
