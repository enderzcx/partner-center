import { test, expect } from "bun:test";
import { createStore } from "../src/store.ts";
import { createWorker } from "../src/worker.ts";
import { createFixtureSource, createBeefApiSource } from "../src/source.ts";
import { runtimeConfig } from "../src/config.ts";
const address = "0x0000000000000000000000000000000000000002" as const;
const token = "0x0000000000000000000000000000000000000003" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const cfg = () =>
  runtimeConfig({
    chain: {
      rpcUrl: "http://127.0.0.1:1",
      chainId: 31337,
      contract: address,
      token,
      privateKey: `0x${"1".padStart(64, "0")}`,
    },
    maturityMs: 0,
  });
const noFunds = {
  prepare: async () => {
    throw Error("not funded");
  },
  broadcast: async () => {},
  inspect: async () => "pending" as const,
  balances: async () => ({ token: "0", gas: "0" }),
};
for (const mode of ["aggregate", "residual"] as const)
  test(`mature ${mode} earnings remain settleable`, async () => {
    const store = createStore({ path: ":memory:" });
    try {
      store.setWallet(address);
      store.setAutoSettle(true);
      if (mode === "aggregate") {
        store.addCommission(600000n);
        store.addCommission(600000n);
      } else {
        store.addCommission(10000000n);
        store.transfer(1000000n);
      }
      await createWorker({
        store,
        chain: noFunds,
        source: createFixtureSource(store),
        config: cfg(),
      }).tick();
      const expected = mode === "aggregate" ? 1200000n : 9000000n;
      expect(store.listPayouts().length).toBeGreaterThan(0);
      expect(
        store.listPayouts().reduce((sum, row) => sum + row.amount, 0n),
      ).toBe(expected);
      expect(store.getPartner().pending).toBe(expected);
      expect(store.getPartner().available).toBe(0n);
    } finally {
      store.close();
    }
  });
test("source polling survives a crash before local import; completion requires matching source attestation", async () => {
  let responseMode: "404" | "wrong" = "404";
  const row = {
    id: 1,
    request_id: "acceptance-source-0001",
    user_id: 1,
    recipient: address,
    amount_usdc: "1000000",
    chain_id: 31337,
    token,
    status: "reserved",
    created_at: Math.floor(Date.now() / 1000),
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname.endsWith("/complete")) {
        return responseMode === "404"
          ? new Response("missing", { status: 404 })
          : Response.json({
              success: true,
              data: {
                ...row,
                status: "completed",
                transaction_hash: `0x${"cd".repeat(32)}`,
              },
            });
      }
      return Response.json({
        success: true,
        data: Number(u.searchParams.get("after_id")) >= 1 ? [] : [row],
      });
    },
  });
  const store = createStore({ path: ":memory:" });
  try {
    const source = createBeefApiSource(store, {
      ...cfg(),
      source: "beefapi",
      beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
      beefapiToken: "local-acceptance-only".repeat(2),
    });
    const first = await source.pull();
    expect(first).toHaveLength(1);
    const afterCrash = await source.pull();
    expect(afterCrash).toHaveLength(1);
    const imported = store.importReservation(first[0]!);
    const payout = { ...imported, status: "confirmed" as const, txHash: hash };
    await expect(source.complete(payout)).rejects.toThrow();
    responseMode = "wrong";
    await expect(source.complete(payout)).rejects.toThrow();
  } finally {
    server.stop(true);
    store.close();
  }
});
test("already frozen source settles automatically without local wallet or auto switch", async () => {
  const store = createStore({ path: ":memory:" });
  try {
    const source = {
      kind: "beefapi" as const,
      pull: async () => [
        {
          sourceId: "beefapi:1:accepted-external-0001",
          recipient: address,
          amount: 100n,
          alreadyFrozen: true,
          createdAt: Date.now(),
        },
      ],
      balances: async () => null,
      complete: async () => {},
    };
    const chain = {
      ...noFunds,
      prepare: async () => ({ rawTransaction: hash, hash }),
      inspect: async () => "confirmed" as const,
    };
    await createWorker({
      store,
      chain,
      source,
      config: { ...cfg(), source: "beefapi", maturityMs: 60000 },
    }).tick();
    expect(store.getPartner().autoSettle).toBe(false);
    expect(store.listPayouts()[0]?.status).toBe("completed");
  } finally {
    store.close();
  }
});

test("aggregate splits at single payout cap without stranding remaining income", async () => {
  const store = createStore({ path: ":memory:" });
  try {
    store.setWallet(address);
    store.setAutoSettle(true);
    store.addCommission(1_000_000_000_000n);
    store.addCommission(1_000_000n);
    const worker = createWorker({
      store,
      chain: noFunds,
      source: createFixtureSource(store),
      config: cfg(),
    });
    await worker.tick();
    await worker.tick();
    expect(store.listPayouts()).toHaveLength(2);
    expect(
      store.listPayouts().every((p) => p.amount <= 1_000_000_000_000n),
    ).toBe(true);
    expect(store.getPartner().available).toBe(0n);
    expect(store.getPartner().pending).toBe(1_000_001_000_000n);
  } finally {
    store.close();
  }
});
test("non-advancing source pagination fails visibly instead of keeping worker busy forever", async () => {
  const row = {
    id: 1,
    request_id: "page-regression-0001",
    user_id: 1,
    recipient: address,
    amount_usdc: "1000000",
    chain_id: 31337,
    token,
    status: "reserved",
    created_at: 1,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ success: true, data: Array(100).fill(row) }),
  });
  const store = createStore({ path: ":memory:" });
  try {
    const source = createBeefApiSource(store, {
      ...cfg(),
      source: "beefapi",
      beefapiBaseUrl: `http://127.0.0.1:${server.port}`,
      beefapiToken: "test".repeat(8),
    });
    await expect(source.pull()).rejects.toThrow("分页未推进");
  } finally {
    server.stop(true);
    store.close();
  }
});
