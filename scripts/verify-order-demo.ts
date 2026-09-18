import assert from 'node:assert/strict';
import { createPublicClient, http, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Explicitly local-only acceptance. Never signs a public-network transaction.
const origin = 'http://127.0.0.1:4314';
const home = await fetch(origin);
assert.equal(home.status, 200);
const cookie = home.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
async function api(path: string, body?: unknown) {
  const r = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: cookie!, origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
const start = await api('/api/state');
assert.equal(start.network.chainId, 31337);
assert.equal(start.source, 'beefapi');
const account = privateKeyToAccount(`0x${'2'.padStart(64, '0')}`);
const challenge = await api('/api/partner/wallet/challenge', { address: account.address });
const signature = await account.signMessage({ message: challenge.message });
await api('/api/partner/wallet/verify', { address: account.address, signature });
const chain = await Bun.file('.local/chain.json').json();
const client = createPublicClient({ transport: http(chain.rpcUrl), cacheTime: 0 });
assert.equal(await client.getChainId(), 31337);
const balance = () => client.readContract({ address: chain.token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
const before = await balance();
const requestId = 'e2e-' + crypto.randomUUID();
const created = await api('/api/demo/orders', { request_id: requestId, payment_amount_minor: '1000' });
const paid = await api('/api/demo/orders/' + requestId + '/pay', {});
await api('/api/demo/orders/' + requestId + '/pay', {});
let state: any;
const deadline = Date.now() + 60000;
const prior = new Set(start.payouts.map((p: any) => p.id));
while (Date.now() < deadline) {
  state = await api('/api/state');
  if (state.payouts.some((p: any) => !prior.has(p.id) && p.status === 'completed')) break;
  await Bun.sleep(500);
}
const payout = state.payouts.find((p: any) => !prior.has(p.id) && p.status === 'completed');
assert.ok(payout);
assert.equal(payout.amount, '1000000');
assert.equal(payout.recipient.toLowerCase(), account.address.toLowerCase());
assert.equal((await balance()) - before, 1000000n);
await api('/api/demo/orders/' + requestId + '/pay', {});
await api('/api/admin/run', {});
assert.equal((await balance()) - before, 1000000n);
assert.equal(state.partner.pending, '0');
const result = { result: 'PASS', network: 'local EVM 31337', requestId, created, paid, payout, recipientBefore: String(before), recipientAfter: String(await balance()), sourceBalances: state.partner, checks: ['signed wallet binding', 'real BeefAPI test order', 'locked rate commission award', 'automatic payout', 'source completion', 'payment replay no duplicate'] };
await Bun.write('docs/evidence/order-demo-local.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
