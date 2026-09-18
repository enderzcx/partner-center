import type { RuntimeConfig } from './config.ts';
import type { Store } from './store.ts';
import {
  type Address,
  type Chain,
  type PayoutRecord,
  type Source,
  ServiceError,
  sanitizeError,
} from './types.ts';

export type SettlementWorker = ReturnType<typeof createWorker>;

export function createWorker(opts: {
  store: Store;
  chain: Chain;
  source: Source;
  config: RuntimeConfig;
  now?: () => number;
}) {
  const now = opts.now ?? opts.store.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | undefined;
  let tail = Promise.resolve();

  const payoutArg = (row: PayoutRecord) => ({
    id: row.id,
    recipient: row.recipient,
    amount: row.amount,
  });

  const importSources = async () => {
    try {
      const items = await opts.source.pull();
      for (const item of items) {
        try {
          opts.store.importReservation(item);
        } catch (err) {
          if (err instanceof ServiceError && err.status === 409) continue;
          const existing = opts.store.getPayoutBySource(item.sourceId);
          if (existing) opts.store.setPayoutError(existing.id, sanitizeError(err));
        }
      }
    } catch (err) {
      /* source pull failure is retried next tick; do not mint payouts */
      void err;
    }
  };

  const completeConfirmed = async () => {
    for (const row of opts.store.listByStatus(['confirmed'])) {
      try {
        await opts.source.complete(row);
        opts.store.completePayout(row.id);
      } catch (err) {
        opts.store.setPayoutError(row.id, sanitizeError(err));
      }
    }
  };

  const inspectRow = async (row: PayoutRecord) => {
    if (!row.txHash) return;
    try {
      const result = await opts.chain.inspect(payoutArg(row), row.txHash);
      if (result === 'confirmed') opts.store.markConfirmed(row.id);
      else if (result === 'reverted') {
        opts.store.blockPayout(row.id, '链上回执显示这笔出款已回滚，已冻结待人工核查。');
      }
      return result;
    } catch (err) {
      opts.store.setPayoutError(row.id, sanitizeError(err));
      return 'uncertain' as const;
    }
  };

  const broadcastRow = async (row: PayoutRecord) => {
    if (!row.rawTransaction || !row.txHash) return;
    try {
      await opts.chain.broadcast(row.rawTransaction);
      opts.store.markBroadcast(row.id);
    } catch (err) {
      opts.store.setPayoutError(row.id, sanitizeError(err));
    }
  };

  const reconcile = async (paused: boolean) => {
    for (const row of opts.store.listByStatus(['prepared', 'broadcast'])) {
      if (row.status === 'prepared' && paused) continue;
      if (row.rawTransaction && !paused) await broadcastRow(row);
      const latest = opts.store.getPayout(row.id);
      if (!latest?.txHash) continue;
      const result = await inspectRow(latest);
      if (result === 'pending' && latest.status === 'broadcast' && latest.rawTransaction && !paused) {
        await broadcastRow(latest);
      }
    }
  };

  const reserveFixture = (paused: boolean, shouldStart: boolean) => {
    if (paused || !shouldStart || opts.source.kind !== 'fixture') return;
    const partner = opts.store.getPartner();
    if (!partner.wallet) return;
    const ts = now();
    for (const commission of opts.store.listUnimportedCommissions()) {
      if (commission.amount < opts.config.minAmount) continue;
      if (ts < commission.createdAt + opts.config.maturityMs) continue;
      try {
        opts.store.reserveCommission(commission.sourceId, partner.wallet as Address);
      } catch (err) {
        if (err instanceof ServiceError && err.status === 409) break;
        throw err;
      }
    }
  };

  const prepareNext = async (paused: boolean, shouldStart: boolean) => {
    if (paused || !shouldStart) return;
    if (opts.store.getInFlight()) return;
    const next = opts.store.nextReserved(
      opts.config.minAmount,
      now(),
      opts.config.maturityMs,
    );
    if (!next) return;
    try {
      const prepared = await opts.chain.prepare(payoutArg(next));
      opts.store.persistPrepared(next.id, prepared.rawTransaction, prepared.hash);
    } catch (err) {
      opts.store.setPayoutError(next.id, sanitizeError(err));
      return;
    }
    if (opts.store.isPaused()) return;
    const prepared = opts.store.getPayout(next.id);
    if (!prepared) return;
    await broadcastRow(prepared);
    const latest = opts.store.getPayout(next.id);
    if (latest?.txHash) await inspectRow(latest);
  };

  const tickUnlocked = async (force: boolean) => {
    const paused = opts.store.isPaused();
    const partner = opts.store.getPartner();
    const shouldStart = force || partner.autoSettle;
    await importSources();
    await reconcile(paused);
    await completeConfirmed();
    reserveFixture(paused, shouldStart);
    await prepareNext(paused, shouldStart);
    await completeConfirmed();
  };

  const tick = (input?: { force?: boolean }) => {
    const run = tail.then(() => tickUnlocked(input?.force === true));
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, opts.config.tickMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
