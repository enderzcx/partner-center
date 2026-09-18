import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  loadConfig,
  runtimeConfig,
  runtimeFingerprint,
  type RuntimeConfig,
} from "../src/config.ts";
import { createApp, type SettlementApp } from "../src/server.ts";
import {
  createBeefApiSource,
  DEFAULT_PAYMENT_AMOUNT_MINOR,
  orderReservationRequestId,
  parseSourceOrder,
} from "../src/source.ts";
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

const TOKEN = "0x0000000000000000000000000000000000000001" as const;
const CONTRACT = "0x0000000000000000000000000000000000000002" as const;
const RECIPIENT = "0x0000000000000000000000000000000000000003" as Address;
const OTHER = "0x0000000000000000000000000000000000000004" as Address;
const KEY = `0x${"1".padStart(64, "0")}` as Hex;

class MockChain implements Chain {
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
  init: RequestInit & { sid?: string; origin?: string | null } = {},
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
  return app.fetch(new Request(`${app.origin}${path}`, { ...init, headers }));
}

type MockOrders = Source & {
  reserves: Array<{ requestId: string; recipient: string; amountUsdc: string }>;
  payCalls: number;
  reserveCalls: number;
  setRate: (rate: string) => void;
  setPayFail: (message: string | null) => void;
  setReserveFail: (message: string | null) => void;
  setPayCommission: (value: string) => void;
};

