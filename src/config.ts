import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { getAddress, isAddress, isHex, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DEFAULT_MIN_AMOUNT } from './money.ts';
import type { Address, Hex, SourceKind } from './types.ts';
import { ServiceError } from './types.ts';

export const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const AUTH_COOKIE_MAX_AGE_SEC = 8 * 60 * 60;

export const CIRCLE_FUJI_USDC =
  '0x5425890298aed601595a70AB815c96711a31Bc65' as Address;
export const MERCHANT_ID = 'demo-merchant';
export const PARTNER_ID = 'demo-partner';
export const PARTNER_NAME = '演示推广者';
export const DEFAULT_PORT = 4311;
export const DEFAULT_TICK_MS = 30_000;
export const DEFAULT_MATURITY_MS = 60_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const BODY_LIMIT = 16 * 1024;

export type ChainConfig = {
  rpcUrl: string;
  chainId: 43113 | 31337;
  contract: Address;
  token: Address;
  privateKey: Hex;
  recipient?: Address;
};

export type RuntimeConfig = {
  host: string;
  port: number;
  chain: ChainConfig;
  source: SourceKind;
  beefapiBaseUrl: string;
  beefapiToken: string;
  partnerUserId: number;
  minAmount: bigint;
  maturityMs: number;
  tickMs: number;
  dbPath: string;
  lockPath: string;
  publicDir: string;
  merchantId: string;
  partnerId: string;
  partnerName: string;
  orderDemo: boolean;
  authEnabled: boolean;
  publicOrigin: string | null;
  merchantPasswordHash: string;
  promoterPasswordHash: string;
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.replace(/^\[|\]$/g, '').toLowerCase());
}

export function assertLoopbackBind(host: string) {
  if (!isLoopbackHost(host)) {
    throw new Error(`拒绝绑定非本机地址 ${host}。结算服务只监听 127.0.0.1。`);
  }
}

export function originOf(host: string, port: number): string {
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${h}:${port}`;
}

export function networkMeta(
  chainId: 43113 | 31337,
  token: string,
  extra?: { configured?: boolean; error?: string },
) {
  const configured = extra?.configured ?? true;
  const error = extra?.error;
  const base =
    chainId === 43113
      ? {
          name: 'Avalanche Fuji',
          chainId,
          explorer: 'https://testnet.snowtrace.io',
          configured,
          token,
        }
      : {
          name: 'Local testnet',
          chainId,
          explorer: '',
          configured,
          token,
        };
  return error ? { ...base, error } : base;
}

export function executorAddress(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address as Address;
}

export function runtimeFingerprint(config: RuntimeConfig, executor?: Address): string {
  const exec = executor ?? executorAddress(config.chain.privateKey);
  return keccak256(
    toHex(
      [
        config.source,
        config.source === 'beefapi' ? config.beefapiBaseUrl : '',
        config.partnerId,
        String(config.partnerUserId),
        String(config.chain.chainId),
        getAddress(config.chain.token),
        getAddress(config.chain.contract),
        getAddress(exec),
      ].join('|'),
    ),
  );
}

function requiredAddress(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new Error(`${label} 不是有效地址。`);
  }
  return getAddress(value) as Address;
}

function requiredKey(value: unknown, label: string): Hex {
  if (typeof value !== 'string' || !isHex(value) || value.length !== 66) {
    throw new Error(`${label} 必须是 32 字节十六进制私钥。`);
  }
  return value.toLowerCase() as Hex;
}

function requiredRpc(value: unknown, chainId: 43113 | 31337): string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    throw new Error('必须提供明确的 RPC 地址。');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('RPC 地址无效。');
  }
  if (chainId === 31337 && !isLoopbackHost(url.hostname)) {
    throw new Error('本地链 RPC 必须是本机回环地址。');
  }
  return value;
}

function intEnv(value: string | undefined, fallback: number, label: string): number {
  if (value == null || value === '') return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} 必须是整数。`);
  return Number(value);
}

