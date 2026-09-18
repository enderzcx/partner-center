import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAbi } from "viem";
import { createStore } from "../src/store.ts";
import { createWorker } from "../src/worker.ts";
import { runtimeConfig } from "../src/config.ts";
import { EvmChain } from "../src/chain.ts";
import { startLocalChain } from "../scripts/local-chain.ts";

test("real EVM: lost broadcast reply, paused restart, failed callback, retry without second payment", async () => {
  const temp = mkdtempSync(join(tmpdir(), "settlement-acceptance-"));
  const local = await startLocalChain(0);
  let store = createStore({ path: join(temp, "ledger.sqlite") });
  try {
    const config = runtimeConfig({
      chain: { ...local.config, recipient: local.recipient },
      maturityMs: 0,
    });
    const real = new EvmChain(local.config);
    let broadcasts = 0,
      unreadable = true,
      callbackFails = true,
      callbacks = 0;
    const chain = {
      prepare: real.prepare.bind(real),
      balances: real.balances.bind(real),
      broadcast: async (raw: `0x${string}`) => {
        broadcasts++;
        await real.broadcast(raw);
        throw Error("reply lost after submission");
      },
      inspect: async (
        p: Parameters<EvmChain["inspect"]>[0],
        hash: `0x${string}`,
      ) => {
        if (unreadable) throw Error("RPC temporarily unavailable");
        return real.inspect(p, hash);
      },
    };
    const source = {
      kind: "fixture" as const,
      pull: async () => [],
      balances: async () => null,
      complete: async () => {
        callbacks++;
        if (callbackFails)
          throw Error("origin database temporarily unavailable");
      },
    };
    store.setWallet(local.recipient);
    store.setAutoSettle(true);
    store.addCommission(10_000_000n);
    await createWorker({ store, chain, source, config }).tick();
    const first = store.listPayouts()[0]!;
    expect(first.status).toBe("prepared");
    expect(first.txHash).toBeTruthy();
    expect(store.getPartner().pending).toBe(10_000_000n);
    store.setPaused(true);
    store.close();
    store = createStore({ path: join(temp, "ledger.sqlite") });
    unreadable = false;
    const restarted = createWorker({ store, chain, source, config });
    await restarted.tick();
    expect(store.listPayouts()[0]!.status).toBe("confirmed");
    expect(store.getPartner().pending).toBe(10_000_000n);
    callbackFails = false;
    await restarted.tick();
    await restarted.tick();
    const final = store.listPayouts()[0]!;
    expect(final.status).toBe("completed");
    expect(final.txHash).toBe(first.txHash);
    expect(broadcasts).toBe(1);
    expect(callbacks).toBeGreaterThan(1);
    expect(store.getPartner().pending).toBe(0n);
    expect(store.getPartner().paid).toBe(10_000_000n);
    const received = await local.publicClient.readContract({
      address: local.config.token,
      abi: parseAbi(["function balanceOf(address) view returns(uint256)"]),
      functionName: "balanceOf",
      args: [local.recipient],
    });
    expect(received).toBe(10_000_000n);
  } finally {
    store.close();
    await local.server.close();
    rmSync(temp, { recursive: true, force: true });
  }
}, 15000);
