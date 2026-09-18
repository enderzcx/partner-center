import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, keccak256, recoverTypedDataAddress, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader as decodeOfficialRequired,
  x402HTTPClient,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { hashSessionToken } from "../src/auth.ts";
import {
  CIRCLE_FUJI_USDC,
  DEFAULT_X402_FACILITATOR_URL,
  loadConfig,
  runtimeConfig,
  runtimeFingerprint,
  X402_NETWORK,
  type RuntimeConfig,
} from "../src/config.ts";
import { createApp, type SettlementApp } from "../src/server.ts";
import { orderReservationRequestId } from "../src/source.ts";
import { createStore } from "../src/store.ts";
import {
  type Address,
  type Chain,
  type Payout,
  type Prepared,
  type Source,
  type SourceOrder,
  ServiceError,
} from "../src/types.ts";
import { createWorker } from "../src/worker.ts";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type X402Chain,
  type X402Facilitator,
  type X402PaymentPayload,
  type X402ReceiptResult,
  type X402SettleResult,
} from "../src/x402/index.ts";
import {
  X402_TOKEN_NAME,
  X402_TOKEN_VERSION,
  type X402PaymentRequirements,
} from "../src/x402/types.ts";

const CONTRACT = "0x0000000000000000000000000000000000000002" as const;
const RECIPIENT = "0x0000000000000000000000000000000000000003" as Address;
const OTHER = "0x0000000000000000000000000000000000000004" as Address;
const KEY = `0x${"1".padStart(64, "0")}` as Hex;
const GOOD_TX = keccak256(toHex("x402-good"));
const FAKE_TX = keccak256(toHex("x402-fake"));

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

class MockPayoutChain implements Chain {
  inspectResult: "pending" | "confirmed" | "reverted" = "confirmed";
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
    return { token: "42", gas: "99" };
  }
}

class MockX402Chain implements X402Chain {
  chainId = 43113;
  blockNumber = 1_000n;
  receipts = new Map<string, X402ReceiptResult>();
  found: Hex | null = null;
  inspectCalls: Hex[] = [];
  findCalls = 0;
  async getBlockNumber() {
    return this.blockNumber;
  }
  async getChainId() {
    return this.chainId;
  }
  async inspectReceipt(input: {
    txHash: Hex;
    token: Address;
    payTo: Address;
    payer: Address;
    amount: bigint;
    nonce: Hex;
  }) {
    this.inspectCalls.push(input.txHash);
    return (
      this.receipts.get(input.txHash.toLowerCase()) ?? {
        ok: false as const,
        reason: "missing" as const,
      }
    );
  }
  async findAuthorization() {
    this.findCalls += 1;
    return this.found;
  }
}

class MockFacilitator implements X402Facilitator {
  settleCalls = 0;
  result: X402SettleResult = {
    kind: "success",
    transaction: GOOD_TX,
    network: X402_NETWORK,
  };
  lastPayload: X402PaymentPayload | null = null;
  async settle(payload: X402PaymentPayload) {
    this.settleCalls += 1;
    this.lastPayload = payload;
    return this.result;
  }
}

type MockOrders = Source & {
  reserves: Array<{ requestId: string; recipient: string; amountUsdc: string }>;
  payCalls: number;
  reserveCalls: number;
  setPayFail: (message: string | null) => void;
  setPayCommission: (value: string) => void;
};

