import { describe, expect, it } from 'bun:test';
import { canAccessConsolePath } from './source-support';

describe('console path guards', () => {
  it('allows shared settlement records for both roles', () => {
    expect(canAccessConsolePath('merchant', '/console/settlements')).toBe(true);
    expect(canAccessConsolePath('promoter', '/console/settlements')).toBe(true);
    expect(canAccessConsolePath('merchant', '/console')).toBe(true);
  });
});