function flagEnv(value: string | undefined, label: string): boolean {
  if (value == null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label} 只允许 true 或 false。`);
}

export function assertSupportedPasswordHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 30 || value.length > 512) {
    throw new Error(`${label} 必须是受支持的密码哈希。`);
  }
  const argon =
    /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;
  const bcrypt = /^\$2[abxy]\$\d{2}\$[A-Za-z0-9./]{53}$/;
  if (!argon.test(value) && !bcrypt.test(value)) {
    throw new Error(`${label} 必须是受支持的密码哈希。`);
  }
  return value;
}

export function parsePublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 必须是不含路径的 HTTPS 来源。');
  }
  if (url.protocol !== 'https:') {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 必须是不含路径的 HTTPS 来源。');
  }
  if (url.username || url.password) {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 必须是不含路径的 HTTPS 来源。');
  }
  if (url.search || url.hash) {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 必须是不含路径的 HTTPS 来源。');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 必须是不含路径的 HTTPS 来源。');
  }
  if (value !== url.origin) {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 必须是不含路径的 HTTPS 来源。');
  }
  return url.origin;
}

export function runtimeConfig(
  partial: Partial<RuntimeConfig> & { chain: ChainConfig },
): RuntimeConfig {
  const host = partial.host ?? '127.0.0.1';
  assertLoopbackBind(host);
  const chainId = partial.chain.chainId;
  if (chainId !== 31337 && chainId !== 43113) {
    throw new Error('只允许本地测试链 31337 或 Fuji 43113。');
  }
  const source = partial.source ?? 'fixture';
  const orderDemo = partial.orderDemo ?? false;
  const partnerUserId = partial.partnerUserId ?? 1;
  const authEnabled = partial.authEnabled ?? false;
  const publicOrigin = partial.publicOrigin ?? null;
  let merchantPasswordHash = partial.merchantPasswordHash ?? '';
  let promoterPasswordHash = partial.promoterPasswordHash ?? '';
  if (orderDemo && (source !== 'beefapi' || partnerUserId !== 1)) {
    throw new Error('测试订单演示只适用于 beefapi 来源。');
  }
  if (authEnabled) {
    merchantPasswordHash = assertSupportedPasswordHash(
      merchantPasswordHash,
      'SETTLEMENT_MERCHANT_PASSWORD_HASH',
    );
    promoterPasswordHash = assertSupportedPasswordHash(
      promoterPasswordHash,
      'SETTLEMENT_PROMOTER_PASSWORD_HASH',
    );
    if (merchantPasswordHash === promoterPasswordHash) {
      throw new Error('商家与推广者必须使用不同的凭据。');
    }
    if (partnerUserId !== 1) {
      throw new Error('认证演示只支持一个固定推广者。');
    }
  } else if (publicOrigin) {
    throw new Error('SETTLEMENT_PUBLIC_ORIGIN 需要开启认证。');
  }
  if (publicOrigin) {
    parsePublicOrigin(publicOrigin);
    if (chainId !== 43113) {
      throw new Error('公开来源只允许 Fuji 测试网。');
    }
    if (source !== 'beefapi' || !orderDemo) {
      throw new Error('公开来源需要订单演示。');
    }
  }
  return {
    host,
    port: partial.port ?? DEFAULT_PORT,
    chain: {
      ...partial.chain,
      chainId,
      contract: requiredAddress(partial.chain.contract, '结算合约'),
      token: requiredAddress(partial.chain.token, '代币'),
      privateKey: requiredKey(partial.chain.privateKey, '执行钱包私钥'),
      recipient: partial.chain.recipient
        ? requiredAddress(partial.chain.recipient, '测试收款地址')
        : undefined,
    },
    source,
    orderDemo,
    beefapiBaseUrl: partial.beefapiBaseUrl ?? '',
    beefapiToken: partial.beefapiToken ?? '',
    partnerUserId,
    minAmount: partial.minAmount ?? DEFAULT_MIN_AMOUNT,
    maturityMs: partial.maturityMs ?? DEFAULT_MATURITY_MS,
    tickMs: partial.tickMs ?? DEFAULT_TICK_MS,
    dbPath: partial.dbPath ?? join('.local', 'settlement.sqlite'),
    lockPath: partial.lockPath ?? join('.local', 'settlement.lock'),
    publicDir: partial.publicDir ?? join(import.meta.dir, '../public'),
    merchantId: partial.merchantId ?? MERCHANT_ID,
    partnerId: partial.partnerId ?? PARTNER_ID,
    partnerName: partial.partnerName ?? PARTNER_NAME,
    authEnabled,
    publicOrigin,
    merchantPasswordHash,
    promoterPasswordHash,
  };
}

type FileConfig = Partial<ChainConfig> & { testOnly?: boolean };

export function loadConfig(opts?: {
  cwd?: string;
  env?: Record<string, string | undefined>;
}): RuntimeConfig {
  const env = opts?.env ?? process.env;
  const cwd = opts?.cwd ?? process.cwd();
  const configPath = resolve(
    cwd,
    env.SETTLEMENT_CHAIN_CONFIG ?? join('.local', 'chain.json'),
  );
  let file: FileConfig | null = null;
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf8')) as FileConfig;
    } catch {
      throw new Error(`无法读取链配置 ${configPath}。`);
    }
  }

  const chainIdRaw = env.SETTLEMENT_CHAIN_ID ?? file?.chainId;
  const chainId = Number(chainIdRaw);
  if (chainId !== 31337 && chainId !== 43113) {
    throw new Error(
      '未配置结算链，拒绝以模拟出款启动。请提供 .local/chain.json 或 Fuji 环境变量（仅 31337/43113）。',
    );
  }

  const rpcUrl = requiredRpc(env.SETTLEMENT_RPC_URL ?? file?.rpcUrl, chainId);
  const contract = requiredAddress(
    env.SETTLEMENT_CONTRACT ?? file?.contract,
    '结算合约',
  );
  const token = requiredAddress(env.SETTLEMENT_TOKEN ?? file?.token, '代币');

  if (chainId === 43113 && getAddress(token) !== getAddress(CIRCLE_FUJI_USDC)) {
    throw new Error(
      `Fuji 代币必须固定为 Circle 官方测试 USDC ${CIRCLE_FUJI_USDC}。`,
    );
  }

  let privateKey: Hex;
  if (chainId === 43113) {
    if (!env.SETTLEMENT_PRIVATE_KEY) {
      throw new Error('Fuji 执行钱包私钥只能通过 SETTLEMENT_PRIVATE_KEY 提供，不能写在配置文件里。');
    }
    privateKey = requiredKey(env.SETTLEMENT_PRIVATE_KEY, '执行钱包私钥');
  } else {
    privateKey = requiredKey(
      env.SETTLEMENT_PRIVATE_KEY ?? file?.privateKey,
      '执行钱包私钥',
    );
  }

  const recipientRaw = env.SETTLEMENT_RECIPIENT ?? file?.recipient;
  const source = (env.SETTLEMENT_SOURCE ?? 'fixture') as SourceKind;
  if (source !== 'fixture' && source !== 'beefapi') {
    throw new Error('SETTLEMENT_SOURCE 只允许 fixture 或 beefapi。');
  }
  const orderDemoRaw = env.SETTLEMENT_ORDER_DEMO;
  let orderDemo = false;
  if (orderDemoRaw != null && orderDemoRaw !== '') {
    if (orderDemoRaw === 'true') orderDemo = true;
    else if (orderDemoRaw === 'false') orderDemo = false;
    else throw new Error('SETTLEMENT_ORDER_DEMO 只允许 true 或 false。');
  }

  const publicDir = env.SETTLEMENT_PUBLIC_DIR
    ? isAbsolute(env.SETTLEMENT_PUBLIC_DIR)
      ? env.SETTLEMENT_PUBLIC_DIR
      : resolve(cwd, env.SETTLEMENT_PUBLIC_DIR)
    : join(import.meta.dir, '../public');

  const cfg = runtimeConfig({
    host: env.SETTLEMENT_HOST ?? '127.0.0.1',
    port: intEnv(env.SETTLEMENT_PORT, DEFAULT_PORT, 'SETTLEMENT_PORT'),
    chain: {
      rpcUrl,
      chainId,
      contract,
      token,
      privateKey,
      recipient: recipientRaw
        ? requiredAddress(recipientRaw, '测试收款地址')
        : undefined,
    },
    source,
    beefapiBaseUrl: env.BEEFAPI_TEST_BASE_URL ?? '',
    beefapiToken: env.SETTLEMENT_TEST_TOKEN ?? '',
    partnerUserId: intEnv(env.SETTLEMENT_PARTNER_USER_ID, 1, 'SETTLEMENT_PARTNER_USER_ID'),
    minAmount: env.SETTLEMENT_MIN_AMOUNT
      ? BigInt(env.SETTLEMENT_MIN_AMOUNT)
      : DEFAULT_MIN_AMOUNT,
    maturityMs: intEnv(env.SETTLEMENT_MATURITY_MS, DEFAULT_MATURITY_MS, 'SETTLEMENT_MATURITY_MS'),
    tickMs: intEnv(env.SETTLEMENT_TICK_MS, DEFAULT_TICK_MS, 'SETTLEMENT_TICK_MS'),
    dbPath: resolve(cwd, env.SETTLEMENT_DB ?? join('.local', 'settlement.sqlite')),
    lockPath: resolve(cwd, env.SETTLEMENT_LOCK ?? join('.local', 'settlement.lock')),
    publicDir,
    orderDemo,
    authEnabled: flagEnv(env.SETTLEMENT_AUTH_ENABLED, 'SETTLEMENT_AUTH_ENABLED'),
    publicOrigin:
      env.SETTLEMENT_PUBLIC_ORIGIN && env.SETTLEMENT_PUBLIC_ORIGIN !== ''
        ? parsePublicOrigin(env.SETTLEMENT_PUBLIC_ORIGIN)
        : null,
    merchantPasswordHash: env.SETTLEMENT_MERCHANT_PASSWORD_HASH ?? '',
    promoterPasswordHash: env.SETTLEMENT_PROMOTER_PASSWORD_HASH ?? '',
  });

  if (cfg.source === 'beefapi') {
    if (!cfg.beefapiBaseUrl || !cfg.beefapiToken) {
      throw new Error('beefapi 来源需要 BEEFAPI_TEST_BASE_URL 与 SETTLEMENT_TEST_TOKEN。');
    }
    if (cfg.beefapiToken.length < 32) {
      throw new Error('SETTLEMENT_TEST_TOKEN 长度不足。');
    }
    let url: URL;
    try {
      url = new URL(cfg.beefapiBaseUrl);
    } catch {
      throw new Error('BEEFAPI_TEST_BASE_URL 无效。');
    }
    if (!isLoopbackHost(url.hostname)) {
      throw new Error('BEEFAPI_TEST_BASE_URL 必须是本机回环地址。');
    }
  }
  return cfg;
}

export function demoWalletAddress(config: RuntimeConfig): Address {
  if (config.chain.chainId !== 31337) {
    throw new ServiceError(403, '当前网络不能使用本地测试钱包。');
  }
  if (!config.chain.recipient) {
    throw new ServiceError(400, '本地链未配置测试收款地址。');
  }
  return config.chain.recipient;
}