function mockOrderSource(init?: { payCommission?: string }): MockOrders {
  const orders = new Map<string, SourceOrder>();
  const reserves: MockOrders["reserves"] = [];
  let payCommission = init?.payCommission ?? "1000000";
  let payFail: string | null = null;
  return {
    kind: "beefapi",
    reserves,
    payCalls: 0,
    reserveCalls: 0,
    setPayFail(message) {
      payFail = message;
    },
    setPayCommission(value) {
      payCommission = value;
    },
    async pull() {
      return [];
    },
    async complete() {},
    async balances() {
      return {
        available: "0",
        pending: "0",
        paid: "0",
        consumed: "",
        commissionRate: "0.1",
        commissionRateSource: "default",
      };
    },
    lastError() {
      return null;
    },
    async listOrders() {
      return [...orders.values()];
    },
    async createOrder({ requestId, paymentAmountMinor }) {
      const existing = orders.get(requestId);
      if (existing) return existing;
      const order: SourceOrder = {
        requestId,
        tradeNo: `T${requestId.replaceAll("-", "").slice(0, 12)}`,
        paymentAmountMinor,
        commissionRate: "0.1",
        commissionUsdc: "0",
        status: "pending",
      };
      orders.set(requestId, order);
      return order;
    },
    async payOrder(requestId) {
      this.payCalls += 1;
      if (payFail) throw new ServiceError(502, payFail);
      const order = orders.get(requestId);
      if (!order) throw new ServiceError(404, "找不到该订单。");
      if (order.status === "paid") return order;
      const paid: SourceOrder = {
        ...order,
        status: "paid",
        commissionUsdc: payCommission,
      };
      orders.set(requestId, paid);
      return paid;
    },
    async reserveFrozen(input) {
      this.reserveCalls += 1;
      const prev = reserves.find((row) => row.requestId === input.requestId);
      if (prev) {
        if (
          prev.recipient.toLowerCase() !== input.recipient.toLowerCase() ||
          prev.amountUsdc !== input.amountUsdc
        ) {
          throw new ServiceError(409, "同一来源的金额或收款地址不能更改。");
        }
        return {
          sourceId: `beefapi:${input.requestId}:1`,
          recipient: input.recipient,
          amount: BigInt(input.amountUsdc),
          createdAt: Date.now(),
          alreadyFrozen: true,
          requestId: input.requestId,
          numericId: 1,
        };
      }
      reserves.push({
        requestId: input.requestId,
        recipient: input.recipient,
        amountUsdc: input.amountUsdc,
      });
      return {
        sourceId: `beefapi:${input.requestId}:${reserves.length}`,
        recipient: input.recipient,
        amount: BigInt(input.amountUsdc),
        createdAt: Date.now(),
        alreadyFrozen: true,
        requestId: input.requestId,
        numericId: reserves.length,
      };
    },
  };
}

const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length) closers.pop()?.();
});

function hostOf(app: SettlementApp) {
  return new URL(app.origin).host;
}

async function open(app: SettlementApp) {
  const res = await app.fetch(
    new Request(`${app.origin}/`, { headers: { Host: hostOf(app) } }),
  );
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  if (!sid) throw new Error("missing session cookie");
  return sid;
}

function req(
  app: SettlementApp,
  path: string,
  init: RequestInit & {
    sid?: string;
    origin?: string | null;
    paymentSignature?: string;
  } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Host", hostOf(app));
  if (init.sid) headers.set("Cookie", `sid=${init.sid}`);
  if (init.origin !== null && (init.method === "POST" || init.origin)) {
    headers.set("Origin", init.origin ?? app.origin);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.paymentSignature) {
    headers.set(PAYMENT_SIGNATURE_HEADER, init.paymentSignature);
  }
  return app.fetch(new Request(`${app.origin}${path}`, { ...init, headers }));
}

function harness(
  extra: Partial<RuntimeConfig> = {},
  source?: MockOrders,
  deps?: { facilitator?: MockFacilitator; x402Chain?: MockX402Chain; now?: () => number },
) {
  const dir = mkdtempSync(join(tmpdir(), "settlement-x402-"));
  const publicDir = join(dir, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "index.html"), "<html><body>ok</body></html>");
  writeFileSync(join(publicDir, "app.js"), "window.__settlement=1;");
  writeFileSync(join(publicDir, "style.css"), "body{margin:0}");
  const chain = new MockPayoutChain();
  const config = runtimeConfig({
    port: 4311,
    chain: extra.chain ?? {
      rpcUrl: "https://example.invalid",
      chainId: 43113,
      contract: CONTRACT,
      token: CIRCLE_FUJI_USDC,
      privateKey: KEY,
    },
    publicDir,
    dbPath: join(dir, "db.sqlite"),
    lockPath: join(dir, "lock"),
    minAmount: 1_000_000n,
    maturityMs: 0,
    source: extra.source ?? "beefapi",
    orderDemo: extra.orderDemo ?? true,
    beefapiBaseUrl: extra.beefapiBaseUrl ?? "http://127.0.0.1:9",
    beefapiToken: extra.beefapiToken ?? "t".repeat(32),
    partnerUserId: extra.partnerUserId ?? 1,
    x402Enabled: extra.x402Enabled ?? true,
    ...extra,
  });
  const store = createStore({
    path: join(dir, "db.sqlite"),
    fingerprint: runtimeFingerprint(config),
    now: deps?.now,
  });
  closers.push(() => store.close());
  const src = source ?? mockOrderSource();
  const worker = createWorker({ store, chain, source: src, config, now: deps?.now });
  const facilitator = deps?.facilitator ?? new MockFacilitator();
  const x402Chain = deps?.x402Chain ?? new MockX402Chain();
  x402Chain.receipts.set(GOOD_TX.toLowerCase(), {
    ok: true,
    txHash: GOOD_TX,
    blockNumber: 1001n,
  });
  x402Chain.receipts.set(FAKE_TX.toLowerCase(), {
    ok: false,
    reason: "mismatch",
  });
  const app = createApp({
    store,
    worker,
    chain,
    source: src,
    config,
    publicDir,
    now: deps?.now ?? store.now,
    x402Facilitator: facilitator,
    x402Chain,
  });
  return { app, store, chain, source: src, worker, config, dir, facilitator, x402Chain };
}

