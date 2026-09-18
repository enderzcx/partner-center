import { describe, expect, it } from 'bun:test';
import {
  formatCommissionPercent,
  parseCommissionRate,
  precise,
  rateCopy,
  usdMinor,
} from './format';
import {
  canAccessConsolePath,
  canShowBind,
  fixtureMutationsOpen,
  sidebarItemsFor,
} from './source-support';

describe('money formatters', () => {
  it('formats locked commission percents without inventing a fallback', () => {
    expect(parseCommissionRate('0.1')).toBe('0.1');
    expect(formatCommissionPercent('0.1')).toBe('10');
    expect(parseCommissionRate('nope')).toBe(null);
    expect(precise('10000000')).toBe('10.00');
    expect(usdMinor('1000')).toBe('10.00');
  });

  it('explains unread and zero rates without claiming 10%', () => {
    expect(rateCopy({ rate: null, rateSource: 'unavailable' }).value).toBe(
      '无法读取',
    );
    expect(rateCopy({ rate: '0', rateSource: 'disabled' }).rule).toContain(
      '不产生新返佣',
    );
  });
});

describe('route and source guards', () => {
  it('keeps merchant and promoter pages apart', () => {
    expect(canAccessConsolePath('merchant', '/console/orders')).toBe(true);
    expect(canAccessConsolePath('promoter', '/console/orders')).toBe(false);
    expect(canAccessConsolePath('promoter', '/console/wallet')).toBe(true);
    expect(canAccessConsolePath('merchant', '/console/wallet')).toBe(false);
  });

  it('hides auto and transfer when auth is required', () => {
    expect(
      fixtureMutationsOpen({ source: 'fixture', authEnabled: true }),
    ).toBe(false);
    expect(
      fixtureMutationsOpen({ source: 'fixture', authEnabled: false }),
    ).toBe(true);
    expect(canShowBind({ source: 'beefapi', orderDemo: true })).toBe(true);
    expect(canShowBind({ source: 'beefapi', orderDemo: false })).toBe(false);
  });

  it('only lists order nav when the current source has order demo', () => {
    const items = sidebarItemsFor('merchant', { orderDemo: true });
    expect(items.some((item) => item.to === '/console/orders')).toBe(true);
    expect(
      sidebarItemsFor('merchant', { orderDemo: false }).some(
        (item) => item.to === '/console/orders',
      ),
    ).toBe(false);
  });
});
