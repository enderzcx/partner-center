export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export type PayoutStatus =
  | 'reserved'
  | 'prepared'
  | 'broadcast'
  | 'confirmed'
  | 'completed'
  | 'blocked';

export type Payout = { id: Hex; recipient: Address; amount: bigint };
export type Prepared = { rawTransaction: Hex; hash: Hex };

export interface Chain {
  prepare(p: Payout): Promise<Prepared>;
  broadcast(raw: Hex): Promise<void>;
  inspect(p: Payout, hash: Hex): Promise<'pending' | 'confirmed' | 'reverted'>;
  balances(): Promise<{ token: string; gas: string }>;
}

export type SourceKind = 'fixture' | 'beefapi';

export type SourceItem = {
  sourceId: string;
  recipient: Address;
  amount: bigint;
  createdAt: number;
  alreadyFrozen: boolean;
  numericId?: number;
  chainId?: number;
  token?: Address;
};

export type SourceBalances = {
  available: string;
  pending: string;
  paid: string;
  consumed: string;
};

export interface Source {
  kind: SourceKind;
  pull(): Promise<SourceItem[]>;
  complete(payout: PayoutRecord): Promise<void>;
  balances(): Promise<SourceBalances | null>;
}

export type PayoutRecord = {
  id: Hex;
  sourceId: string;
  recipient: Address;
  amount: bigint;
  status: PayoutStatus;
  txHash: Hex | null;
  error: string | null;
  createdAt: number;
  rawTransaction: Hex | null;
  alreadyFrozen: boolean;
};

export type PublicPayout = {
  id: string;
  sourceId: string;
  recipient: string;
  amount: string;
  status: PayoutStatus;
  txHash: string | null;
  error: string | null;
  createdAt: number;
};

export type PartnerRecord = {
  id: string;
  name: string;
  wallet: string;
  autoSettle: boolean;
  available: bigint;
  pending: bigint;
  paid: bigint;
  consumed: bigint;
};

export type AppState = {
  network: {
    name: string;
    chainId: number;
    explorer: string;
    configured: boolean;
    token: string;
  };
  paused: boolean;
  wallet: { token: string; gas: string };
  partner: {
    id: string;
    name: string;
    wallet: string;
    autoSettle: boolean;
    available: string;
    pending: string;
    paid: string;
    consumed: string;
  };
  payouts: PublicPayout[];
  source: SourceKind;
  minAmount: string;
};

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function sanitizeError(err: unknown): string {
  const raw =
    err instanceof ServiceError
      ? err.message
      : err instanceof Error
        ? err.message
        : '操作失败。';
  let msg = raw
    .replace(/Bearer\s+\S+/gi, '[已隐藏]')
    .replace(
      /SETTLEMENT_PRIVATE_KEY|SETTLEMENT_TEST_TOKEN|privateKey|Authorization/gi,
      '[已隐藏]',
    )
    .replace(/0x[0-9a-fA-F]{80,}/g, '[已隐藏]')
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, (m) =>
      m.length > 80 ? '[已隐藏]' : m,
    );
  msg = msg.replace(/\s+/g, ' ').trim();
  if (msg.length > 180) msg = `${msg.slice(0, 177)}...`;
  return msg || '操作失败。';
}

export function toPublicPayout(row: PayoutRecord): PublicPayout {
  return {
    id: row.id,
    sourceId: row.sourceId,
    recipient: row.recipient,
    amount: row.amount.toString(),
    status: row.status,
    txHash: row.txHash,
    error: row.error,
    createdAt: row.createdAt,
  };
}