function requirements(amount = "10000000"): X402PaymentRequirements {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    amount,
    asset: getAddress(CIRCLE_FUJI_USDC),
    payTo: getAddress(CONTRACT),
    maxTimeoutSeconds: 300,
    extra: { name: X402_TOKEN_NAME, version: X402_TOKEN_VERSION },
  };
}

async function signPayload(input: {
  account: ReturnType<typeof privateKeyToAccount>;
  origin: string;
  requestId: string;
  nowSec?: number;
  amount?: string;
  to?: Address;
  network?: string;
  nonce?: Hex;
  validBefore?: string;
  validAfter?: string;
  signature?: Hex;
}) {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const nonce =
    input.nonce ??
    (`0x${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}` as Hex);
  const amount = input.amount ?? "10000000";
  const to = input.to ?? (getAddress(CONTRACT) as Address);
  const authorization = {
    from: getAddress(input.account.address) as Address,
    to,
    value: amount,
    validAfter: input.validAfter ?? "0",
    validBefore: input.validBefore ?? String(nowSec + 300),
    nonce,
  };
  const signature =
    input.signature ??
    (await input.account.signTypedData({
      domain: {
        name: X402_TOKEN_NAME,
        version: X402_TOKEN_VERSION,
        chainId: 43113,
        verifyingContract: getAddress(CIRCLE_FUJI_USDC),
      },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    }));
  const accepted = {
    ...requirements(amount),
    network: (input.network ?? X402_NETWORK) as typeof X402_NETWORK,
    payTo: getAddress(CONTRACT),
  };
  const payload: X402PaymentPayload = {
    x402Version: 2,
    resource: {
      url: `${input.origin}/api/x402/orders/${input.requestId}/pay`,
      description: "测试订单付款",
      mimeType: "application/json",
    },
    accepted,
    payload: { signature, authorization },
  };
  return {
    payload,
    header: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    nonce,
  };
}

async function createPending(app: SettlementApp, sid: string, store = undefined as ReturnType<typeof createStore> | undefined) {
  if (store) store.setWallet(RECIPIENT);
  const created = await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" });
  expect(created.status).toBe(200);
  const body = (await created.json()) as { order: { requestId: string; payment?: { status: string } } };
  return body.order;
}

test("x402 is off by default and only Fuji beefapi order demo may enable it", () => {
  const dir = mkdtempSync(join(tmpdir(), "settlement-x402-cfg-"));
  writeFileSync(
    join(dir, "chain.json"),
    JSON.stringify({
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 31337,
      contract: CONTRACT,
      token: "0x0000000000000000000000000000000000000001",
      privateKey: KEY,
    }),
  );
  const off = loadConfig({
    cwd: dir,
    env: { SETTLEMENT_CHAIN_CONFIG: join(dir, "chain.json") },
  });
  expect(off.x402Enabled).toBe(false);
  expect(off.x402FacilitatorUrl).toBe(DEFAULT_X402_FACILITATOR_URL);
  expect(() =>
    runtimeConfig({
      chain: {
        rpcUrl: "http://127.0.0.1:8545",
        chainId: 31337,
        contract: CONTRACT,
        token: "0x0000000000000000000000000000000000000001",
        privateKey: KEY,
      },
      source: "beefapi",
      orderDemo: true,
      beefapiBaseUrl: "http://127.0.0.1:9",
      beefapiToken: "t".repeat(32),
      x402Enabled: true,
    }),
  ).toThrow(/Fuji/);
  expect(() =>
    runtimeConfig({
      chain: {
        rpcUrl: "https://example.invalid",
        chainId: 43113,
        contract: CONTRACT,
        token: CIRCLE_FUJI_USDC,
        privateKey: KEY,
      },
      source: "beefapi",
      orderDemo: true,
      beefapiBaseUrl: "http://127.0.0.1:9",
      beefapiToken: "t".repeat(32),
      x402Enabled: true,
      x402FacilitatorUrl: "http://facilitator.example",
    }),
  ).toThrow(/HTTPS/);
});

test("disabled mode keeps synthetic pay and omits payment on orders", async () => {
  const source = mockOrderSource();
  const { app, store } = harness({ x402Enabled: false }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string; payment?: unknown } };
  expect(created.order.payment).toBeUndefined();
  expect(
    (await req(app, `/api/x402/orders/${created.order.requestId}/pay`, { sid, method: "POST", body: "{}" })).status,
  ).toBe(404);
  const paid = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(paid.status).toBe(200);
  const state = await (await req(app, "/api/state", { sid })).json();
  expect(state.x402.enabled).toBe(false);
  expect(state.x402.network).toBe(X402_NETWORK);
  expect(state.x402.asset).toBe(CIRCLE_FUJI_USDC);
  expect(state.x402.payTo).toBe(getAddress(CONTRACT));
  expect(state.orders[0].payment).toBeUndefined();
  expect(source.payCalls).toBe(1);
});

