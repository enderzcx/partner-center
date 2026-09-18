import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toHex, type Hex } from 'viem';
import { runtimeConfig, runtimeFingerprint, type RuntimeConfig } from '../src/config.ts';
import { createApp, type SettlementApp } from '../src/server.ts';
import {
  commissionFromBalances,
  createBeefApiSource,
  createFixtureSource,
  formatCommissionPercent,
} from '../src/source.ts';
import { createStore } from '../src/store.ts';
import { type Chain, type Payout, type Prepared } from '../src/types.ts';
import { createWorker } from '../src/worker.ts';

const TOKEN = '0x0000000000000000000000000000000000000001' as const;
const CONTRACT = '0x0000000000000000000000000000000000000002' as const;
const RECIPIENT = '0x0000000000000000000000000000000000000003' as const;
const KEY = `0x${'1'.padStart(64, '0')}` as Hex;

class MockChain implements Chain {
  inspectResult: 'pending' | 'confirmed' | 'reverted' = 'confirmed';
  nonce = 0n;
  async prepare(p: Payout): Promise<Prepared> {
    return {
      rawTransaction: keccak256(toHex(`raw:${p.id}:${this.nonce++}`)),
      hash: keccak256(toHex(`hash:${p.id}:${this.nonce}`)),
    };
  }
  async broadcast() {}
  async inspect() {
    return this.inspectResult;
  }
  async balances() {
    return { token: '42', gas: '99' };
  }
}

const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length) closers.pop()?.();
});

function hostOf(app: SettlementApp) {
  return new URL(app.origin).host;
}

async function open(app: SettlementApp) {
  const res = await app.fetch(new Request(`${app.origin}/`, { headers: { Host: hostOf(app) } }));
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!sid) throw new Error('missing session cookie');
  return sid;
}

function req(app: SettlementApp, path: string, init: RequestInit & { sid?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('Host', hostOf(app));
  if (init.sid) headers.set('Cookie', `sid=${init.sid}`);
  if (init.method === 'POST') headers.set('Origin', app.origin);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return app.fetch(new Request(`${app.origin}${path}`, { ...init, headers }));
}

function partnerServer(handler: {
  partner?: Record<string, unknown> | null;
  partnerStatus?: number;
  reservations?: unknown[];
  complete?: (body: Record<string, unknown>) => unknown;
}) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/settlement-test/partners/')) {
        if (handler.partnerStatus) {
          return new Response('no', { status: handler.partnerStatus });
        }
        if (!handler.partner) return new Response('no', { status: 404 });
        return Response.json({ success: true, data: handler.partner });
      }
      if (url.pathname === '/api/settlement-test/reservations' && req.method === 'GET') {
        return Response.json({ success: true, data: handler.reservations ?? [] });
      }
      if (url.pathname.endsWith('/complete') && req.method === 'POST' && handler.complete) {
        const body = (await req.json()) as Record<string, unknown>;
        return Response.json({ success: true, data: handler.complete(body) });
      }
      return new Response('no', { status: 404 });
    },
  });
  closers.push(() => server.stop(true));
  return server;
}

function boot(extra: Partial<RuntimeConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'settlement-rate-'));
  const publicDir = join(dir, 'public');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), '<html><body>ok</body></html>');
  writeFileSync(join(publicDir, 'app.js'), 'window.__settlement=1;');
  writeFileSync(join(publicDir, 'style.css'), 'body{margin:0}');
  const chain = new MockChain();
  const config = runtimeConfig({
    port: 4311,
    chain: extra.chain ?? {
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      contract: CONTRACT,
      token: TOKEN,
      privateKey: KEY,
      recipient: RECIPIENT,
    },
    publicDir,
    dbPath: join(dir, 'db.sqlite'),
    lockPath: join(dir, 'lock'),
    minAmount: 1_000_000n,
    maturityMs: 0,
    source: extra.source ?? 'fixture',
    beefapiBaseUrl: extra.beefapiBaseUrl ?? '',
    beefapiToken: extra.beefapiToken ?? 't'.repeat(32),
    partnerUserId: extra.partnerUserId ?? 7,
    ...extra,
  });
  const store = createStore({
    path: join(dir, 'db.sqlite'),
    fingerprint: runtimeFingerprint(config),
  });
  closers.push(() => store.close());
  const source = extra.source === 'beefapi' ? createBeefApiSource(store, config) : createFixtureSource(store);
  const worker = createWorker({ store, chain, source, config });
  const app = createApp({ store, worker, chain, source, config, publicDir });
  return { app, store, chain, source, worker, config };
}