function mockOrderSource(init?: {
  rate?: string;
  payCommission?: string;
}): MockOrders {
  const orders = new Map<string, SourceOrder>();
  const reserves: MockOrders["reserves"] = [];
  let currentRate = init?.rate ?? "0.1";
  let payCommission = init?.payCommission ?? "1000000";
  let payFail: string | null = null;
  let reserveFail: string | null = null;
  return {
    kind: "beefapi",
    reserves,
    payCalls: 0,
    reserveCalls: 0,
    setRate(rate) {
      currentRate = rate;
    },
    setPayFail(message) {
      payFail = message;
    },
    setReserveFail(message) {
      reserveFail = message;
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
        commissionRate: currentRate,
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
        commissionRate: currentRate,
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
      if (reserveFail) throw new ServiceError(502, reserveFail);
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

function harness(
  extra: Partial<RuntimeConfig> = {},
  source?: Source,
) {
  const dir = mkdtempSync(join(tmpdir(), "settlement-order-"));
  const publicDir = join(dir, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "index.html"), "<html><body>ok</body></html>");
  writeFileSync(join(publicDir, "app.js"), "window.__settlement=1;");
  writeFileSync(join(publicDir, "style.css"), "body{margin:0}");
  const chain = new MockChain();
  const config = runtimeConfig({
    port: 4311,
    chain: extra.chain ?? {
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 31337,
      contract: CONTRACT,
      token: TOKEN,
      privateKey: KEY,
      recipient: RECIPIENT,
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
    ...extra,
  });
  const store = createStore({
    path: join(dir, "db.sqlite"),
    fingerprint: runtimeFingerprint(config),
  });
  closers.push(() => store.close());
  const src = source ?? mockOrderSource();
  const worker = createWorker({ store, chain, source: src, config });
  const app = createApp({ store, worker, chain, source: src, config, publicDir });
  return { app, store, chain, source: src, worker, config };
}

test("parser rejects pending nonzero commission and other-partner rows", () => {
  const pending = parseSourceOrder(
    {
      request_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      trade_no: "T1",
      payment_amount_minor: "1000",
      commission_rate: "0.1",
      commission_usdc: "0",
      status: "pending",
      user_id: 1,
    },
    1,
  );
  expect(pending).not.toBe("skip");
  if (pending === "skip") throw new Error("expected order");
  expect(pending.paymentAmountMinor).toBe(DEFAULT_PAYMENT_AMOUNT_MINOR);
  expect(
    parseSourceOrder(
      {
        request_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        trade_no: "T1",
        payment_amount_minor: "1000",
        commission_rate: "0.1",
        commission_usdc: "0",
        status: "pending",
        user_id: 9,
      },
      1,
    ),
  ).toBe("skip");
  expect(() =>
    parseSourceOrder(
      {
        request_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        trade_no: "T1",
        payment_amount_minor: "1000",
        commission_rate: "0.1",
        commission_usdc: "1000000",
        status: "pending",
      },
      1,
    ),
  ).toThrow(/无法识别/);
});

test("default 10 USD order awards 1 USDC and reserves once", async () => {
  const source = mockOrderSource();
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await req(app, "/api/demo/orders", {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(created.status).toBe(200);
  const { order } = (await created.json()) as { order: SourceOrder };
  expect(order.paymentAmountMinor).toBe("1000");
  expect(order.status).toBe("pending");
  expect(order.commissionUsdc).toBe("0");
  expect(order.commissionRate).toBe("0.1");

  const paid = await req(app, `/api/demo/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(paid.status).toBe(200);
  const body = (await paid.json()) as { order: { commissionUsdc: string; status: string } };
  expect(body.order.status).toBe("paid");
  expect(body.order.commissionUsdc).toBe("1000000");
  expect(source.reserves).toHaveLength(1);
  expect(source.reserves[0]?.amountUsdc).toBe("1000000");
  expect(source.reserves[0]?.requestId).toBe(
    orderReservationRequestId(order.requestId),
  );
  expect(source.reserves[0]?.recipient).toBe(RECIPIENT);

  const replay = await req(app, `/api/demo/orders/${order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(replay.status).toBe(200);
  expect(source.reserves).toHaveLength(1);
  expect(source.reserveCalls).toBe(2);
  expect(new Set(source.reserves.map((row) => row.requestId)).size).toBe(1);
});

test("unbound wallet rejects pay before any snapshot", async () => {
  const { app } = harness();
  const sid = await open(app);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  const paid = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(paid.status).toBe(400);
  expect(await paid.json()).toMatchObject({ error: "请先绑定收款钱包，再确认测试订单。" });
});

test("wallet change after first pay attempt does not redirect recipient", async () => {
  const source = mockOrderSource();
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  source.setPayFail("来源服务暂时不可用。");
  const first = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(first.status).toBe(502);
  expect(store.getOrderSnapshot(created.order.requestId)?.recipient).toBe(RECIPIENT);
  store.setWallet(OTHER);
  source.setPayFail(null);
  const second = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: JSON.stringify({ recipient: OTHER }),
  });
  expect(second.status).toBe(200);
  expect(source.reserves[0]?.recipient).toBe(RECIPIENT);
  expect(source.reserves[0]?.recipient).not.toBe(OTHER);
});

test("rate change metadata does not recompute reserved commission", async () => {
  const source = mockOrderSource({ rate: "0.1", payCommission: "1000000" });
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string; commissionRate: string } };
  expect(created.order.commissionRate).toBe("0.1");
  source.setRate("0.2");
  const paid = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: JSON.stringify({ commission_rate: "0.2", amount: "2000000" }),
  });
  expect(paid.status).toBe(200);
  const body = (await paid.json()) as { order: { commissionUsdc: string; commissionRate: string } };
  expect(body.order.commissionRate).toBe("0.1");
  expect(body.order.commissionUsdc).toBe("1000000");
  expect(source.reserves[0]?.amountUsdc).toBe("1000000");
});

test("zero commission pays without reservation", async () => {
  const source = mockOrderSource({ rate: "0", payCommission: "0" });
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  const paid = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(paid.status).toBe(200);
  const body = (await paid.json()) as { order: { commissionUsdc: string; status: string } };
  expect(body.order.status).toBe("paid");
  expect(body.order.commissionUsdc).toBe("0");
  expect(source.reserveCalls).toBe(0);
  expect(source.reserves).toHaveLength(0);
});

test("malicious browser amount rate and recipient are ignored on pay", async () => {
  const source = mockOrderSource();
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  const paid = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: JSON.stringify({
      amount: "999999999",
      payment_amount_minor: "1",
      commission_rate: "1",
      commission_usdc: "5000000",
      recipient: OTHER,
      request_id: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
    }),
  });
  expect(paid.status).toBe(200);
  expect(source.reserves[0]?.amountUsdc).toBe("1000000");
  expect(source.reserves[0]?.recipient).toBe(RECIPIENT);
  expect(source.reserves[0]?.requestId).toBe(
    orderReservationRequestId(created.order.requestId),
  );
});

test("legacy fixture and beefapi without demo expose no new order routes", async () => {
  const fixture = harness({ source: "fixture", orderDemo: false });
  const fixtureSid = await open(fixture.app);
  expect(
    (await req(fixture.app, "/api/demo/orders", { sid: fixtureSid, method: "POST", body: "{}" }))
      .status,
  ).toBe(404);
  const fixtureState = await (await req(fixture.app, "/api/state", { sid: fixtureSid })).json();
  expect(fixtureState.orderDemo).toBe(false);
  expect(fixtureState.orders).toBeUndefined();

  const beef = harness({ source: "beefapi", orderDemo: false }, mockOrderSource());
  const beefSid = await open(beef.app);
  expect(
    (
      await req(beef.app, "/api/demo/orders", {
        sid: beefSid,
        method: "POST",
        body: "{}",
      })
    ).status,
  ).toBe(404);
  const beefState = await (await req(beef.app, "/api/state", { sid: beefSid })).json();
  expect(beefState.orderDemo).toBe(false);
  expect(beefState.orders).toBeUndefined();
});

