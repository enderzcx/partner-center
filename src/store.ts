import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAddress, isAddress, keccak256, toHex } from 'viem';
import { MERCHANT_ID, PARTNER_ID, PARTNER_NAME } from './config.ts';
import { asBigInt, assertLedgerCap, formatAmount, MAX_AMOUNT, MAX_LEDGER } from './money.ts';
import {
  type Address,
  type Hex,
  type PartnerRecord,
  type PayoutRecord,
  type PayoutStatus,
  type PublicPayout,
  ServiceError,
  toPublicPayout,
} from './types.ts';

export type Store = ReturnType<typeof createStore>;

type Clock = () => number;

const STATUSES = new Set<PayoutStatus>([
  'reserved',
  'prepared',
  'broadcast',
  'confirmed',
  'completed',
  'blocked',
]);

function payoutId(merchantId: string, sourceId: string): Hex {
  return keccak256(toHex(`${merchantId}/${sourceId}`));
}

function address(value: string, label = '地址'): Address {
  if (!isAddress(value, { strict: false })) {
    throw new ServiceError(400, `${label}无效。`);
  }
  return getAddress(value) as Address;
}

function mapPayout(row: Record<string, unknown>): PayoutRecord {
  const status = String(row.status);
  if (!STATUSES.has(status as PayoutStatus)) {
    throw new ServiceError(500, '出款状态异常。');
  }
  return {
    id: String(row.id) as Hex,
    sourceId: String(row.source_id),
    recipient: String(row.recipient) as Address,
    amount: asBigInt(row.amount),
    status: status as PayoutStatus,
    txHash: row.tx_hash ? (String(row.tx_hash) as Hex) : null,
    error: row.error ? String(row.error) : null,
    createdAt: Number(row.created_at),
    rawTransaction: row.raw_transaction ? (String(row.raw_transaction) as Hex) : null,
    alreadyFrozen: Number(row.already_frozen) === 1,
  };
}