function moneyEnvelope(extra: Record<string, unknown> = {}) {
  return {
    available_usdc: '1000000',
    pending_usdc: '2000000',
    paid_usdc: '3000000',
    ...extra,
  };
}

test('fixture source exposes demo 10% and state does not treat demo input as order payment', async () => {
  const { app, store, source } = boot();
  const balances = await source.balances();
  expect(balances?.commissionRate).toBe('0.1');
  expect(balances?.commissionRateSource).toBe('demo');
  expect(formatCommissionPercent(balances!.commissionRate!)).toBe('10');
  expect(commissionFromBalances('fixture', balances)).toEqual({
    rate: '0.1',
    scope: 'demo',
    rateSource: 'demo',
    basis: 'actual_payment',
    lockedAt: 'order_creation',
  });
  expect(
    commissionFromBalances('fixture', {
      available: '1',
      pending: '0',
      paid: '0',
      consumed: '0',
    }).rate,
  ).toBeNull();

  const sid = await open(app);
  const added = await req(app, '/api/demo/commission', {
    sid,
    method: 'POST',
    body: JSON.stringify({ amount: '10000000' }),
  });
  expect(added.status).toBe(200);
  expect(store.getPartner().available).toBe(10_000_000n);

  const state = await (await req(app, '/api/state', { sid })).json();
  expect(state.commission).toEqual({
    rate: '0.1',
    scope: 'demo',
    rateSource: 'demo',
    basis: 'actual_payment',
    lockedAt: 'order_creation',
  });
  expect(state.partner.available).toBe('10000000');
  expect(state.commission.rate).not.toBeNull();
});

test('source 12.5% override is read from the existing partners fetch', async () => {
  const server = partnerServer({
    partner: moneyEnvelope({
      commission_rate: '0.125',
      commission_rate_source: 'override',
    }),
  });
  const { app, source } = boot({
    source: 'beefapi',
    beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
  });
  const balances = await source.balances();
  expect(balances).toEqual({
    available: '1000000',
    pending: '2000000',
    paid: '3000000',
    consumed: '',
    commissionRate: '0.125',
    commissionRateSource: 'override',
  });
  expect(formatCommissionPercent(balances!.commissionRate!)).toBe('12.5');

  const sid = await open(app);
  const state = await (await req(app, '/api/state', { sid })).json();
  expect(state.commission).toEqual({
    rate: '0.125',
    scope: 'global',
    rateSource: 'override',
    basis: 'actual_payment',
    lockedAt: 'order_creation',
  });
  expect(state.partner.available).toBe('1000000');
});

test('explicit zero is a disabled rate, not a missing rate', async () => {
  const server = partnerServer({
    partner: moneyEnvelope({
      commission_rate: '0',
      commission_rate_source: 'disabled',
    }),
  });
  const { app, source } = boot({
    source: 'beefapi',
    beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
  });
  const balances = await source.balances();
  expect(balances?.commissionRate).toBe('0');
  expect(balances?.commissionRateSource).toBe('disabled');
  expect(formatCommissionPercent('0')).toBe('0');
  expect(commissionFromBalances('beefapi', balances).rate).toBe('0');
  expect(commissionFromBalances('beefapi', balances).rateSource).toBe('disabled');

  const sid = await open(app);
  const state = await (await req(app, '/api/state', { sid })).json();
  expect(state.commission.rate).toBe('0');
  expect(state.commission.rate).not.toBeNull();
  expect(state.commission.rateSource).toBe('disabled');
  expect(state.partner.paid).toBe('3000000');
});