test("enabled mode blocks synthetic pay and new orders expose required payment", async () => {
  const { app, store } = harness();
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const order = await createPending(app, sid);
  expect(order.payment?.status).toBe("required");
  const blocked = await req(app, `/api/demo/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(blocked.status).toBe(403);
  const challenge = await req(app, `/api/x402/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(challenge.status).toBe(402);
  const required = decodePaymentRequiredHeader(
    challenge.headers.get(PAYMENT_REQUIRED_HEADER) ?? "",
  ) as { x402Version: number; accepts: Array<{ amount: string; network: string; extra: { name: string; version: string } }>; resource: { url: string } };
  expect(required.x402Version).toBe(2);
  expect(required.accepts[0]?.amount).toBe("10000000");
  expect(required.accepts[0]?.network).toBe(X402_NETWORK);
  expect(required.accepts[0]?.extra).toEqual({ name: "USD Coin", version: "2" });
  expect(required.resource.url).toBe(
    `${app.origin}/api/x402/orders/${order.requestId}/pay`,
  );
  const state = await (await req(app, "/api/state", { sid })).json();
  expect(state.x402.enabled).toBe(true);
  expect(state.orders[0].payment).toEqual({
    mode: "x402",
    status: "required",
    txHash: null,
    error: null,
  });
  expect(JSON.stringify(state)).not.toContain("authorization");
  expect(JSON.stringify(state)).not.toContain("payload_json");
});

test("unauthenticated and promoter cannot pay; missing wallet is rejected", async () => {
  const source = mockOrderSource();
  const merchantHash = await Bun.password.hash("merchant-test-pass-a1", "argon2id");
  const promoterHash = await Bun.password.hash("promoter-test-pass-b2", "argon2id");
  const { app, store } = harness({
    authEnabled: true,
    merchantPasswordHash: merchantHash,
    promoterPasswordHash: promoterHash,
  }, source);
  const login = async (username: string, password: string) => {
    const res = await req(app, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    return sid!;
  };
  const merchant = await login("merchant", "merchant-test-pass-a1");
  const promoter = await login("promoter", "promoter-test-pass-b2");
  const created = await req(app, "/api/demo/orders", {
    sid: merchant,
    method: "POST",
    body: "{}",
  });
  const { order } = (await created.json()) as { order: { requestId: string } };
  expect(
    (await req(app, `/api/x402/orders/${order.requestId}/pay`, { method: "POST", body: "{}" })).status,
  ).toBe(401);
  expect(
    (
      await req(app, `/api/x402/orders/${order.requestId}/pay`, {
        sid: promoter,
        method: "POST",
        body: "{}",
      })
    ).status,
  ).toBe(403);
  const unpaid = await req(app, `/api/x402/orders/${order.requestId}/pay`, {
    sid: merchant,
    method: "POST",
    body: "{}",
  });
  expect(unpaid.status).toBe(400);
  store.setWallet(RECIPIENT);
  expect(
    (
      await req(app, `/api/x402/orders/${order.requestId}/pay`, {
        sid: merchant,
        method: "POST",
        body: "{}",
      })
    ).status,
  ).toBe(402);
  expect(store.getChallenge(hashSessionToken(promoter))).toBeNull();
});

async function paidFlow(overrides?: {
  source?: MockOrders;
  facilitator?: MockFacilitator;
  x402Chain?: MockX402Chain;
  sign?: Parameters<typeof signPayload>[0] extends infer T ? Partial<T> : never;
}) {
  const source = overrides?.source ?? mockOrderSource();
  const facilitator = overrides?.facilitator ?? new MockFacilitator();
  const x402Chain = overrides?.x402Chain ?? new MockX402Chain();
  x402Chain.receipts.set(GOOD_TX.toLowerCase(), {
    ok: true,
    txHash: GOOD_TX,
    blockNumber: 1001n,
  });
  const { app, store } = harness({ x402Enabled: true }, source, {
    facilitator,
    x402Chain,
  });
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const order = await createPending(app, sid);
  const account = privateKeyToAccount(generatePrivateKey());
  const signed = await signPayload({
    account,
    origin: app.origin,
    requestId: order.requestId,
    ...(overrides?.sign ?? {}),
  });
  const res = await req(app, `/api/x402/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
    paymentSignature: signed.header,
  });
  return { app, store, source, facilitator, x402Chain, sid, order, account, signed, res };
}

test("valid signature settles once, awards source commission, and repeats PAYMENT-RESPONSE", async () => {
  const paid = await paidFlow();
  expect(paid.res.status).toBe(200);
  const body = (await paid.res.json()) as {
    order: { status: string; commissionUsdc: string; payment: { status: string; txHash: string } };
  };
  expect(body.order.status).toBe("paid");
  expect(body.order.commissionUsdc).toBe("1000000");
  expect(body.order.payment.status).toBe("completed");
  expect(body.order.payment.txHash).toBe(GOOD_TX);
  expect(paid.source.reserves[0]?.recipient).toBe(RECIPIENT);
  expect(paid.source.reserves[0]?.requestId).toBe(
    orderReservationRequestId(paid.order.requestId),
  );
  expect(paid.facilitator.settleCalls).toBe(1);
  const settleHeader = decodePaymentResponseHeader(
    paid.res.headers.get(PAYMENT_RESPONSE_HEADER) ?? "",
  ) as { success: boolean; transaction: string; network: string };
  expect(settleHeader.success).toBe(true);
  expect(settleHeader.transaction).toBe(GOOD_TX);
  expect(JSON.stringify(body)).not.toContain(paid.signed.payload.payload.signature);

  const replay = await req(paid.app, `/api/x402/orders/${paid.order.requestId}/pay`, {
    sid: paid.sid,
    method: "POST",
    body: "{}",
  });
  expect(replay.status).toBe(200);
  expect(paid.facilitator.settleCalls).toBe(1);
  expect(paid.source.payCalls).toBe(1);
  const replayHeader = decodePaymentResponseHeader(
    replay.headers.get(PAYMENT_RESPONSE_HEADER) ?? "",
  ) as { success: boolean; transaction: string };
  expect(replayHeader.success).toBe(true);
  expect(replayHeader.transaction).toBe(GOOD_TX);
});

test("official SDK client signs our 402 and we accept the encoded PAYMENT-SIGNATURE", async () => {
  const source = mockOrderSource();
  const facilitator = new MockFacilitator();
  const x402Chain = new MockX402Chain();
  x402Chain.receipts.set(GOOD_TX.toLowerCase(), {
    ok: true,
    txHash: GOOD_TX,
    blockNumber: 1001n,
  });
  const { app, store } = harness({}, source, { facilitator, x402Chain });
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const order = await createPending(app, sid);
  const challenge = await req(app, `/api/x402/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(challenge.status).toBe(402);
  const account = privateKeyToAccount(generatePrivateKey());
  const core = new x402Client()
    .setSpendControls(false)
    .register("eip155:43113", new ExactEvmScheme(account));
  const client = new x402HTTPClient(core);
  const paymentRequired = client.getPaymentRequiredResponse((name) =>
    challenge.headers.get(name),
  );
  const officialDecoded = decodeOfficialRequired(
    challenge.headers.get(PAYMENT_REQUIRED_HEADER)!,
  );
  expect(officialDecoded).toMatchObject({ x402Version: 2 });
  const payload = await client.createPaymentPayload(paymentRequired);
  const encoded = client.encodePaymentSignatureHeader(payload);
  const interned = decodePaymentSignatureHeader(encoded["PAYMENT-SIGNATURE"]!);
  expect(interned).toMatchObject({ x402Version: 2 });
  const recovered = await recoverTypedDataAddress({
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 43113,
      verifyingContract: getAddress(CIRCLE_FUJI_USDC),
    },
    types: AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: (payload.payload as { authorization: { from: Address } }).authorization.from,
      to: getAddress(CONTRACT),
      value: 10_000_000n,
      validAfter: BigInt(
        (payload.payload as { authorization: { validAfter: string } }).authorization.validAfter,
      ),
      validBefore: BigInt(
        (payload.payload as { authorization: { validBefore: string } }).authorization.validBefore,
      ),
      nonce: (payload.payload as { authorization: { nonce: Hex } }).authorization.nonce,
    },
    signature: (payload.payload as { signature: Hex }).signature,
  });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  const paid = await req(app, `/api/x402/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
    headers: encoded,
  });
  expect(paid.status).toBe(200);
  const officialSettle = client.getPaymentSettleResponse((name) => paid.headers.get(name));
  expect(officialSettle.success).toBe(true);
  expect(officialSettle.transaction).toBe(GOOD_TX);
});

test("wrong chain amount recipient signature and expiry are denied", async () => {
  const { app, store } = harness();
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const order = await createPending(app, sid);
  const account = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const path = `/api/x402/orders/${order.requestId}/pay`;
  const base = { account, origin: app.origin, requestId: order.requestId };

  const wrongNet = await signPayload({ ...base, network: "eip155:8453" });
  expect(
    (await req(app, path, { sid, method: "POST", body: "{}", paymentSignature: wrongNet.header })).status,
  ).toBe(400);

  const wrongAmt = await signPayload({ ...base, amount: "1" });
  expect(
    (await req(app, path, { sid, method: "POST", body: "{}", paymentSignature: wrongAmt.header })).status,
  ).toBe(400);

  const wrongTo = await signPayload({ ...base, to: OTHER });
  expect(
    (await req(app, path, { sid, method: "POST", body: "{}", paymentSignature: wrongTo.header })).status,
  ).toBe(400);

  const good = await signPayload(base);
  const badSig = await signPayload({
    ...base,
    nonce: good.nonce,
    signature: await other.signTypedData({
      domain: {
        name: X402_TOKEN_NAME,
        version: X402_TOKEN_VERSION,
        chainId: 43113,
        verifyingContract: getAddress(CIRCLE_FUJI_USDC),
      },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(account.address),
        to: getAddress(CONTRACT),
        value: 10_000_000n,
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
        nonce: good.nonce,
      },
    }),
  });
  expect(
    (await req(app, path, { sid, method: "POST", body: "{}", paymentSignature: badSig.header })).status,
  ).toBe(400);

  const expired = await signPayload({
    ...base,
    validBefore: String(Math.floor(Date.now() / 1000) - 10),
  });
  const expiredRes = await req(app, path, {
    sid,
    method: "POST",
    body: "{}",
    paymentSignature: expired.header,
  });
  expect(expiredRes.status).toBe(400);
  expect(await expiredRes.json()).toMatchObject({ error: "付款授权已过期。" });
});

test("malformed and oversized signatures are denied", async () => {
  const { app, store } = harness();
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const order = await createPending(app, sid);
  const path = `/api/x402/orders/${order.requestId}/pay`;
  expect(
    (await req(app, path, { sid, method: "POST", body: "{}", paymentSignature: "%%%" })).status,
  ).toBe(400);
  expect(
    (
      await req(app, path, {
        sid,
        method: "POST",
        body: "{}",
        paymentSignature: "A".repeat(9 * 1024),
      })
    ).status,
  ).toBe(400);
});

test("fake facilitator hash does not complete without matching receipt", async () => {
  const facilitator = new MockFacilitator();
  facilitator.result = { kind: "success", transaction: FAKE_TX, network: X402_NETWORK };
  const paid = await paidFlow({ facilitator });
  expect(paid.res.status).toBe(502);
  expect(paid.source.payCalls).toBe(0);
  const state = await (await req(paid.app, "/api/state", { sid: paid.sid })).json();
  expect(state.orders[0].payment.status).toBe("submitted");
  expect(state.orders[0].payment.txHash).toBeNull();
  expect(JSON.stringify(state)).not.toContain(paid.signed.payload.payload.signature);
});

test("duplicate payload cannot pay two orders", async () => {
  const source = mockOrderSource();
  const facilitator = new MockFacilitator();
  const x402Chain = new MockX402Chain();
  x402Chain.receipts.set(GOOD_TX.toLowerCase(), {
    ok: true,
    txHash: GOOD_TX,
    blockNumber: 1001n,
  });
  const { app, store } = harness({}, source, { facilitator, x402Chain });
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const a = await createPending(app, sid);
  const b = await createPending(app, sid);
  const account = privateKeyToAccount(generatePrivateKey());
  const signed = await signPayload({
    account,
    origin: app.origin,
    requestId: a.requestId,
  });
  const first = await req(app, `/api/x402/orders/${a.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
    paymentSignature: signed.header,
  });
  expect(first.status).toBe(200);
  const reused = {
    ...signed.payload,
    resource: {
      url: `${app.origin}/api/x402/orders/${b.requestId}/pay`,
    },
  };
  const header = Buffer.from(JSON.stringify(reused), "utf8").toString("base64");
  const second = await req(app, `/api/x402/orders/${b.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
    paymentSignature: header,
  });
  expect(second.status).toBe(409);
  expect(source.payCalls).toBe(1);
});

test("concurrent replay of one authorization settles once", async () => {
  const source = mockOrderSource();
  const facilitator = new MockFacilitator();
  const x402Chain = new MockX402Chain();
  x402Chain.receipts.set(GOOD_TX.toLowerCase(), {
    ok: true,
    txHash: GOOD_TX,
    blockNumber: 1001n,
  });
  const { app, store } = harness({}, source, { facilitator, x402Chain });
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const order = await createPending(app, sid);
  const account = privateKeyToAccount(generatePrivateKey());
  const signed = await signPayload({
    account,
    origin: app.origin,
    requestId: order.requestId,
  });
  const path = `/api/x402/orders/${order.requestId}/pay`;
  const [a, b] = await Promise.all([
    req(app, path, { sid, method: "POST", body: "{}", paymentSignature: signed.header }),
    req(app, path, { sid, method: "POST", body: "{}", paymentSignature: signed.header }),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(facilitator.settleCalls).toBe(1);
  expect(source.reserves).toHaveLength(1);
});

test("settle timeout then restart recovers via AuthorizationUsed logs without a new signature", async () => {
  const source = mockOrderSource();
  const facilitator = new MockFacilitator();
  facilitator.result = { kind: "timeout" };
  const x402Chain = new MockX402Chain();
  const first = harness({}, source, { facilitator, x402Chain });
  const sid = await open(first.app);
  first.store.setWallet(RECIPIENT);
  const order = await createPending(first.app, sid);
  const account = privateKeyToAccount(generatePrivateKey());
  const signed = await signPayload({
    account,
    origin: first.app.origin,
    requestId: order.requestId,
  });
  const lost = await req(first.app, `/api/x402/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
    paymentSignature: signed.header,
  });
  expect(lost.status).toBe(502);
  expect(source.payCalls).toBe(0);
  expect(first.store.getX402Payload(order.requestId)).not.toBeNull();
  first.store.close();

  const store2 = createStore({
    path: join(first.dir, "db.sqlite"),
    fingerprint: runtimeFingerprint(first.config),
  });
  closers.push(() => store2.close());
  const facilitator2 = new MockFacilitator();
  const x402Chain2 = new MockX402Chain();
  x402Chain2.found = GOOD_TX;
  x402Chain2.receipts.set(GOOD_TX.toLowerCase(), {
    ok: true,
    txHash: GOOD_TX,
    blockNumber: 1002n,
  });
  const app2 = createApp({
    store: store2,
    worker: createWorker({
      store: store2,
      chain: first.chain,
      source,
      config: first.config,
    }),
    chain: first.chain,
    source,
    config: first.config,
    publicDir: first.config.publicDir,
    x402Facilitator: facilitator2,
    x402Chain: x402Chain2,
  });
  const recovered = await req(app2, `/api/x402/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(recovered.status).toBe(200);
  expect(facilitator2.settleCalls).toBe(0);
  expect(x402Chain2.findCalls).toBeGreaterThan(0);
  expect(source.payCalls).toBe(1);
  const body = (await recovered.json()) as { order: { payment: { status: string; txHash: string } } };
  expect(body.order.payment.status).toBe("completed");
  expect(body.order.payment.txHash).toBe(GOOD_TX);
});

test("source writeback retries after chain settlement without a new settle", async () => {
  const source = mockOrderSource();
  source.setPayFail("来源服务暂时不可用。");
  const paid = await paidFlow({ source });
  expect(paid.res.status).toBe(502);
  expect(paid.facilitator.settleCalls).toBe(1);
  const state = await (await req(paid.app, "/api/state", { sid: paid.sid })).json();
  expect(state.orders[0].payment.status).toBe("settled");
  expect(state.orders[0].payment.txHash).toBe(GOOD_TX);
  expect(state.orders[0].error).toBe("来源服务暂时不可用。");
  source.setPayFail(null);
  paid.store.setWallet(OTHER);
  const retry = await req(paid.app, `/api/x402/orders/${paid.order.requestId}/pay`, {
    sid: paid.sid,
    method: "POST",
    body: "{}",
  });
  expect(retry.status).toBe(200);
  expect(paid.facilitator.settleCalls).toBe(1);
  expect(source.reserves[0]?.recipient).toBe(RECIPIENT);
  expect(source.reserves[0]?.recipient).not.toBe(OTHER);
});

test("zero commission still requires x402 payment and skips reservation", async () => {
  const source = mockOrderSource({ payCommission: "0" });
  const paid = await paidFlow({ source });
  expect(paid.res.status).toBe(200);
  const body = (await paid.res.json()) as { order: { commissionUsdc: string; status: string } };
  expect(body.order.status).toBe("paid");
  expect(body.order.commissionUsdc).toBe("0");
  expect(source.reserveCalls).toBe(0);
  expect(paid.facilitator.settleCalls).toBe(1);
});

test("legacy paid rows stay without x402 payment after enable", async () => {
  const source = mockOrderSource();
  const disabled = harness({ x402Enabled: false }, source);
  const sid = await open(disabled.app);
  disabled.store.setWallet(RECIPIENT);
  const created = await (
    await req(disabled.app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  await req(disabled.app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  disabled.store.close();

  const store2 = createStore({
    path: join(disabled.dir, "db.sqlite"),
    fingerprint: runtimeFingerprint(disabled.config),
  });
  closers.push(() => store2.close());
  const enabledConfig = runtimeConfig({
    ...disabled.config,
    x402Enabled: true,
  });
  const app2 = createApp({
    store: store2,
    worker: createWorker({
      store: store2,
      chain: disabled.chain,
      source,
      config: enabledConfig,
    }),
    chain: disabled.chain,
    source,
    config: enabledConfig,
    publicDir: enabledConfig.publicDir,
    x402Facilitator: new MockFacilitator(),
    x402Chain: new MockX402Chain(),
  });
  const state = await (await req(app2, "/api/state", { sid })).json();
  expect(state.x402.enabled).toBe(true);
  expect(state.orders[0].status).toBe("paid");
  expect(state.orders[0].payment).toBeUndefined();
});

test('pinned expired authorization recovers settled source writeback without new charge', async () => {
  let now=Date.now();const source=mockOrderSource();source.setPayFail('来源服务暂时不可用。');
  const h=harness({},source,{now:()=>now});const sid=await open(h.app);const order=await createPending(h.app,sid,h.store);
  const signed=await signPayload({origin:h.app.origin,requestId:order.requestId,account:privateKeyToAccount(generatePrivateKey())});
  const path=`/api/x402/orders/${order.requestId}/pay`;
  expect((await req(h.app,path,{sid,method:'POST',body:'{}',paymentSignature:signed.header})).status).toBe(502);
  now+=600000;source.setPayFail(null);
  expect((await req(h.app,path,{sid,method:'POST',body:'{}',paymentSignature:signed.header})).status).toBe(200);
  expect(h.facilitator.settleCalls).toBe(1);
});

test('turning x402 off cannot synthetically pay an existing x402 order', async () => {
  const h=harness();const sid=await open(h.app);const order=await createPending(h.app,sid,h.store);
  const config=runtimeConfig({...h.config,x402Enabled:false});
  const app=createApp({store:h.store,worker:h.worker,chain:h.chain,source:h.source,config});
  expect((await req(app,`/api/demo/orders/${order.requestId}/pay`,{sid,method:'POST',body:'{}'})).status).toBe(403);
  expect(h.source.payCalls).toBe(0);
});

test('replaying legacy order creation after enable preserves its simulated payment history', async () => {
  const h=harness({x402Enabled:false});const sid=await open(h.app);const order=await createPending(h.app,sid,h.store);
  expect((await req(h.app,`/api/demo/orders/${order.requestId}/pay`,{sid,method:'POST',body:'{}'})).status).toBe(200);
  const config=runtimeConfig({...h.config,x402Enabled:true});
  const app=createApp({store:h.store,worker:h.worker,chain:h.chain,source:h.source,config,x402Facilitator:h.facilitator,x402Chain:h.x402Chain});
  const replay=await req(app,'/api/demo/orders',{sid,method:'POST',body:JSON.stringify({request_id:order.requestId})});
  expect(replay.status).toBe(200);
  expect((await replay.json()).order.payment).toBeUndefined();
  expect(h.store.getX402Order(order.requestId)).toBeNull();
});

test('pending finality after authorization expiry remains recoverable without another settle', async () => {
  let now=Date.now();const h=harness({},undefined,{now:()=>now});h.x402Chain.receipts.set(GOOD_TX,{ok:false,reason:'pending'});
  const sid=await open(h.app);const order=await createPending(h.app,sid,h.store);
  const signed=await signPayload({origin:h.app.origin,requestId:order.requestId,account:privateKeyToAccount(generatePrivateKey())});
  const path=`/api/x402/orders/${order.requestId}/pay`;
  expect((await req(h.app,path,{sid,method:'POST',body:'{}',paymentSignature:signed.header})).status).toBe(502);
  now+=600000;
  expect((await req(h.app,path,{sid,method:'POST',body:'{}'})).status).toBe(502);
  expect(h.store.getX402Order(order.requestId)?.status).toBe('submitted');
  h.x402Chain.receipts.set(GOOD_TX,{ok:true,txHash:GOOD_TX,blockNumber:1001n});h.x402Chain.found=GOOD_TX;
  expect((await req(h.app,path,{sid,method:'POST',body:'{}'})).status).toBe(200);
  expect(h.facilitator.settleCalls).toBe(1);
});

test('legacy paid commission can finish reservation after x402 enable', async () => {
  const h=harness({x402Enabled:false});const sid=await open(h.app);const order=await createPending(h.app,sid,h.store);
  await h.source.payOrder!(order.requestId);
  const config=runtimeConfig({...h.config,x402Enabled:true});
  const app=createApp({store:h.store,worker:h.worker,chain:h.chain,source:h.source,config,x402Facilitator:h.facilitator,x402Chain:h.x402Chain});
  expect((await req(app,`/api/demo/orders/${order.requestId}/pay`,{sid,method:'POST',body:'{}'})).status).toBe(200);
  expect(h.source.reserveCalls).toBe(1);expect(h.facilitator.settleCalls).toBe(0);
});
