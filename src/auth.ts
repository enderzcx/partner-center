import { getAddress, isAddress, recoverMessageAddress } from 'viem';
import { CHALLENGE_TTL_MS } from './config.ts';
import type { Address } from './types.ts';
import { ServiceError } from './types.ts';

export const COOKIE = 'sid';

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

export function allowedHost(hostHeader: string | null, port: number): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  if (port === 80) {
    allowed.add('127.0.0.1');
    allowed.add('localhost');
    allowed.add('[::1]');
  }
  return allowed.has(host);
}

export function originFromHost(hostHeader: string): string {
  return `http://${hostHeader}`;
}

export function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}

export function parseAddress(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new ServiceError(400, '钱包地址无效。');
  }
  return getAddress(value) as Address;
}

export function challengeMessage(input: {
  domain: string;
  userId: string;
  address: Address;
  nonce: string;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    'Settlement wallet binding',
    `Domain: ${input.domain}`,
    `User: ${input.userId}`,
    `Address: ${input.address}`,
    `Nonce: ${input.nonce}`,
    `Chain ID: ${input.chainId}`,
    `Issued at: ${new Date(input.issuedAt).toISOString()}`,
    `Expires at: ${new Date(input.expiresAt).toISOString()}`,
  ].join('\n');
}

export function issueChallenge(input: {
  domain: string;
  userId: string;
  address: Address;
  chainId: number;
  now: number;
}) {
  const nonce = `0x${crypto.randomUUID().replaceAll('-', '')}`;
  const issuedAt = input.now;
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;
  const message = challengeMessage({
    ...input,
    nonce,
    issuedAt,
    expiresAt,
  });
  return { nonce, issuedAt, expiresAt, message };
}

export async function recoverBoundAddress(message: string, signature: unknown): Promise<Address> {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new ServiceError(400, '签名无效。');
  }
  try {
    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
    return getAddress(recovered) as Address;
  } catch {
    throw new ServiceError(400, '签名无效。');
  }
}
