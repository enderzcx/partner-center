import { getAddress, isAddress } from "viem";
import type { RuntimeConfig } from "./config.ts";
import { isLoopbackHost } from "./config.ts";
import { MAX_AMOUNT, parseAmount } from "./money.ts";
import type { Store } from "./store.ts";
import {
  type Address,
  type CommissionRateSource,
  type CommissionState,
  type PayoutRecord,
  type Source,
  type SourceBalances,
  type SourceItem,
  type SourceKind,
  type SourceOrder,
  ServiceError,
} from "./types.ts";

export const COMMISSION_BASIS = "actual_payment" as const;
export const COMMISSION_LOCKED_AT = "order_creation" as const;
export const FIXTURE_COMMISSION_RATE = "0.1";
export const DEFAULT_PAYMENT_AMOUNT_MINOR = "1000";
export const ORDER_RESERVATION_PREFIX = "order-";

const PAYMENT_MINOR_RE = /^(10000|[1-9][0-9]{0,3})$/;
const ORDER_REQUEST_ID_RE = /^[a-z0-9][a-z0-9_-]{9,73}$/;
const TRADE_NO_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const COMMISSION_USDC_RE = /^(0|[1-9][0-9]*)$/;

const RATE_RE = /^(0(\.[0-9]{1,18})?|1(\.0{1,18})?)$/;
const API_RATE_SOURCES = new Set(["default", "override", "disabled"]);
const DISPLAY_RATE_SOURCES = new Set([
  "demo",
  "default",
  "override",
  "disabled",
]);

export function orderReservationRequestId(requestId: string): string {
  return `${ORDER_RESERVATION_PREFIX}${requestId}`;
}

export function isOrderRequestId(value: string): boolean {
  if (!ORDER_REQUEST_ID_RE.test(value)) return false;
  const reservationId = orderReservationRequestId(value);
  return reservationId.length >= 16 && reservationId.length <= 80;
}

export function parsePaymentAmountMinor(
  value: unknown,
  fallback?: string,
): string {
  if (value == null || value === "") {
    if (fallback) return fallback;
    throw new ServiceError(400, "订单金额无效。");
  }
  if (typeof value !== "string" || !PAYMENT_MINOR_RE.test(value)) {
    throw new ServiceError(400, "订单金额无效。");
  }
  return value;
}

export function parseOrderRequestId(value: unknown): string {
  if (typeof value !== "string" || !isOrderRequestId(value)) {
    throw new ServiceError(400, "订单编号无效。");
  }
  return value;
}

