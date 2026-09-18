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
  requestId?: string;
  chainId?: number;
  token?: Address;
};

export type CommissionScope = 'demo' | 'global';
export type CommissionRateSource =
  | 'demo'
  | 'default'
  | 'override'
  | 'disabled'
  | 'unavailable';

export type CommissionState = {
  rate: string | null;
  scope: CommissionScope;
  rateSource: CommissionRateSource;
  basis: 'actual_payment';
  lockedAt: 'order_creation';
};

export type SourceBalances = {
  available: string;
  pending: string;
  paid: string;
  consumed: string;
  commissionRate?: string;
  commissionRateSource?: string;
};

export interface Source {
  kind: SourceKind;
  pull(): Promise<SourceItem[]>;
  complete(payout: PayoutRecord): Promise<void>;
  balances(): Promise<SourceBalances | null>;
  lastError?(): string | null;
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
  requestId: string | null;
  externalId: number | null;
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
    error?: string;
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
  commission: CommissionState;
  sourceError?: string;
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

export const PROVIDER_FAILURE = '结算依赖暂时不可用。';

export function sanitizeError(err: unknown): string {
  if (err instanceof ServiceError) return err.message;
  return PROVIDER_FAILURE;
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