test("order demo rejects unsigned local wallet shortcut", async () => {
  const { app } = harness();
  const sid = await open(app);
  expect(
    (await req(app, "/api/demo/wallet", { sid, method: "POST", body: "{}" })).status,
  ).toBe(403);
});

test("order demo still binds via challenge signature", async () => {
  const { app, store } = harness();
  const sid = await open(app);
  const account = privateKeyToAccount(generatePrivateKey());
  const challenged = await req(app, "/api/partner/wallet/challenge", {
    sid,
    method: "POST",
    body: JSON.stringify({ address: account.address }),
  });
  expect(challenged.status).toBe(200);
  const { message } = (await challenged.json()) as { message: string };
  const signature = await account.signMessage({ message });
  const verified = await req(app, "/api/partner/wallet/verify", {
    sid,
    method: "POST",
    body: JSON.stringify({ address: account.address, signature }),
  });
  expect(verified.status).toBe(200);
  expect(store.getPartner().wallet).toBe(account.address);
});

test("concurrent pays share one reservation mapping", async () => {
  const source = mockOrderSource();
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  const path = `/api/demo/orders/${created.order.requestId}/pay`;
  const [a, b] = await Promise.all([
    req(app, path, { sid, method: "POST", body: "{}" }),
    req(app, path, { sid, method: "POST", body: "{}" }),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(source.reserves).toHaveLength(1);
  expect(source.reserves[0]?.amountUsdc).toBe("1000000");
});

test("reservation failure stays visible and retries the same snapshot", async () => {
  const source = mockOrderSource();
  const { app, store } = harness({ orderDemo: true, source: "beefapi" }, source);
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json() as { order: { requestId: string } };
  source.setReserveFail("来源服务暂时不可用。");
  const failed = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(failed.status).toBe(502);
  const state = await (await req(app, "/api/state", { sid })).json();
  expect(state.orderDemo).toBe(true);
  expect(state.orders[0].error).toBe("来源服务暂时不可用。");
  expect(state.orders[0].status).toBe("paid");
  expect(state.orders[0].recipient).toBe(RECIPIENT);
  source.setReserveFail(null);
  store.setWallet(OTHER);
  const retry = await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(retry.status).toBe(200);
  expect(source.reserves[0]?.recipient).toBe(RECIPIENT);
  const recovered = await (await req(app, "/api/state", { sid })).json();
  expect(recovered.orders[0].error).toBeNull();
});

test("SETTLEMENT_ORDER_DEMO is off by default and beefapi-only", () => {
  expect(() =>
    runtimeConfig({
      chain: {
        rpcUrl: "http://127.0.0.1:8545",
        chainId: 31337,
        contract: CONTRACT,
        token: TOKEN,
        privateKey: KEY,
      },
      source: "fixture",
      orderDemo: true,
    }),
  ).toThrow(/beefapi/);
  const dir = mkdtempSync(join(tmpdir(), "settlement-order-cfg-"));
  writeFileSync(
    join(dir, "chain.json"),
    JSON.stringify({
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 31337,
      contract: CONTRACT,
      token: TOKEN,
      privateKey: KEY,
    }),
  );
  const cfg = loadConfig({
    cwd: dir,
    env: { SETTLEMENT_CHAIN_CONFIG: join(dir, "chain.json") },
  });
  expect(cfg.orderDemo).toBe(false);
  expect(() =>
    loadConfig({
      cwd: dir,
      env: {
        SETTLEMENT_CHAIN_CONFIG: join(dir, "chain.json"),
        SETTLEMENT_ORDER_DEMO: "true",
      },
    }),
  ).toThrow(/beefapi/);
});

test("worker settles the reserved commission after demo pay", async () => {
  const source = mockOrderSource();
  source.pull = async () =>
    source.reserves.map((row, index) => ({
      sourceId: `beefapi:${row.requestId}:${index + 1}`,
      recipient: row.recipient as Address,
      amount: BigInt(row.amountUsdc),
      createdAt: Date.now(),
      alreadyFrozen: true,
      requestId: row.requestId,
      numericId: index + 1,
    }));
  const { app, store, worker } = harness(
    { orderDemo: true, source: "beefapi" },
    source,
  );
  const sid = await open(app);
  store.setWallet(RECIPIENT);
  const created = (await (
    await req(app, "/api/demo/orders", { sid, method: "POST", body: "{}" })
  ).json()) as { order: { requestId: string } };
  await req(app, `/api/demo/orders/${created.order.requestId}/pay`, {
    sid,
    method: "POST",
    body: "{}",
  });
  expect(store.listPayouts()).toHaveLength(0);
  await worker.tick();
  expect(store.listPayouts()).toHaveLength(1);
  expect(store.listPayouts()[0]?.amount).toBe(1_000_000n);
  expect(store.listPayouts()[0]?.recipient).toBe(RECIPIENT);
  expect(store.listPayouts()[0]?.status).toBe("completed");
  expect(store.listPayouts()[0]?.alreadyFrozen).toBe(true);
});

test("beefapi source talks to settlement-test order endpoints", async () => {
  const rows: Record<string, unknown>[] = [];
  const reserves: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/settlement-test/orders" && req.method === "GET") {
        return Response.json({ success: true, data: rows });
      }
      if (url.pathname === "/api/settlement-test/orders" && req.method === "POST") {
        const body = (await req.json()) as {
          request_id: string;
          payment_amount_minor: string;
        };
        const row = {
          request_id: body.request_id,
          trade_no: `TR${body.request_id.replaceAll("-", "").slice(0, 10)}`,
          payment_amount_minor: body.payment_amount_minor,
          commission_rate: "0.1",
          commission_usdc: "0",
          status: "pending",
          user_id: 1,
        };
        rows.push(row);
        return Response.json({ success: true, data: row });
      }
      if (url.pathname.endsWith("/pay") && req.method === "POST") {
        const id = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const row = rows.find((item) => item.request_id === id);
        if (!row) return new Response("no", { status: 404 });
        row.status = "paid";
        row.commission_usdc = "1000000";
        return Response.json({ success: true, data: row });
      }
      if (
        url.pathname === "/api/settlement-test/reservations" &&
        req.method === "POST"
      ) {
        const body = (await req.json()) as Record<string, unknown>;
        const existing = reserves.find(
          (item) => item.request_id === body.request_id,
        );
        if (existing) {
          return Response.json({ success: true, data: existing });
        }
        const row = {
          id: reserves.length + 1,
          request_id: body.request_id,
          user_id: body.user_id,
          recipient: body.recipient,
          amount_usdc: body.amount_usdc,
          status: "reserved",
          chain_id: 31337,
          token: TOKEN,
          created_at: Math.floor(Date.now() / 1000),
        };
        reserves.push(row);
        return Response.json({ success: true, data: row });
      }
      return new Response("no", { status: 404 });
    },
  });
  closers.push(() => server.stop(true));
  const { store, config } = harness({
    orderDemo: true,
    source: "beefapi",
    beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
    beefapiToken: "t".repeat(32),
    partnerUserId: 1,
  });
  const source = createBeefApiSource(store, config);
  expect(source.createOrder).toBeDefined();
  expect(source.payOrder).toBeDefined();
  expect(source.reserveFrozen).toBeDefined();
  expect(source.listOrders).toBeDefined();
  const created = await source.createOrder!({
    requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    paymentAmountMinor: "1000",
  });
  expect(created.status).toBe("pending");
  const paid = await source.payOrder!(created.requestId);
  expect(paid.commissionUsdc).toBe("1000000");
  const reserved = await source.reserveFrozen!({
    requestId: orderReservationRequestId(created.requestId),
    recipient: RECIPIENT,
    amountUsdc: paid.commissionUsdc,
  });
  expect(reserved.amount).toBe(1_000_000n);
  expect(reserved.requestId).toBe(orderReservationRequestId(created.requestId));
  const listed = await source.listOrders!();
  expect(listed).toHaveLength(1);
  expect(listed[0]?.status).toBe("paid");
});

test("public UI copy and syntax", () => {
  const checked = Bun.spawnSync(["node", "--check", "public/app.js"], {
    cwd: join(import.meta.dir, ".."),
  });
  expect(checked.exitCode).toBe(0);
  const html = readFileSync(join(import.meta.dir, "../public/index.html"), "utf8");
  const js = readFileSync(join(import.meta.dir, "../public/app.js"), "utf8");
  expect(html).toContain("测试订单");
  expect(js).toContain("模拟支付成功");
  expect(js).toContain("不会向买家扣款。");
  expect(js).not.toContain("Stripe");
  expect(js).not.toContain("synthetic");
});