export function parseSourceOrder(
  raw: unknown,
  partnerUserId: number,
): SourceOrder | "skip" {
  const row = asRecord(raw);
  if (row.user_id != null && Number(row.user_id) !== partnerUserId) {
    return "skip";
  }
  const requestId = row.request_id;
  if (typeof requestId !== "string" || !isOrderRequestId(requestId)) {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  const tradeNo = row.trade_no;
  if (typeof tradeNo !== "string" || !TRADE_NO_RE.test(tradeNo)) {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  const paymentAmountMinor = row.payment_amount_minor;
  if (
    typeof paymentAmountMinor !== "string" ||
    !PAYMENT_MINOR_RE.test(paymentAmountMinor)
  ) {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  const commissionRate = parseCommissionRate(row.commission_rate);
  if (commissionRate == null) {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  const statusRaw = row.status;
  if (statusRaw !== "pending" && statusRaw !== "paid") {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  const commissionUsdc = row.commission_usdc;
  if (
    typeof commissionUsdc !== "string" ||
    !COMMISSION_USDC_RE.test(commissionUsdc)
  ) {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  if (commissionUsdc !== "0") {
    const amount = BigInt(commissionUsdc);
    if (amount > MAX_AMOUNT) {
      throw new ServiceError(502, "来源订单格式无法识别。");
    }
  }
  if (statusRaw === "pending" && commissionUsdc !== "0") {
    throw new ServiceError(502, "来源订单格式无法识别。");
  }
  return {
    requestId,
    tradeNo,
    paymentAmountMinor,
    commissionRate,
    commissionUsdc,
    status: statusRaw,
  };
}

export function parseCommissionRate(value: unknown): string | null {
  if (typeof value !== "string" || !RATE_RE.test(value)) return null;
  return value;
}

export function parseCommissionRateSource(
  value: unknown,
  allowed: ReadonlySet<string> = DISPLAY_RATE_SOURCES,
): Exclude<CommissionRateSource, "unavailable"> | null {
  if (typeof value !== "string" || !allowed.has(value)) return null;
  return value as Exclude<CommissionRateSource, "unavailable">;
}

export function formatCommissionPercent(rate: string): string | null {
  if (parseCommissionRate(rate) == null) return null;
  const [intPart, frac = ""] = rate.split(".");
  if (intPart === "1") return "100";
  const padded = frac.padEnd(2, "0");
  const whole = padded.slice(0, 2).replace(/^0+(?=\d)/, "") || "0";
  const rest = padded.slice(2).replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
}

export function unavailableCommission(
  scope: CommissionState["scope"],
): CommissionState {
  return {
    rate: null,
    scope,
    rateSource: "unavailable",
    basis: COMMISSION_BASIS,
    lockedAt: COMMISSION_LOCKED_AT,
  };
}

export function commissionFromBalances(
  kind: SourceKind,
  balances: SourceBalances | null,
): CommissionState {
  const scope = kind === "fixture" ? "demo" : "global";
  if (!balances) return unavailableCommission(scope);
  const rate = parseCommissionRate(balances.commissionRate);
  const rateSource = parseCommissionRateSource(balances.commissionRateSource);
  if (rate == null || rateSource == null) return unavailableCommission(scope);
  if (kind === "fixture") {
    return rateSource === "demo"
      ? {
          rate,
          scope: "demo",
          rateSource: "demo",
          basis: COMMISSION_BASIS,
          lockedAt: COMMISSION_LOCKED_AT,
        }
      : unavailableCommission("demo");
  }
  if (rateSource === "demo") return unavailableCommission("global");
  return {
    rate,
    scope: "global",
    rateSource,
    basis: COMMISSION_BASIS,
    lockedAt: COMMISSION_LOCKED_AT,
  };
}

type Envelope = {
  success?: unknown;
  message?: unknown;
  data?: unknown;
};

function requireEnvelope(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new ServiceError(502, "来源服务返回无法识别。");
  }
  const body = json as Envelope;
  if (body.success !== true) {
    throw new ServiceError(502, "来源服务返回失败。");
  }
  if (!("data" in body)) throw new ServiceError(502, "来源服务返回无法识别。");
  return body.data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(502, "来源数据格式无法识别。");
  }
  return value as Record<string, unknown>;
}

function sameAddress(a: string, b: string): boolean {
  return (
    isAddress(a, { strict: false }) &&
    isAddress(b, { strict: false }) &&
    getAddress(a) === getAddress(b)
  );
}

export function beefapiSourceId(requestId: string, id: number): string {
  return `beefapi:${requestId}:${id}`;
}

export function createFixtureSource(store: Store): Source {
  return {
    kind: "fixture",
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
        commissionRate: FIXTURE_COMMISSION_RATE,
        commissionRateSource: "demo",
      };
    },
    lastError() {
      return null;
    },
  };
}

export function createBeefApiSource(
  _store: Store,
  config: RuntimeConfig,
): Source {
  let url: URL;
  try {
    url = new URL(config.beefapiBaseUrl);
  } catch {
    throw new Error("BEEFAPI_TEST_BASE_URL 无效。");
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error("BEEFAPI_TEST_BASE_URL 必须是本机回环地址。");
  }
  const base = url.toString().replace(/\/$/, "");
  let lastError: string | null = null;

  const fetchJson = async (
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; json: unknown }> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        redirect: "error",
        signal: init?.signal ?? AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${config.beefapiToken}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new ServiceError(502, "来源服务暂时不可用。");
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ServiceError(502, "来源服务返回无法解析。");
      }
    }
    return { status: res.status, json };
  };

  const parseRow = (raw: unknown): SourceItem | "skip" => {
    const row = asRecord(raw);
    if (Number(row.user_id) !== config.partnerUserId) return "skip";
    const id = Number(row.id);
    const requestId = String(row.request_id ?? "");
    if (!Number.isInteger(id) || id <= 0 || !requestId) {
      throw new ServiceError(502, "来源结算单缺少有效编号。");
    }
    if (Number(row.chain_id) !== config.chain.chainId) {
      throw new ServiceError(502, "来源结算单网络与当前配置不一致。");
    }
    const tokenRaw = String(row.token ?? "");
    if (
      !isAddress(tokenRaw, { strict: false }) ||
      getAddress(tokenRaw) !== getAddress(config.chain.token)
    ) {
      throw new ServiceError(502, "来源结算单代币与当前配置不一致。");
    }
    if (String(row.status) !== "reserved") return "skip";
    const recipientRaw = String(row.recipient ?? "");
    if (!isAddress(recipientRaw, { strict: false })) {
      throw new ServiceError(502, "来源结算单收款地址无效。");
    }
    const amount = parseAmount(row.amount_usdc, "结算金额");
    const createdRaw = Number(row.created_at ?? 0);
    return {
      sourceId: beefapiSourceId(requestId, id),
      recipient: getAddress(recipientRaw) as Address,
      amount,
      createdAt:
        createdRaw > 10_000_000_000
          ? createdRaw
          : createdRaw * 1000 || Date.now(),
      alreadyFrozen: true,
      numericId: id,
      requestId,
      chainId: Number(row.chain_id),
      token: getAddress(tokenRaw) as Address,
    };
  };

  return {
    kind: "beefapi",
    lastError() {
      return lastError;
    },
    async pull(): Promise<SourceItem[]> {
      lastError = null;
      const items: SourceItem[] = [];
      let after = 0;
      for (let pageCount = 0; ; pageCount++) {
        if (pageCount >= 100)
          throw new ServiceError(502, "来源结算单过多，请缩小测试数据范围。");
        const before = after;
        const { status, json } = await fetchJson(
          `/api/settlement-test/reservations?after_id=${after}&status=reserved`,
        );
        if (status === 404) throw new ServiceError(502, "来源服务暂时不可用。");
        if (status !== 200) throw new ServiceError(502, "来源服务暂时不可用。");
        const data = requireEnvelope(json);
        if (!Array.isArray(data))
          throw new ServiceError(502, "来源结算单格式无法识别。");
        if (data.length === 0) break;
        for (const raw of data) {
          const row = asRecord(raw);
          const id = Number(row.id);
          if (Number.isInteger(id) && id > after) after = id;
          try {
            const parsed = parseRow(raw);
            if (parsed !== "skip") items.push(parsed);
          } catch (err) {
            if (Number(row.user_id) === config.partnerUserId) {
              lastError =
                err instanceof ServiceError
                  ? err.message
                  : "来源结算单无法导入。";
            }
          }
        }
        if (data.length < 100) break;
        if (after <= before)
          throw new ServiceError(502, "来源分页未推进，请检查接入服务。");
      }
      return items;
    },
    async complete(payout: PayoutRecord) {
      const id = payout.externalId;
      if (!id || id <= 0) throw new ServiceError(502, "来源编号无效。");
      if (!payout.txHash)
        throw new ServiceError(502, "缺少链上回执，不能回写来源。");
      const { status, json } = await fetchJson(
        `/api/settlement-test/reservations/${id}/complete`,
        {
          method: "POST",
          body: JSON.stringify({
            transaction_hash: payout.txHash,
            chain_id: config.chain.chainId,
            token: config.chain.token,
            recipient: payout.recipient,
            amount_usdc: payout.amount.toString(),
          }),
        },
      );
      if (status === 404 || status !== 200) {
        throw new ServiceError(502, "来源回写未确认，将重试。");
      }
      let data: unknown;
      try {
        data = requireEnvelope(json);
      } catch {
        throw new ServiceError(502, "来源回写未确认，将重试。");
      }
      const row = asRecord(data);
      const hash = String(row.transaction_hash ?? "").toLowerCase();
      const expectedHash = payout.txHash.toLowerCase();
      const tokenRaw = String(row.token ?? "");
      const recipientRaw = String(row.recipient ?? "");
      const requestOk =
        !payout.requestId || String(row.request_id ?? "") === payout.requestId;
      if (
        Number(row.id) !== id ||
        String(row.status) !== "completed" ||
        hash !== expectedHash ||
        Number(row.chain_id) !== config.chain.chainId ||
        !sameAddress(tokenRaw, config.chain.token) ||
        !sameAddress(recipientRaw, payout.recipient) ||
        String(row.amount_usdc) !== payout.amount.toString() ||
        !requestOk
      ) {
        throw new ServiceError(502, "来源回写未确认，将重试。");
      }
    },
    async listOrders(): Promise<SourceOrder[]> {
      const { status, json } = await fetchJson("/api/settlement-test/orders");
      if (status === 404) throw new ServiceError(502, "来源服务暂时不可用。");
      if (status !== 200) throw new ServiceError(502, "来源服务暂时不可用。");
      const data = requireEnvelope(json);
      if (!Array.isArray(data)) {
        throw new ServiceError(502, "来源订单格式无法识别。");
      }
      const orders: SourceOrder[] = [];
      for (const raw of data) {
        const parsed = parseSourceOrder(raw, config.partnerUserId);
        if (parsed !== "skip") orders.push(parsed);
      }
      return orders;
    },
    async createOrder(input: {
      requestId: string;
      paymentAmountMinor: string;
    }): Promise<SourceOrder> {
      const requestId = parseOrderRequestId(input.requestId);
      const paymentAmountMinor = parsePaymentAmountMinor(
        input.paymentAmountMinor,
      );
      const { status, json } = await fetchJson("/api/settlement-test/orders", {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId,
          payment_amount_minor: paymentAmountMinor,
        }),
      });
      if (status === 404) throw new ServiceError(502, "来源服务暂时不可用。");
      if (status !== 200) throw new ServiceError(502, "来源服务暂时不可用。");
      const parsed = parseSourceOrder(
        requireEnvelope(json),
        config.partnerUserId,
      );
      if (
        parsed === "skip" ||
        parsed.requestId !== requestId ||
        parsed.paymentAmountMinor !== paymentAmountMinor ||
        parsed.status !== "pending" ||
        parsed.commissionUsdc !== "0"
      ) {
        throw new ServiceError(502, "来源订单格式无法识别。");
      }
      return parsed;
    },
    async payOrder(requestId: string): Promise<SourceOrder> {
      const id = parseOrderRequestId(requestId);
      const { status, json } = await fetchJson(
        `/api/settlement-test/orders/${encodeURIComponent(id)}/pay`,
        { method: "POST", body: "{}" },
      );
      if (status === 404) throw new ServiceError(502, "来源服务暂时不可用。");
      if (status !== 200) throw new ServiceError(502, "来源服务暂时不可用。");
      const parsed = parseSourceOrder(
        requireEnvelope(json),
        config.partnerUserId,
      );
      if (parsed === "skip" || parsed.requestId !== id || parsed.status !== "paid") {
        throw new ServiceError(502, "来源订单格式无法识别。");
      }
      return parsed;
    },
    async reserveFrozen(input: {
      requestId: string;
      recipient: Address;
      amountUsdc: string;
    }): Promise<SourceItem> {
      const { status, json } = await fetchJson(
        "/api/settlement-test/reservations",
        {
          method: "POST",
          body: JSON.stringify({
            request_id: input.requestId,
            user_id: config.partnerUserId,
            recipient: input.recipient,
            amount_usdc: input.amountUsdc,
          }),
        },
      );
      if (status === 409) {
        throw new ServiceError(409, "同一来源的金额或收款地址不能更改。");
      }
      if (status === 404 || status !== 200) {
        throw new ServiceError(502, "来源服务暂时不可用。");
      }
      const parsed = parseRow(requireEnvelope(json));
      if (parsed === "skip") {
        throw new ServiceError(502, "来源结算单无法导入。");
      }
      if (
        parsed.requestId !== input.requestId ||
        parsed.recipient.toLowerCase() !== input.recipient.toLowerCase() ||
        parsed.amount.toString() !== input.amountUsdc
      ) {
        throw new ServiceError(502, "来源结算单无法导入。");
      }
      return parsed;
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
        if (
          typeof available !== "string" ||
          typeof pending !== "string" ||
          typeof paid !== "string"
        ) {
          return null;
        }
        if (available === "" || pending === "" || paid === "") return null;
        const parsed: SourceBalances = {
          available,
          pending,
          paid,
          consumed: "",
        };
        const rate = parseCommissionRate(row.commission_rate);
        const rateSource = parseCommissionRateSource(
          row.commission_rate_source,
          API_RATE_SOURCES,
        );
        if (rate != null && rateSource != null) {
          parsed.commissionRate = rate;
          parsed.commissionRateSource = rateSource;
        }
        return parsed;
      } catch {
        return null;
      }
    },
  };
}

export function createSource(store: Store, config: RuntimeConfig): Source {
  return config.source === "beefapi"
    ? createBeefApiSource(store, config)
    : createFixtureSource(store);
}
