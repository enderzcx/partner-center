import assert from "node:assert/strict";
import { createPublicClient, defineChain, http, parseAbi } from "viem";

// Black-box acceptance against the running LOCAL app and a real local EVM.
// It never operates Fuji or real data. Run once against a fresh fixture app.
const origin = process.env.SETTLEMENT_VERIFY_URL ?? "http://127.0.0.1:4311";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw new Error("Local URL required");
const home = await fetch(origin);
assert.equal(home.status, 200);
const cookie = home.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "session cookie required");
const request = async (path: string, body?: unknown) => {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
};
assert.equal((await fetch(origin + "/api/state")).status, 401);
const crossOrigin = await fetch(origin + "/api/admin/pause", {
  method: "POST",
  headers: {
    cookie,
    origin: "https://untrusted.example",
    "content-type": "application/json",
  },
  body: '{"paused":false}',
});
assert.equal(crossOrigin.status, 403);
const start = await request("/api/state");
assert.equal(start.network.chainId, 31337, "Never run this acceptance on Fuji");
const config = await Bun.file(".local/chain.json").json();
const chain = defineChain({
  id: 31337,
  name: "local",
  nativeCurrency: { name: "test", symbol: "TEST", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const client = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
  cacheTime: 0,
});
const abi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
const balance = () =>
  client.readContract({
    address: config.token,
    abi,
    functionName: "balanceOf",
    args: [config.recipient],
  });
const before = await balance();
let expectedAmount = 10_000_000n;
if (start.source === "fixture") {
  await request("/api/demo/wallet", {});
  await request("/api/partner/auto", { enabled: true });
  await request("/api/demo/commission", { amount: expectedAmount.toString() });
} else {
  assert.equal(start.source, "beefapi");
  const settings = Object.fromEntries(
    (await Bun.file(".local/beefapi.env").text())
      .trim()
      .split("\n")
      .map((line) =>
        line
          .replace(/^export /, "")
          .split(/=(.*)/s)
          .slice(0, 2),
      ),
  );
  const sourceUrl = settings.BEEFAPI_TEST_BASE_URL;
  assert.equal(new URL(sourceUrl).hostname, "127.0.0.1");
  const reserved = await fetch(
    sourceUrl + "/api/settlement-test/reservations",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + settings.SETTLEMENT_TEST_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        request_id: "acceptance-" + crypto.randomUUID(),
        user_id: 1,
        recipient: config.recipient,
        amount_usdc: expectedAmount.toString(),
      }),
    },
  );
  assert.equal(reserved.status, 200);
  const sourceRow = await reserved.json();
  assert.equal(sourceRow.data.status, "reserved");
}
await request("/api/admin/pause", { paused: false });
const prior = new Set(
  start.payouts
    .filter((p: any) => p.status === "completed")
    .map((p: any) => p.id),
);
let final;
const deadline = Date.now() + 100000;
while (Date.now() < deadline) {
  // Normal completion must be driven by the scheduler, with no administrator trigger.
  final = await request("/api/state");
  if (
    final.payouts.some((p: any) => p.status === "completed" && !prior.has(p.id))
  )
    break;
  await Bun.sleep(500);
}
const paid = final?.payouts.find(
  (p: any) => p.status === "completed" && !prior.has(p.id),
);
assert.ok(paid, "Payout must complete in deadline");
assert.equal(paid.amount, expectedAmount.toString());
assert.equal(paid.recipient.toLowerCase(), config.recipient.toLowerCase());
assert.equal(
  (await balance()) - before,
  expectedAmount,
  "recipient on-chain delta",
);
assert.equal(final.partner.pending, "0", "source reservation completed");
const hash = paid.txHash;
for (let i = 0; i < 3; i++) await request("/api/admin/run", {});
assert.equal(
  (await balance()) - before,
  expectedAmount,
  "repeated tick cannot pay again",
);
assert.equal(
  (await request("/api/state")).payouts.find((p: any) => p.id === paid.id)
    .txHash,
  hash,
);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      source: start.source,
      network: "local EVM 31337",
      payoutId: paid.id,
      transactionHash: hash,
      amountMicroUSDC: paid.amount,
      recipient: paid.recipient,
      checks: [
        "cookie auth",
        "cross-origin denial",
        "automatic settlement",
        "real token delta",
        "source completion",
        "repeat tick no double payment",
      ],
    },
    null,
    2,
  ),
);
