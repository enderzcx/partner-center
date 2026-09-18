import { ServiceError } from "../types.ts";
import {
  X402_FACILITATOR_TIMEOUT_MS,
  type X402Facilitator,
  type X402PaymentPayload,
  type X402PaymentRequirements,
  type X402SettleResult,
} from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mapSettleBody(data: Record<string, unknown>): X402SettleResult {
  const success = data.success === true;
  const transaction =
    typeof data.transaction === "string" ? data.transaction : "";
  const errorReason =
    typeof data.errorReason === "string" ? data.errorReason : undefined;
  const payer = typeof data.payer === "string" ? data.payer : undefined;
  const network = typeof data.network === "string" ? data.network : undefined;
  if (errorReason === "settlement_pending") {
    return { kind: "pending", transaction };
  }
  if (success && transaction) {
    return { kind: "success", transaction, payer, network };
  }
  return { kind: "failed", errorReason, transaction };
}

export function createHttpFacilitator(
  url: string,
  opts?: { timeoutMs?: number; fetch?: typeof fetch },
): X402Facilitator {
  const timeoutMs = opts?.timeoutMs ?? X402_FACILITATOR_TIMEOUT_MS;
  const doFetch = opts?.fetch ?? fetch;
  const base = url.replace(/\/$/, "");
  return {
    async settle(
      paymentPayload: X402PaymentPayload,
      paymentRequirements: X402PaymentRequirements,
    ): Promise<X402SettleResult> {
      let res: Response;
      try {
        res = await doFetch(`${base}/settle`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version,
            paymentPayload,
            paymentRequirements,
          }),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          return { kind: "timeout" };
        }
        throw new ServiceError(502, "付款正在确认，请稍后重试。");
      }
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          if (!res.ok) return { kind: "failed" };
          throw new ServiceError(502, "付款未完成。");
        }
      }
      const data = asRecord(json);
      if (!data) return { kind: "failed" };
      return mapSettleBody(data);
    },
  };
}
