import { ServiceError } from './types.ts';

export const MAX_AMOUNT = 10n ** 12n;
export const MAX_LEDGER = 10n ** 15n;
export const DEFAULT_MIN_AMOUNT = 1_000_000n;

export function parseAmount(value: unknown, label = '金额'): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new ServiceError(400, `${label}必须是正整数字符串。`);
  }
  const amount = BigInt(value);
  if (amount > MAX_AMOUNT) {
    throw new ServiceError(400, `${label}超过单笔上限。`);
  }
  return amount;
}

export function formatAmount(value: bigint): string {
  if (value < 0n) throw new ServiceError(500, '账本金额异常。');
  return value.toString();
}

export function asBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new ServiceError(500, '账本金额无法读取。');
}

export function assertLedgerCap(...parts: bigint[]) {
  let total = 0n;
  for (const part of parts) {
    if (part < 0n) throw new ServiceError(500, '账本金额异常。');
    total += part;
    if (total > MAX_LEDGER) throw new ServiceError(400, '账本合计超过上限。');
  }
}