test('missing malformed or unavailable metadata is null, never 10 percent, and keeps valid balances', async () => {
  const cases: Array<{ partner?: Record<string, unknown> | null; partnerStatus?: number; label: string }> = [
    { partner: moneyEnvelope(), label: 'missing fields' },
    {
      partner: moneyEnvelope({ commission_rate: '0.1', commission_rate_source: 'nope' }),
      label: 'bad source',
    },
    {
      partner: moneyEnvelope({ commission_rate: '10', commission_rate_source: 'default' }),
      label: 'rate above one',
    },
    {
      partner: moneyEnvelope({ commission_rate: '0.1e1', commission_rate_source: 'default' }),
      label: 'scientific',
    },
    {
      partner: moneyEnvelope({ commission_rate: 0.1, commission_rate_source: 'default' }),
      label: 'numeric rate',
    },
    {
      partner: moneyEnvelope({ commission_rate: '0.1' }),
      label: 'rate without source',
    },
    {
      partner: moneyEnvelope({ commission_rate_source: 'default' }),
      label: 'source without rate',
    },
    {
      partner: moneyEnvelope({ commission_rate: '0.1', commission_rate_source: 'demo' }),
      label: 'demo is not a live source',
    },
    { partner: null, partnerStatus: 503, label: 'unavailable' },
  ];

  for (const item of cases) {
    const server = partnerServer({ partner: item.partner, partnerStatus: item.partnerStatus });
    const { app, source } = boot({
      source: 'beefapi',
      beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
    });
    const balances = await source.balances();
    if (item.partnerStatus) {
      expect(balances).toBeNull();
    } else {
      expect(balances?.available).toBe('1000000');
      expect(balances?.pending).toBe('2000000');
      expect(balances?.paid).toBe('3000000');
      expect(balances?.commissionRate).toBeUndefined();
      expect(balances?.commissionRateSource).toBeUndefined();
    }
    const resolved = commissionFromBalances('beefapi', balances);
    expect(resolved.rate).toBeNull();
    expect(resolved.rateSource).toBe('unavailable');
    expect(resolved.rate).not.toBe('0.1');
    expect(formatCommissionPercent('0.1')).toBe('10');

    const sid = await open(app);
    const state = await (await req(app, '/api/state', { sid })).json();
    expect(state.commission.rate).toBeNull();
    expect(state.commission.rateSource).toBe('unavailable');
    expect(state.commission.scope).toBe('global');
    expect(JSON.stringify(state.commission)).not.toContain('"0.1"');
    if (!item.partnerStatus) {
      expect(state.partner.available).toBe('1000000');
    }
  }
});

test('current rate metadata does not change an already frozen payout amount', async () => {
  const reservation = {
    id: 11,
    request_id: 'r1',
    user_id: 7,
    recipient: RECIPIENT,
    amount_usdc: '2500000',
    status: 'reserved',
    created_at: Math.floor(Date.now() / 1000),
    chain_id: 31337,
    token: TOKEN,
  };
  let partner = moneyEnvelope({
    available_usdc: '0',
    pending_usdc: '2500000',
    paid_usdc: '0',
    commission_rate: '0.125',
    commission_rate_source: 'override',
  });
  const server = partnerServer({
    get partner() {
      return partner;
    },
    reservations: [reservation],
    complete(body) {
      return {
        ...reservation,
        status: 'completed',
        transaction_hash: body.transaction_hash,
        amount_usdc: '2500000',
      };
    },
  });
  const { app, store, worker } = boot({
    source: 'beefapi',
    beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
  });
  await worker.tick();
  expect(store.listPayouts()).toHaveLength(1);
  expect(store.listPayouts()[0].amount).toBe(2_500_000n);
  expect(store.listPayouts()[0].status).toBe('completed');

  partner = moneyEnvelope({
    available_usdc: '0',
    pending_usdc: '0',
    paid_usdc: '2500000',
    commission_rate: '0',
    commission_rate_source: 'disabled',
  });
  const sid = await open(app);
  const state = await (await req(app, '/api/state', { sid })).json();
  expect(state.commission.rate).toBe('0');
  expect(state.commission.rateSource).toBe('disabled');
  expect(state.payouts).toHaveLength(1);
  expect(state.payouts[0].amount).toBe('2500000');
  expect(state.partner.paid).toBe('2500000');
});

test('partners success envelope with new rate fields still returns source balances', async () => {
  const server = partnerServer({
    partner: moneyEnvelope({
      commission_rate: '0.1',
      commission_rate_source: 'default',
    }),
  });
  const { source } = boot({
    source: 'beefapi',
    beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
  });
  const balances = await source.balances();
  expect(balances?.available).toBe('1000000');
  expect(balances?.pending).toBe('2000000');
  expect(balances?.paid).toBe('3000000');
  expect(balances?.commissionRate).toBe('0.1');
  expect(balances?.commissionRateSource).toBe('default');
  expect(commissionFromBalances('beefapi', balances).rateSource).toBe('default');
});
