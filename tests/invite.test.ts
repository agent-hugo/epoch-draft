import { describe, expect, it } from 'vitest';
import { decodeInvite, inviteHash } from '../src/ui/invite';

describe('invite links', () => {
  it('is a plain room link without a token', () => {
    expect(inviteHash('ABC12')).toBe('room=ABC12');
  });

  it('packs room and token into one base64url parameter', () => {
    const token = 'FlespiToken a+b/c=d&e?ü';
    const hash = inviteHash('ABC12', token);
    expect(hash).toMatch(/^i=[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain('Flespi');
    const i = new URLSearchParams(hash).get('i');
    expect(decodeInvite(i)).toEqual({ room: 'ABC12', token });
  });

  it('ignores missing or malformed data', () => {
    expect(decodeInvite(null)).toEqual({});
    expect(decodeInvite('%%%')).toEqual({});
  });
});
