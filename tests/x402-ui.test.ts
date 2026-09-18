import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CIRCLE_FUJI_USDC_ASSET,
  X402_NETWORK,
  checkoutURLFromOrigin,
  createX402Pay,
  decodeBase64Json,
  encodeBase64Json,
  isUserRejected,
  orderUsesX402,
  parsePaymentRequired,
  randomNonce32,
  validityWindow,
  verifyPaymentRequired,
  x402AmountAtomic,
  x402PayButtonText,
  x402UsdcLabel,
} from "../public/app.js";

const PAY_TO = "0x831C5C93a221D8508ad4808C2A64D58B15f77c85";
const ORIGIN = "https://partner.bflabs.app";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const FROM = "0x1111111111111111111111111111111111111111";
const SIGNATURE = "0x" + "ab".repeat(65);

const x402State = {
  enabled: true,
  network: X402_NETWORK,
  asset: CIRCLE_FUJI_USDC_ASSET,
  payTo: PAY_TO,
};

const pendingOrder = {
  requestId: ORDER_ID,
  paymentAmountMinor: "1000",
  status: "pending",
};

function paymentRequired(overrides: Record<string, unknown> = {}) {
  const checkout = checkoutURLFromOrigin(ORIGIN, ORDER_ID);
  return {
    x402Version: 2,
    resource: { url: checkout },
    accepts: [
      {
        scheme: "exact",
        network: X402_NETWORK,
        amount: "10000000",
        asset: CIRCLE_FUJI_USDC_ASSET,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(body == null ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function mockProvider(options: {
  from?: string;
  chainId?: string;
  signature?: string;
  reject?: "connect" | "switch" | "sign";
  calls?: Array<{ method: string; params?: unknown }>;
}) {
  const calls = options.calls ?? [];
  let chainId = options.chainId ?? "0xa869";
  return {
    calls,
    async request({ method, params }: { method: string; params?: unknown }) {
      calls.push({ method, params });
      if (method === "eth_requestAccounts") {
        if (options.reject === "connect") {
          const err = new Error("User rejected the request.");
          (err as Error & { code: number }).code = 4001;
          throw err;
        }
        return [options.from ?? FROM];
      }
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        if (options.reject === "switch") {
          const err = new Error("User rejected the request.");
          (err as Error & { code: number }).code = 4001;
          throw err;
        }
        chainId = "0xa869";
        return null;
      }
      if (method === "eth_signTypedData_v4") {
        if (options.reject === "sign") {
          const err = new Error("User rejected the request.");
          (err as Error & { code: number }).code = 4001;
          throw err;
        }
        return options.signature ?? SIGNATURE;
      }
      throw new Error("unexpected " + method);
    },
  };
}

test("demo copy remains and signatures are not persisted", () => {
  const js = readFileSync(join(import.meta.dir, "../public/app.js"), "utf8");
  const html = readFileSync(
    join(import.meta.dir, "../public/index.html"),
    "utf8",
  );
  expect(html).toContain("测试订单");
  expect(html).toContain('type="module"');
  expect(js).toContain("模拟支付成功");
  expect(js).toContain("不会向买家扣款。");
  expect(js).toContain("从付款钱包支付测试 USDC，到账后按本单比例返佣。");
  expect(js).toContain("支付 ");
  expect(js).toContain("继续确认付款");
  expect(js).toContain("继续结算");
  expect(js).not.toContain("localStorage");
  expect(js).not.toContain("Stripe");
});

test("amount conversion and button labels", () => {
  expect(x402AmountAtomic("1000")).toBe("10000000");
  expect(x402UsdcLabel("1000")).toBe("10 测试 USDC");
  expect(x402PayButtonText(pendingOrder, {})).toBe("支付 10 测试 USDC");
  expect(
    x402PayButtonText(
      { ...pendingOrder, payment: { mode: "x402", status: "submitted" } },
      {},
    ),
  ).toBe("继续确认付款");
  expect(
    x402PayButtonText(pendingOrder, { uncertain: true }),
  ).toBe("继续确认付款");
  expect(
    x402PayButtonText(
      {
        ...pendingOrder,
        status: "paid",
        payment: { mode: "x402", status: "settled" },
      },
      {},
    ),
  ).toBe("继续结算");
});

test("old completed simulation orders are not treated as x402", () => {
  expect(orderUsesX402({ status: "paid", requestId: "old" }, true)).toBe(false);
  expect(orderUsesX402({ status: "pending", requestId: "new" }, true)).toBe(
    true,
  );
  expect(orderUsesX402({ status: "pending", requestId: "demo" }, false)).toBe(
    false,
  );
  expect(
    orderUsesX402(
      { status: "paid", payment: { mode: "x402", status: "completed" } },
      true,
    ),
  ).toBe(true);
});

test("402 terms must match pinned Fuji checkout before signing", () => {
  const required = paymentRequired();
  const checkout = checkoutURLFromOrigin(ORIGIN, ORDER_ID);
  expect(verifyPaymentRequired(required, pendingOrder, x402State, checkout)).toEqual({
    resource: required.resource,
    accepted: required.accepts[0],
  });
  expect(() =>
    verifyPaymentRequired(
      paymentRequired({
        resource: { url: "https://partner.bflabs.app/api/x402/orders/other/pay" },
      }),
      pendingOrder,
      x402State,
      checkout,
    ),
  ).toThrow("付款信息与本单不符，未向钱包发起确认。");
  expect(() =>
    verifyPaymentRequired(
      {
        ...required,
        accepts: [{ ...required.accepts[0], network: "avalanche-fuji" }],
      },
      pendingOrder,
      x402State,
      checkout,
    ),
  ).toThrow("付款信息与本单不符，未向钱包发起确认。");
  expect(() =>
    verifyPaymentRequired(
      {
        ...required,
        accepts: [{ ...required.accepts[0], amount: "1000" }],
      },
      pendingOrder,
      x402State,
      checkout,
    ),
  ).toThrow("付款信息与本单不符，未向钱包发起确认。");
  expect(() =>
    verifyPaymentRequired(
      {
        ...required,
        accepts: [
          {
            ...required.accepts[0],
            asset: "0x0000000000000000000000000000000000000001",
          },
        ],
      },
      pendingOrder,
      x402State,
      checkout,
    ),
  ).toThrow("付款信息与本单不符，未向钱包发起确认。");
  expect(() =>
    verifyPaymentRequired(
      {
        ...required,
        accepts: [
          {
            ...required.accepts[0],
            payTo: "0x0000000000000000000000000000000000000002",
          },
        ],
      },
      pendingOrder,
      x402State,
      checkout,
    ),
  ).toThrow("付款信息与本单不符，未向钱包发起确认。");
});

test("validity window is now-60 to now+300 and nonce is 32 bytes", () => {
  const nowMs = 1_700_000_000_000;
  expect(validityWindow(nowMs, 300)).toEqual({
    validAfter: String(1_700_000_000 - 60),
    validBefore: String(1_700_000_000 + 300),
  });
  expect(validityWindow(nowMs, 120)).toEqual({
    validAfter: String(1_700_000_000 - 60),
    validBefore: String(1_700_000_000 + 120),
  });
  const nonce = randomNonce32((bytes: Uint8Array) => {
    bytes.set(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  });
  expect(nonce).toBe(
    "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
  );
  expect(nonce.length).toBe(66);
});

test("PAYMENT-REQUIRED header decodes and PAYMENT-SIGNATURE round-trips", () => {
  const required = paymentRequired();
  const header = encodeBase64Json(required);
  const parsed = parsePaymentRequired(
    new Headers({ "PAYMENT-REQUIRED": header }),
    null,
  );
  expect(parsed.x402Version).toBe(2);
  expect(decodeBase64Json(header).accepts[0].amount).toBe("10000000");
});

test("200/202/503 recover without wallet signing", async () => {
  for (const status of [200, 202, 503]) {
    const calls: Array<{ method: string }> = [];
    const fetches: Array<{ headers: Headers }> = [];
    const session = createX402Pay({
      payloads: new Map(),
      fetch: async (_url: string, init: RequestInit) => {
        fetches.push({ headers: new Headers(init.headers) });
        return jsonResponse(status, { ok: true });
      },
      getProvider: () => mockProvider({ calls }),
      now: () => 1_700_000_000_000,
      getOrigin: () => ORIGIN,
      getX402: () => x402State,
      getNetworkChainId: () => 43113,
      getAuthGeneration: () => 1,
    });
    const outcome = await session.pay(pendingOrder);
    expect(outcome.kind).toBe(status === 200 ? "completed" : "processing");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.headers.get("PAYMENT-SIGNATURE")).toBeNull();
    expect(calls).toHaveLength(0);
  }
});

test("only 402 prompts a new TransferWithAuthorization signature", async () => {
  const providerCalls: Array<{ method: string; params?: unknown }> = [];
  const fetches: Array<{ headers: Headers }> = [];
  const required = paymentRequired();
  let step = 0;
  const session = createX402Pay({
    payloads: new Map(),
    fetch: async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      fetches.push({ headers });
      step += 1;
      if (step === 1) {
        expect(headers.get("PAYMENT-SIGNATURE")).toBeNull();
        return jsonResponse(402, required, {
          "PAYMENT-REQUIRED": encodeBase64Json(required),
        });
      }
      const encoded = headers.get("PAYMENT-SIGNATURE");
      expect(encoded).toBeTruthy();
      const payload = decodeBase64Json(encoded || "");
      expect(payload.x402Version).toBe(2);
      expect(payload.payload.signature).toBe(SIGNATURE);
      expect(payload.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
      expect(payload.payload.authorization.value).toBe("10000000");
      expect(payload.accepted.network).toBe(X402_NETWORK);
      return jsonResponse(200, { ok: true });
    },
    getProvider: () =>
      mockProvider({ calls: providerCalls, chainId: "0x1" }),
    now: () => 1_700_000_000_000,
    randomNonce: () => "0x" + "11".repeat(32),
    getOrigin: () => ORIGIN,
    getX402: () => x402State,
    getNetworkChainId: () => 43113,
    getAuthGeneration: () => 1,
  });
  const outcome = await session.pay(pendingOrder);
  expect(outcome.kind).toBe("completed");
  expect(providerCalls.map((c) => c.method)).toEqual([
    "eth_requestAccounts",
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
    "eth_signTypedData_v4",
  ]);
  const typed = JSON.parse(
    String(
      (providerCalls.find((c) => c.method === "eth_signTypedData_v4")
        ?.params as [string, string])[1],
    ),
  );
  expect(typed.primaryType).toBe("TransferWithAuthorization");
  expect(typed.domain.chainId).toBe(43113);
  expect(typed.domain.verifyingContract).toBe(CIRCLE_FUJI_USDC_ASSET);
  expect(typed.message.validAfter).toBe("1699999940");
  expect(typed.message.validBefore).toBe("1700000300");
});

test("mismatched 402 never touches the wallet", async () => {
  const providerCalls: Array<{ method: string }> = [];
  const required = paymentRequired({
    resource: { url: "https://evil.example/pay" },
  });
  const session = createX402Pay({
    payloads: new Map(),
    fetch: async () =>
      jsonResponse(402, required, {
        "PAYMENT-REQUIRED": encodeBase64Json(required),
      }),
    getProvider: () => mockProvider({ calls: providerCalls }),
    now: () => 1_700_000_000_000,
    getOrigin: () => ORIGIN,
    getX402: () => x402State,
    getNetworkChainId: () => 43113,
    getAuthGeneration: () => 1,
  });
  await expect(session.pay(pendingOrder)).rejects.toThrow(
    "付款信息与本单不符，未向钱包发起确认。",
  );
  expect(providerCalls).toHaveLength(0);
});

test("wallet rejection does not auto-sign or keep a payload", async () => {
  const required = paymentRequired();
  const session = createX402Pay({
    payloads: new Map(),
    fetch: async () =>
      jsonResponse(402, required, {
        "PAYMENT-REQUIRED": encodeBase64Json(required),
      }),
    getProvider: () => mockProvider({ reject: "sign" }),
    now: () => 1_700_000_000_000,
    getOrigin: () => ORIGIN,
    getX402: () => x402State,
    getNetworkChainId: () => 43113,
    getAuthGeneration: () => 1,
  });
  await expect(session.pay(pendingOrder)).rejects.toThrow(
    "已取消确认，付款未发送。",
  );
  expect(session.payloads.size).toBe(0);
});

test("network error after signing retries the same payload without a new nonce", async () => {
  const required = paymentRequired();
  const providerCalls: Array<{ method: string }> = [];
  let step = 0;
  const signatures: string[] = [];
  const session = createX402Pay({
    payloads: new Map(),
    fetch: async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      step += 1;
      if (step === 1) {
        return jsonResponse(402, required, {
          "PAYMENT-REQUIRED": encodeBase64Json(required),
        });
      }
      const encoded = headers.get("PAYMENT-SIGNATURE") || "";
      signatures.push(encoded);
      if (step === 2) {
        const err = new TypeError("Failed to fetch");
        throw err;
      }
      return jsonResponse(202, { ok: true });
    },
    getProvider: () => mockProvider({ calls: providerCalls }),
    now: () => 1_700_000_000_000,
    randomNonce: () => "0x" + "22".repeat(32),
    getOrigin: () => ORIGIN,
    getX402: () => x402State,
    getNetworkChainId: () => 43113,
    getAuthGeneration: () => 1,
  });
  await expect(session.pay(pendingOrder)).rejects.toThrow(
    "网络中断，可再试一次。不会重新扣款。",
  );
  expect(session.payloads.size).toBe(1);
  const outcome = await session.pay(pendingOrder);
  expect(outcome.kind).toBe("processing");
  expect(signatures).toHaveLength(2);
  expect(signatures[0]).toBe(signatures[1]);
  expect(
    providerCalls.filter((c) => c.method === "eth_signTypedData_v4"),
  ).toHaveLength(1);
  expect(session.payloads.size).toBe(0);
});

test("missing wallet is a clear error after 402 verification", async () => {
  const required = paymentRequired();
  const session = createX402Pay({
    payloads: new Map(),
    fetch: async () =>
      jsonResponse(402, required, {
        "PAYMENT-REQUIRED": encodeBase64Json(required),
      }),
    getProvider: () => null,
    now: () => 1_700_000_000_000,
    getOrigin: () => ORIGIN,
    getX402: () => x402State,
    getNetworkChainId: () => 43113,
    getAuthGeneration: () => 1,
  });
  await expect(session.pay(pendingOrder)).rejects.toThrow(
    "未检测到钱包，请先安装并解锁。",
  );
});

test("user-rejected detection and checkout URL exactness", () => {
  const err = new Error("User rejected the request.");
  (err as Error & { code: number }).code = 4001;
  expect(isUserRejected(err)).toBe(true);
  expect(
    checkoutURLFromOrigin(ORIGIN, ORDER_ID),
  ).toBe(
    "https://partner.bflabs.app/api/x402/orders/11111111-1111-4111-8111-111111111111/pay",
  );
});

test('wallet RPC signs the full EIP712 domain and signature recovers correctly', async () => {
  const {startX402LocalChain} = await import('../scripts/x402-local-chain.ts');
  const {buildTransferTypedData} = await import('../public/app.js');
  const {recoverTypedDataAddress} = await import('viem');
  const c = await startX402LocalChain();
  try {
    const typed = buildTransferTypedData({from:c.payer.address,to:c.treasury,value:'10000000',validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce:'0x'+'cd'.repeat(32)}, {asset:c.token,extra:{name:'USD Coin',version:'2'}});
    const signature = await c.server.provider.request({method:'eth_signTypedData_v4',params:[c.payer.address,typed]});
    const recovered = await recoverTypedDataAddress({...typed,signature:signature as `0x${string}`} as Parameters<typeof recoverTypedDataAddress>[0]);
    expect(recovered.toLowerCase()).toBe(c.payer.address.toLowerCase());
  } finally { await c.server.close(); }
}, 30000);

test('late checkout 401 cannot log out a newer account session', async () => {
  let generation=1; let logoutCalls=0;
  const checkout=createX402Pay({payloads:new Map(),fetch:async()=>{generation=2;return jsonResponse(401,{error:'old session'});},getAuthGeneration:()=>generation,onUnauthorized:()=>logoutCalls++});
  await expect(checkout.pay(pendingOrder)).rejects.toThrow();
  expect(logoutCalls).toBe(0);
});
