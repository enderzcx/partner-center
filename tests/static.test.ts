import { expect, test } from 'bun:test';
import { staticFileFor } from '../src/static.ts';

test('SPA page refreshes resolve while API and removed product routes do not', () => {
  for (const path of ['/', '/login', '/console', '/console/orders', '/console/settlements', '/console/wallet', '/docs']) {
    expect(staticFileFor(path)?.file).toBe('index.html');
  }
  for (const path of ['/api/state', '/api/unknown', '/console/token', '/console/topup', '/pricing', '/missing']) {
    expect(staticFileFor(path)).toBeNull();
  }
});

test('built assets are constrained to public types and safe relative paths', () => {
  expect(staticFileFor('/assets/index-AbC12.js')?.type).toContain('javascript');
  expect(staticFileFor('/assets/index-AbC12.css')?.type).toContain('text/css');
  expect(staticFileFor('/fonts/schibsted-latin.woff2')?.type).toBe('font/woff2');
  expect(staticFileFor('/images/partner/receipt.webp')?.type).toBe('image/webp');
  for (const path of ['/assets/../secret.js', '/assets/%2e%2e/secret.js', '/assets/%2fsecret.js', '/assets/index.js.map', '/assets/.env', '/src/server.ts', '/assets/source.ts', '/assets/dir\\secret.js']) {
    expect(staticFileFor(path)).toBeNull();
  }
});