export function createStore(opts: {
  path: string;
  now?: Clock;
  merchantId?: string;
  partnerId?: string;
  partnerName?: string;
}) {
  const now = opts.now ?? Date.now;
  const merchantId = opts.merchantId ?? MERCHANT_ID;
  const partnerId = opts.partnerId ?? PARTNER_ID;
  const partnerName = opts.partnerName ?? PARTNER_NAME;
  if (opts.path !== ':memory:') {
    mkdirSync(dirname(opts.path), { recursive: true, mode: 0o700 });
  }
  const db = new Database(opts.path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wallet TEXT NOT NULL DEFAULT '',
      auto_settle INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0 AND available <= ${MAX_LEDGER.toString()}),
      pending INTEGER NOT NULL DEFAULT 0 CHECK (pending >= 0 AND pending <= ${MAX_LEDGER.toString()}),
      paid INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0 AND paid <= ${MAX_LEDGER.toString()}),
      consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0 AND consumed <= ${MAX_LEDGER.toString()})
    );
    CREATE TABLE IF NOT EXISTS service (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      paused INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS commissions (
      source_id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= ${MAX_AMOUNT.toString()}),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      recipient TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= ${MAX_AMOUNT.toString()}),
      status TEXT NOT NULL,
      tx_hash TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      raw_transaction TEXT,
      already_frozen INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS payouts_status ON payouts(status);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      session_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      nonce TEXT NOT NULL,
      message TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cursors (
      source TEXT PRIMARY KEY,
      after_id INTEGER NOT NULL
    );
  `);
  db.run(
    `INSERT OR IGNORE INTO partner (id, name, wallet, auto_settle, available, pending, paid, consumed)
     VALUES (?, ?, '', 0, 0, 0, 0, 0)`,
    [partnerId, partnerName],
  );
  db.run(`INSERT OR IGNORE INTO service (id, paused) VALUES (1, 0)`);

  const tx = <T>(fn: () => T): T => db.transaction(fn)();

  const getPartner = (): PartnerRecord => {
    const row = db
      .query(
        `SELECT id, name, wallet, auto_settle, available, pending, paid, consumed FROM partner WHERE id = ?`,
      )
      .get(partnerId) as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      wallet: String(row.wallet ?? ''),
      autoSettle: Number(row.auto_settle) === 1,
      available: asBigInt(row.available),
      pending: asBigInt(row.pending),
      paid: asBigInt(row.paid),
      consumed: asBigInt(row.consumed),
    };
  };

  const getPayoutBySource = (sourceId: string): PayoutRecord | null => {
    const row = db.query(`SELECT * FROM payouts WHERE source_id = ?`).get(sourceId) as
      | Record<string, unknown>
      | null;
    return row ? mapPayout(row) : null;
  };

  const insertPayout = (item: {
    sourceId: string;
    recipient: Address;
    amount: bigint;
    alreadyFrozen: boolean;
    createdAt?: number;
  }): PayoutRecord => {
    const existing = getPayoutBySource(item.sourceId);
    if (existing) {
      if (
        existing.amount !== item.amount ||
        existing.recipient.toLowerCase() !== item.recipient.toLowerCase()
      ) {
        throw new ServiceError(409, '同一来源的金额或收款地址不能更改。');
      }
      return existing;
    }
    const id = payoutId(merchantId, item.sourceId);
    const createdAt = item.createdAt ?? now();
    db.run(
      `INSERT INTO payouts (id, source_id, recipient, amount, status, created_at, already_frozen)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
      [id, item.sourceId, item.recipient, item.amount.toString(), createdAt, item.alreadyFrozen ? 1 : 0],
    );
    return getPayoutBySource(item.sourceId)!;
  };

  return {
    close() {
      db.close();
    },
    now,
    merchantId,
    partnerId,
    getPartner,
    isPaused(): boolean {
      const row = db.query(`SELECT paused FROM service WHERE id = 1`).get() as { paused: number };
      return Number(row.paused) === 1;
    },
    setPaused(paused: boolean) {
      db.run(`UPDATE service SET paused = ? WHERE id = 1`, [paused ? 1 : 0]);
    },
    setWallet(wallet: string) {
      const value = address(wallet, '钱包地址');
      db.run(`UPDATE partner SET wallet = ? WHERE id = ?`, [value, partnerId]);
    },
    setAutoSettle(enabled: boolean) {
      tx(() => {
        const partner = getPartner();
        if (enabled && !partner.wallet) {
          throw new ServiceError(400, '请先绑定收款钱包，再开启自动结算。');
        }
        db.run(`UPDATE partner SET auto_settle = ? WHERE id = ?`, [enabled ? 1 : 0, partnerId]);
      });
    },
    addCommission(amount: bigint): string {
      if (amount <= 0n || amount > MAX_AMOUNT) {
        throw new ServiceError(400, '金额超过单笔上限。');
      }
      return tx(() => {
        const partner = getPartner();
        assertLedgerCap(
          partner.available,
          partner.pending,
          partner.paid,
          partner.consumed,
          amount,
        );
        const sourceId = `fixture:${crypto.randomUUID()}`;
        db.run(`INSERT INTO commissions (source_id, amount, created_at) VALUES (?, ?, ?)`, [
          sourceId,
          amount.toString(),
          now(),
        ]);
        db.run(`UPDATE partner SET available = available + ? WHERE id = ?`, [
          amount.toString(),
          partnerId,
        ]);
        return sourceId;
      });
    },
    transfer(amount: bigint) {
      if (amount <= 0n || amount > MAX_AMOUNT) {
        throw new ServiceError(400, '金额超过单笔上限。');
      }
      tx(() => {
        const partner = getPartner();
        if (partner.available < amount) {
          throw new ServiceError(409, '可用收益不足。');
        }
        assertLedgerCap(partner.consumed, amount);
        const result = db.run(
          `UPDATE partner SET available = available - ?, consumed = consumed + ?
           WHERE id = ? AND available >= ?`,
          [amount.toString(), amount.toString(), partnerId, amount.toString()],
        );
        if (result.changes !== 1) throw new ServiceError(409, '可用收益不足。');
      });
    },
    listUnimportedCommissions(): { sourceId: string; amount: bigint; createdAt: number }[] {
      const rows = db
        .query(
          `SELECT c.source_id, c.amount, c.created_at
           FROM commissions c
           LEFT JOIN payouts p ON p.source_id = c.source_id
           WHERE p.source_id IS NULL
           ORDER BY c.created_at ASC`,
        )
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        sourceId: String(row.source_id),
        amount: asBigInt(row.amount),
        createdAt: Number(row.created_at),
      }));
    },
    reserveCommission(sourceId: string, recipient: string): PayoutRecord {
      return tx(() => {
        const commission = db
          .query(`SELECT source_id, amount, created_at FROM commissions WHERE source_id = ?`)
          .get(sourceId) as Record<string, unknown> | null;
        if (!commission) throw new ServiceError(404, '找不到这笔佣金。');
        const amount = asBigInt(commission.amount);
        const existing = getPayoutBySource(sourceId);
        if (existing) {
          if (
            existing.amount !== amount ||
            existing.recipient.toLowerCase() !== address(recipient).toLowerCase()
          ) {
            throw new ServiceError(409, '同一来源的金额或收款地址不能更改。');
          }
          return existing;
        }
        const to = address(recipient, '收款地址');
        const partner = getPartner();
        if (partner.available < amount) throw new ServiceError(409, '可用收益不足。');
        const result = db.run(
          `UPDATE partner SET available = available - ?, pending = pending + ?
           WHERE id = ? AND available >= ?`,
          [amount.toString(), amount.toString(), partnerId, amount.toString()],
        );
        if (result.changes !== 1) throw new ServiceError(409, '可用收益不足。');
        return insertPayout({
          sourceId,
          recipient: to,
          amount,
          alreadyFrozen: false,
          createdAt: Number(commission.created_at),
        });
      });
    },
    importReservation(item: {
      sourceId: string;
      recipient: string;
      amount: bigint;
      alreadyFrozen: boolean;
      createdAt?: number;
    }): PayoutRecord {
      if (item.amount <= 0n || item.amount > MAX_AMOUNT) {
        throw new ServiceError(400, '金额超过单笔上限。');
      }
      const to = address(item.recipient, '收款地址');
      return tx(() => {
        const existing = getPayoutBySource(item.sourceId);
        if (existing) {
          if (
            existing.amount !== item.amount ||
            existing.recipient.toLowerCase() !== to.toLowerCase()
          ) {
            throw new ServiceError(409, '同一来源的金额或收款地址不能更改。');
          }
          return existing;
        }
        if (item.alreadyFrozen) {
          const partner = getPartner();
          assertLedgerCap(partner.pending, item.amount);
          db.run(`UPDATE partner SET pending = pending + ? WHERE id = ?`, [
            item.amount.toString(),
            partnerId,
          ]);
        } else {
          const partner = getPartner();
          if (partner.available < item.amount) throw new ServiceError(409, '可用收益不足。');
          const result = db.run(
            `UPDATE partner SET available = available - ?, pending = pending + ?
             WHERE id = ? AND available >= ?`,
            [item.amount.toString(), item.amount.toString(), partnerId, item.amount.toString()],
          );
          if (result.changes !== 1) throw new ServiceError(409, '可用收益不足。');
        }
        return insertPayout({ ...item, recipient: to });
      });
    },
    getPayout(id: string): PayoutRecord | null {
      const row = db.query(`SELECT * FROM payouts WHERE id = ?`).get(id) as
        | Record<string, unknown>
        | null;
      return row ? mapPayout(row) : null;
    },
    getPayoutBySource,
    listPayouts(): PayoutRecord[] {
      const rows = db
        .query(`SELECT * FROM payouts ORDER BY created_at DESC, source_id DESC`)
        .all() as Record<string, unknown>[];
      return rows.map(mapPayout);
    },
    publicPayouts(): PublicPayout[] {
      return this.listPayouts().map(toPublicPayout);
    },
    getInFlight(): PayoutRecord | null {
      const rows = db
        .query(`SELECT * FROM payouts WHERE status IN ('prepared', 'broadcast') ORDER BY created_at ASC`)
        .all() as Record<string, unknown>[];
      return rows[0] ? mapPayout(rows[0]) : null;
    },
    listByStatus(statuses: PayoutStatus[]): PayoutRecord[] {
      if (statuses.length === 0) return [];
      const placeholders = statuses.map(() => '?').join(',');
      const rows = db
        .query(
          `SELECT * FROM payouts WHERE status IN (${placeholders}) ORDER BY created_at ASC`,
        )
        .all(...statuses) as Record<string, unknown>[];
      return rows.map(mapPayout);
    },
    nextReserved(minAmount: bigint, nowMs: number, maturityMs: number): PayoutRecord | null {
      const rows = db
        .query(`SELECT * FROM payouts WHERE status = 'reserved' ORDER BY created_at ASC`)
        .all() as Record<string, unknown>[];
      for (const row of rows) {
        const payout = mapPayout(row);
        if (payout.amount < minAmount) continue;
        if (!payout.alreadyFrozen && nowMs < payout.createdAt + maturityMs) continue;
        return payout;
      }
      return null;
    },
    persistPrepared(id: string, rawTransaction: Hex, hash: Hex) {
      tx(() => {
        const current = this.getPayout(id);
        if (!current || current.status !== 'reserved') {
          throw new ServiceError(409, '这笔出款还不能签名。');
        }
        const inflight = db
          .query(
            `SELECT id FROM payouts WHERE status IN ('prepared', 'broadcast') AND id != ?`,
          )
          .get(id) as { id: string } | null;
        if (inflight) throw new ServiceError(409, '已有未完成的出款交易。');
        const prepared = db.run(
          `UPDATE payouts SET status = 'prepared', raw_transaction = ?, tx_hash = ?, error = NULL WHERE id = ? AND status = 'reserved'`,
          [rawTransaction, hash, id],
        );
        if (prepared.changes !== 1) throw new ServiceError(409, '这笔出款还不能签名。');
      });
    },
    markBroadcast(id: string) {
      const result = db.run(
        `UPDATE payouts SET status = 'broadcast' WHERE id = ? AND status IN ('prepared', 'broadcast') AND raw_transaction IS NOT NULL AND tx_hash IS NOT NULL`,
        [id],
      );
      if (result.changes !== 1) {
        const current = this.getPayout(id);
        if (current?.status !== 'broadcast') {
          throw new ServiceError(409, '这笔出款还不能广播。');
        }
      }
    },
    markConfirmed(id: string) {
      db.run(
        `UPDATE payouts SET status = 'confirmed', error = NULL WHERE id = ? AND status IN ('prepared', 'broadcast', 'confirmed')`,
        [id],
      );
    },
    blockPayout(id: string, error: string) {
      db.run(
        `UPDATE payouts SET status = 'blocked', error = ? WHERE id = ? AND status IN ('prepared', 'broadcast', 'blocked')`,
        [error, id],
      );
    },
    setPayoutError(id: string, error: string) {
      db.run(`UPDATE payouts SET error = ? WHERE id = ?`, [error, id]);
    },
    completePayout(id: string) {
      tx(() => {
        const current = this.getPayout(id);
        if (!current) throw new ServiceError(404, '找不到这笔出款。');
        if (current.status === 'completed') return;
        if (current.status !== 'confirmed') {
          throw new ServiceError(409, '链上回执尚未确认，不能记为完成。');
        }
        const result = db.run(
          `UPDATE payouts SET status = 'completed', error = NULL WHERE id = ? AND status = 'confirmed'`,
          [id],
        );
        if (result.changes !== 1) return;
        const ledger = db.run(
          `UPDATE partner SET pending = pending - ?, paid = paid + ? WHERE id = ? AND pending >= ?`,
          [current.amount.toString(), current.amount.toString(), partnerId, current.amount.toString()],
        );
        if (ledger.changes !== 1) throw new ServiceError(500, '账本金额异常。');
      });
    },
    createSession(): string {
      const id = crypto.randomUUID();
      db.run(`INSERT INTO sessions (id, created_at) VALUES (?, ?)`, [id, now()]);
      return id;
    },
    hasSession(id: string): boolean {
      return !!db.query(`SELECT id FROM sessions WHERE id = ?`).get(id);
    },
    putChallenge(row: {
      sessionId: string;
      address: Address;
      nonce: string;
      message: string;
      issuedAt: number;
      expiresAt: number;
    }) {
      db.run(
        `INSERT INTO challenges (session_id, address, nonce, message, issued_at, expires_at, consumed)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(session_id) DO UPDATE SET
           address = excluded.address,
           nonce = excluded.nonce,
           message = excluded.message,
           issued_at = excluded.issued_at,
           expires_at = excluded.expires_at,
           consumed = 0`,
        [row.sessionId, row.address, row.nonce, row.message, row.issuedAt, row.expiresAt],
      );
    },
    getChallenge(sessionId: string) {
      const row = db.query(`SELECT * FROM challenges WHERE session_id = ?`).get(sessionId) as
        | Record<string, unknown>
        | null;
      if (!row) return null;
      return {
        sessionId: String(row.session_id),
        address: String(row.address) as Address,
        nonce: String(row.nonce),
        message: String(row.message),
        issuedAt: Number(row.issued_at),
        expiresAt: Number(row.expires_at),
        consumed: Number(row.consumed) === 1,
      };
    },
    consumeChallenge(sessionId: string) {
      const result = db.run(
        `UPDATE challenges SET consumed = 1 WHERE session_id = ? AND consumed = 0`,
        [sessionId],
      );
      if (result.changes !== 1) throw new ServiceError(409, '验证信息已使用，请重新发起。');
    },
    getCursor(source: string): number {
      const row = db.query(`SELECT after_id FROM cursors WHERE source = ?`).get(source) as
        | { after_id: number }
        | null;
      return row ? Number(row.after_id) : 0;
    },
    setCursor(source: string, afterId: number) {
      db.run(
        `INSERT INTO cursors (source, after_id) VALUES (?, ?)
         ON CONFLICT(source) DO UPDATE SET after_id = excluded.after_id`,
        [source, afterId],
      );
    },
    partnerPublic(balances?: { available: string; pending: string; paid: string; consumed: string }) {
      const partner = getPartner();
      return {
        id: partner.id,
        name: partner.name,
        wallet: partner.wallet,
        autoSettle: partner.autoSettle,
        available: balances?.available ?? formatAmount(partner.available),
        pending: balances?.pending ?? formatAmount(partner.pending),
        paid: balances?.paid ?? formatAmount(partner.paid),
        consumed: balances?.consumed ?? formatAmount(partner.consumed),
      };
    },
  };
}
