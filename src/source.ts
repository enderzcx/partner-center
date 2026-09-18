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
} from './types.ts';

type Envelope = {
  success?: unknown;
  message?: unknown;
  data?: unknown;
};

function requireEnvelope(json: unknown): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new ServiceError(502, '来源服务返回无法识别。');
  }
  const body = json as Envelope;
  if (body.success !== true) {
    throw new ServiceError(502, '来源服务返回失败。');
  }
  if (!('data' in body)) throw new ServiceError(502, '来源服务返回无法识别。');
  return body.data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceError(502, '来源数据格式无法识别。');
  }
  return value as Record<string, unknown>;
}

function sameAddress(a: string, b: string): boolean {
  return isAddress(a, { strict: false }) && isAddress(b, { strict: false }) && getAddress(a) === getAddress(b);
}

export function beefapiSourceId(requestId: string, id: number): string {
  return `beefapi:${requestId}:${id}`;
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
    lastError() {
      return null;
    },
  };
}

export function createBeefApiSource(_store: Store, config: RuntimeConfig): Source {
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
  let lastError: string | null = null;

  const fetchJson = async (path: string, init?: RequestInit): Promise<{ status: number; json: unknown }> => {
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
    } catch {
      throw new ServiceError(502, '来源服务暂时不可用。');
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ServiceError(502, '来源服务返回无法解析。');
      }
    }
    return { status: res.status, json };
  };

  const parseRow = (raw: unknown): SourceItem | 'skip' => {
    const row = asRecord(raw);
    if (Number(row.user_id) !== config.partnerUserId) return 'skip';
    const id = Number(row.id);
    const requestId = String(row.request_id ?? '');
    if (!Number.isInteger(id) || id <= 0 || !requestId) {
      throw new ServiceError(502, '来源结算单缺少有效编号。');
    }
    if (Number(row.chain_id) !== config.chain.chainId) {
      throw new ServiceError(502, '来源结算单网络与当前配置不一致。');
    }
    const tokenRaw = String(row.token ?? '');
    if (!isAddress(tokenRaw, { strict: false }) || getAddress(tokenRaw) !== getAddress(config.chain.token)) {
      throw new ServiceError(502, '来源结算单代币与当前配置不一致。');
    }
    if (String(row.status) !== 'reserved') return 'skip';
    const recipientRaw = String(row.recipient ?? '');
    if (!isAddress(recipientRaw, { strict: false })) {
      throw new ServiceError(502, '来源结算单收款地址无效。');
    }
    const amount = parseAmount(row.amount_usdc, '结算金额');
    const createdRaw = Number(row.created_at ?? 0);
    return {
      sourceId: beefapiSourceId(requestId, id),
      recipient: getAddress(recipientRaw) as Address,
      amount,
      createdAt: createdRaw > 10_000_000_000 ? createdRaw : createdRaw * 1000 || Date.now(),
      alreadyFrozen: true,
      numericId: id,
      requestId,
      chainId: Number(row.chain_id),
      token: getAddress(tokenRaw) as Address,
    };
  };

  return {
    kind: 'beefapi',
    lastError() {
      return lastError;
    },
    async pull(): Promise<SourceItem[]> {
      lastError = null;
      const items: SourceItem[] = [];
      let after = 0;
      for (;;) {
        const { status, json } = await fetchJson(
          `/api/settlement-test/reservations?after_id=${after}&status=reserved`,
        );
        if (status === 404) throw new ServiceError(502, '来源服务暂时不可用。');
        if (status !== 200) throw new ServiceError(502, '来源服务暂时不可用。');
        const data = requireEnvelope(json);
        if (!Array.isArray(data)) throw new ServiceError(502, '来源结算单格式无法识别。');
        if (data.length === 0) break;
        for (const raw of data) {
          const row = asRecord(raw);
          const id = Number(row.id);
          if (Number.isInteger(id) && id > after) after = id;
          try {
            const parsed = parseRow(raw);
            if (parsed !== 'skip') items.push(parsed);
          } catch (err) {
            if (Number(row.user_id) === config.partnerUserId) {
              lastError = err instanceof ServiceError ? err.message : '来源结算单无法导入。';
            }
          }
        }
        if (data.length < 100) break;
      }
      return items;
    },
    async complete(payout: PayoutRecord) {
      const id = payout.externalId;
      if (!id || id <= 0) throw new ServiceError(502, '来源编号无效。');
      if (!payout.txHash) throw new ServiceError(502, '缺少链上回执，不能回写来源。');
      const { status, json } = await fetchJson(`/api/settlement-test/reservations/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          transaction_hash: payout.txHash,
          chain_id: config.chain.chainId,
          token: config.chain.token,
          recipient: payout.recipient,
          amount_usdc: payout.amount.toString(),
        }),
      });
      if (status === 404 || status !== 200) {
        throw new ServiceError(502, '来源回写未确认，将重试。');
      }
      let data: unknown;
      try {
        data = requireEnvelope(json);
      } catch {
        throw new ServiceError(502, '来源回写未确认，将重试。');
      }
      const row = asRecord(data);
      const hash = String(row.transaction_hash ?? '').toLowerCase();
      const expectedHash = payout.txHash.toLowerCase();
      const tokenRaw = String(row.token ?? '');
      const recipientRaw = String(row.recipient ?? '');
      const requestOk = !payout.requestId || String(row.request_id ?? '') === payout.requestId;
      if (
        Number(row.id) !== id ||
        String(row.status) !== 'completed' ||
        hash !== expectedHash ||
        Number(row.chain_id) !== config.chain.chainId ||
        !sameAddress(tokenRaw, config.chain.token) ||
        !sameAddress(recipientRaw, payout.recipient) ||
        String(row.amount_usdc) !== payout.amount.toString() ||
        !requestOk
      ) {
        throw new ServiceError(502, '来源回写未确认，将重试。');
      }
    },
    async balances() {
      try {
        const { status, json } = await fetchJson(
          `/api/settlement-test/partners/${config.partnerUserId}`,
        );
        if (status === 404) return null;
        if (status !== 200) return null;
        const data = requireEnvelope(json);
        const row = asRecord(data);
        const available = row.available_usdc;
        const pending = row.pending_usdc;
        const paid = row.paid_usdc;
        if (typeof available !== 'string' || typeof pending !== 'string' || typeof paid !== 'string') {
          return null;
        }
        if (available === '' || pending === '' || paid === '') return null;
        return { available, pending, paid, consumed: '' };
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
