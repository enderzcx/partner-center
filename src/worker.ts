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
  let sourceError: string | null = null;

  const payoutArg = (row: PayoutRecord) => ({
    id: row.id,
    recipient: row.recipient,
    amount: row.amount,
  });

  const importSources = async () => {
    sourceError = null;
    try {
      const items = await opts.source.pull();
      const pullError = opts.source.lastError?.() ?? null;
      if (pullError) sourceError = pullError;
      for (const item of items) {
        try {
          opts.store.importReservation(item);
        } catch (err) {
          sourceError = sanitizeError(err);
        }
      }
    } catch (err) {
      sourceError = sanitizeError(err);
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

  const reconcile = async () => {
    for (const row of opts.store.listByStatus(['prepared', 'broadcast'])) {
      if (!row.txHash) continue;
      const result = await inspectRow(row);
      if (result === 'confirmed' || result === 'reverted') continue;
      if (opts.store.isPaused()) continue;
      if (result === 'pending' && row.rawTransaction) {
        await broadcastRow(row);
        const latest = opts.store.getPayout(row.id);
        if (latest?.txHash && !opts.store.isPaused()) await inspectRow(latest);
      }
    }
  };

  const reserveFixture = (paused: boolean, shouldStart: boolean) => {
    if (paused || !shouldStart || opts.source.kind !== 'fixture') return;
    const partner = opts.store.getPartner();
    if (!partner.wallet) return;
    try {
      opts.store.reserveMature({
        recipient: partner.wallet as Address,
        minAmount: opts.config.minAmount,
        nowMs: now(),
        maturityMs: opts.config.maturityMs,
      });
    } catch (err) {
      if (err instanceof ServiceError && err.status === 409) return;
      throw err;
    }
  };

  const prepareNext = async (paused: boolean, force: boolean) => {
    if (paused) return;
    if (opts.store.getInFlight()) return;
    const next = opts.store.nextReserved();
    if (!next) return;
    const partner = opts.store.getPartner();
    if (!next.alreadyFrozen && !force && !partner.autoSettle) return;
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
    if (opts.store.isPaused()) return;
    const latest = opts.store.getPayout(next.id);
    if (latest?.txHash) await inspectRow(latest);
  };

  const tickUnlocked = async (force: boolean) => {
    const partner = opts.store.getPartner();
    await importSources();
    await reconcile();
    await completeConfirmed();
    const paused = opts.store.isPaused();
    reserveFixture(paused, force || partner.autoSettle);
    await prepareNext(paused, force);
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
    getSourceError() {
      return sourceError;
    },
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
    drain() {
      return tail;
    },
  };
}
