import { getAddress, isAddress } from 'viem';
import type { RuntimeConfig } from './config.ts';
import { isLoopbackHost } from './config.ts';
import { parseAmount } from './money.ts';
import type { Store } from './store.ts';
import {
  type Address,
  type PayoutRecord,
  type Source,
  type SourceItem,
  ServiceError,
  sanitizeError,
} from './types.ts';

type Envelope = {
  success?: unknown;
  message?: unknown;
  data?: unknown;
  reservations?: unknown;
  items?: unknown;
  list?: unknown;
  rows?: unknown;
};

function unwrap(json: unknown): unknown {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return json;
  const body = json as Envelope;
  if (body.success === false) {
    throw new ServiceError(502, sanitizeError(String(body.message ?? '来源服务返回失败。')));
  }
  const data = 'data' in body ? body.data : json;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const nested = data as Envelope;
    for (const key of ['reservations', 'items', 'list', 'rows'] as const) {
      if (Array.isArray(nested[key])) return nested[key];
    }
    return data;
  }
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceError(502, '来源数据格式无法识别。');
  }
  return value as Record<string, unknown>;
}

export function createFixtureSource(store: Store): Source {
  return {
    kind: 'fixture',
    async pull() {
      return [];
    },
    async complete() {
      /* ledger completion is owned by the worker after this returns */
    },
    async balances() {
      const partner = store.getPartner();
      return {
        available: partner.available.toString(),
        pending: partner.pending.toString(),
        paid: partner.paid.toString(),
        consumed: partner.consumed.toString(),
      };
    },
  };
}

export function createBeefApiSource(store: Store, config: RuntimeConfig): Source {
  let url: URL;
  try {
    url = new URL(config.beefapiBaseUrl);
  } catch {
    throw new Error('BEEFAPI_TEST_BASE_URL 无效。');
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error('BEEFAPI_TEST_BASE_URL 必须是本机回环地址。');
  }
  const base = url.toString().replace(/\/$/, '');

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${config.beefapiToken}`,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      throw new ServiceError(502, sanitizeError(err));
    }
    if (res.status === 404) return null;
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ServiceError(502, '来源服务返回无法解析。');
      }
    }
    if (!res.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json
          ? String((json as Envelope).message ?? res.status)
          : `来源服务返回 ${res.status}`;
      throw new ServiceError(res.status === 401 ? 502 : 502, sanitizeError(message));
    }
    return unwrap(json);
  };

  return {
    kind: 'beefapi',
    async pull(): Promise<SourceItem[]> {
      const items: SourceItem[] = [];
      let after = store.getCursor('beefapi');
      for (;;) {
        const page = unwrap(
          await request(`/api/settlement-test/reservations?after_id=${after}&status=reserved`),
        );
        if (page == null) break;
        if (!Array.isArray(page)) throw new ServiceError(502, '来源结算单格式无法识别。');
        if (page.length === 0) break;
        for (const raw of page) {
          const row = asRecord(raw);
          const id = Number(row.id);
          if (!Number.isInteger(id) || id <= 0) continue;
          after = Math.max(after, id);
          if (Number(row.user_id) !== config.partnerUserId) continue;
          if (Number(row.chain_id) !== config.chain.chainId) continue;
          const tokenRaw = String(row.token ?? '');
          if (!isAddress(tokenRaw, { strict: false })) continue;
          if (getAddress(tokenRaw) !== getAddress(config.chain.token)) continue;
          if (String(row.status) !== 'reserved') continue;
          const recipientRaw = String(row.recipient ?? '');
          if (!isAddress(recipientRaw, { strict: false })) continue;
          let amount: bigint;
          try {
            amount = parseAmount(row.amount_usdc, '结算金额');
          } catch {
            continue;
          }
          items.push({
            sourceId: `beefapi:${id}`,
            recipient: getAddress(recipientRaw) as Address,
            amount,
            createdAt: Number(row.created_at ?? 0) > 10_000_000_000
              ? Number(row.created_at)
              : Number(row.created_at ?? 0) * 1000 || Date.now(),
            alreadyFrozen: true,
            numericId: id,
            chainId: Number(row.chain_id),
            token: getAddress(tokenRaw) as Address,
          });
        }
        store.setCursor('beefapi', after);
        if (page.length < 100) break;
      }
      return items;
    },
    async complete(payout: PayoutRecord) {
      const match = /^beefapi:(\d+)$/.exec(payout.sourceId);
      if (!match) throw new ServiceError(500, '来源编号无效。');
      const body = JSON.stringify({
        transaction_hash: payout.txHash,
        chain_id: config.chain.chainId,
        token: config.chain.token,
        recipient: payout.recipient,
        amount_usdc: payout.amount.toString(),
      });
      await request(`/api/settlement-test/reservations/${match[1]}/complete`, {
        method: 'POST',
        body,
      });
    },
    async balances() {
      try {
        const data = await request(`/api/settlement-test/partners/${config.partnerUserId}`);
        if (data == null) return null;
        const row = asRecord(data);
        const available = row.available_usdc;
        const pending = row.pending_usdc;
        const paid = row.paid_usdc;
        if (
          typeof available !== 'string' ||
          typeof pending !== 'string' ||
          typeof paid !== 'string'
        ) {
          return null;
        }
        return { available, pending, paid, consumed: '0' };
      } catch {
        return null;
      }
    },
  };
}

export function createSource(store: Store, config: RuntimeConfig): Source {
  return config.source === 'beefapi'
    ? createBeefApiSource(store, config)
    : createFixtureSource(store);
}
