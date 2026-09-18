import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  allowedHost,
  COOKIE,
  issueChallenge,
  originFromHost,
  parseAddress,
  parseCookies,
  recoverBoundAddress,
  securityHeaders,
  sessionCookie,
} from "./auth.ts";
import {
  assertLoopbackBind,
  BODY_LIMIT,
  demoWalletAddress,
  loadConfig,
  networkMeta,
  originOf,
  runtimeConfig,
  runtimeFingerprint,
  type RuntimeConfig,
} from "./config.ts";
import { acquireProcessLock } from "./lock.ts";
import { parseAmount } from "./money.ts";
import { createSource } from "./source.ts";
import { createStore, type Store } from "./store.ts";
import {
  type AppState,
  type Chain,
  type Source,
  ServiceError,
  sanitizeError,
} from "./types.ts";
import { createWorker, type SettlementWorker } from "./worker.ts";

export type { RuntimeConfig, Store, SettlementWorker, Chain, Source, AppState };
export {
  createStore,
  createWorker,
  createSource,
  loadConfig,
  runtimeConfig,
  runtimeFingerprint,
  acquireProcessLock,
};

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

export type SettlementApp = {
  fetch: (req: Request) => Promise<Response>;
  origin: string;
  store: Store;
  worker: SettlementWorker;
  config: RuntimeConfig;
};

function json(status: number, body: unknown, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...(extra ?? {}),
    },
  });
}

function fail(err: unknown): Response {
  if (err instanceof ServiceError)
    return json(err.status, { error: err.message });
  return json(500, { error: sanitizeError(err) });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ServiceError(415, "请使用 JSON 提交。");
  }
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader != null && lengthHeader !== "") {
    const length = Number(lengthHeader);
    if (!Number.isFinite(length) || length < 0 || length > BODY_LIMIT) {
      throw new ServiceError(413, "请求内容过大。");
    }
  }
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > BODY_LIMIT) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new ServiceError(413, "请求内容过大。");
    }
    chunks.push(value);
  }
  if (received === 0) return {};
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ServiceError(400, "请求内容无效。");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError(400, "请求内容无效。");
  }
}

async function loadEvmChain(config: RuntimeConfig): Promise<Chain> {
  const path = join(import.meta.dir, "chain.ts");
  if (!existsSync(path)) {
    throw new Error("缺少 src/chain.ts 链适配，拒绝以模拟出款启动。");
  }
  const mod = (await import(pathToFileURL(path).href)) as {
    EvmChain: new (c: {
      rpcUrl: string;
      chainId: 43113 | 31337;
      contract: `0x${string}`;
      token: `0x${string}`;
      privateKey: `0x${string}`;
    }) => Chain;
  };
  return new mod.EvmChain({
    rpcUrl: config.chain.rpcUrl,
    chainId: config.chain.chainId,
    contract: config.chain.contract,
    token: config.chain.token,
    privateKey: config.chain.privateKey,
  });
}

export function createApp(opts: {
  store: Store;
  worker: SettlementWorker;
  chain: Chain;
  source: Source;
  config: RuntimeConfig;
  publicDir?: string;
  now?: () => number;
}): SettlementApp {
  assertLoopbackBind(opts.config.host);
  const origin = originOf(opts.config.host, opts.config.port);
  const publicDir = opts.publicDir ?? opts.config.publicDir;
  const now = opts.now ?? opts.store.now ?? Date.now;

  const requireHost = (req: Request) => {
    const host = req.headers.get("host");
    if (!allowedHost(host, opts.config.port)) {
      throw new ServiceError(403, "请求主机不被允许。");
    }
    return host!;
  };

  const requireSession = (req: Request) => {
    const sid = parseCookies(req.headers.get("cookie"))[COOKIE];
    if (!sid || !opts.store.hasSession(sid)) {
      throw new ServiceError(401, "请从本页重新打开结算台。");
    }
    return sid;
  };

  const requireMutation = async (req: Request) => {
    const host = requireHost(req);
    const sid = requireSession(req);
    const originHeader = req.headers.get("origin");
    if (!originHeader || originHeader !== originFromHost(host)) {
      throw new ServiceError(403, "请求来源不被允许。");
    }
    const body = await readJson(req);
    return { sid, body };
  };

  const state = async (): Promise<AppState> => {
    let wallet = { token: "", gas: "" };
    let configured = true;
    let networkError: string | undefined;
    try {
      wallet = await opts.chain.balances();
    } catch (err) {
      wallet = { token: "", gas: "" };
      configured = false;
      networkError = sanitizeError(err);
    }
    const sourceBalances = await opts.source.balances();
    const partner = opts.store.partnerPublic(
      opts.source.kind === "beefapi"
        ? (sourceBalances ?? {
            available: "",
            pending: "",
            paid: "",
            consumed: "",
          })
        : (sourceBalances ?? undefined),
    );
    const sourceError = opts.worker.getSourceError() ?? undefined;
    return {
      network: networkMeta(opts.config.chain.chainId, opts.config.chain.token, {
        configured,
        error: networkError,
      }),
      paused: opts.store.isPaused(),
      wallet,
      partner,
      payouts: opts.store.publicPayouts(),
      source: opts.source.kind,
      minAmount: opts.config.minAmount.toString(),
      ...(sourceError ? { sourceError } : {}),
    };
  };

  const fetch = async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      if (req.method !== "GET" && req.method !== "POST") {
        return json(405, { error: "不支持的请求方法。" });
      }
      if (req.method === "GET" && STATIC_FILES[url.pathname]) {
        requireHost(req);
        const spec = STATIC_FILES[url.pathname];
        let headers: Record<string, string> = {
          ...securityHeaders(),
          "Content-Type": spec.type,
        };
        const cookies = parseCookies(req.headers.get("cookie"));
        if (!cookies[COOKIE] || !opts.store.hasSession(cookies[COOKIE])) {
          headers = {
            ...headers,
            "Set-Cookie": sessionCookie(opts.store.createSession()),
          };
        }
        const filePath = join(publicDir, spec.file);
        if (!existsSync(filePath)) {
          return new Response("Not found", { status: 404, headers });
        }
        return new Response(readFileSync(filePath), { status: 200, headers });
      }

      if (!url.pathname.startsWith("/api/")) {
        requireHost(req);
        return json(404, { error: "找不到该页面。" });
      }

      requireHost(req);
      if (req.method === "GET" && url.pathname === "/api/state") {
        requireSession(req);
        return json(200, await state());
      }
      if (req.method !== "POST")
        return json(405, { error: "不支持的请求方法。" });

      const { sid, body } = await requireMutation(req);
      switch (url.pathname) {
        case "/api/demo/commission": {
          if (opts.source.kind !== "fixture") {
            throw new ServiceError(403, "当前来源不支持添加测试佣金。");
          }
          opts.store.addCommission(parseAmount(body.amount));
          return json(200, { ok: true });
        }
        case "/api/partner/auto": {
          if (typeof body.enabled !== "boolean") {
            throw new ServiceError(400, "请选择是否开启自动结算。");
          }
          opts.store.setAutoSettle(body.enabled);
          return json(200, { ok: true });
        }
        case "/api/partner/wallet/challenge": {
          const address = parseAddress(body.address);
          const issued = issueChallenge({
            domain: originFromHost(requireHost(req)),
            userId: opts.config.partnerId,
            address,
            chainId: opts.config.chain.chainId,
            now: now(),
          });
          opts.store.putChallenge({
            sessionId: sid,
            address,
            nonce: issued.nonce,
            message: issued.message,
            issuedAt: issued.issuedAt,
            expiresAt: issued.expiresAt,
          });
          return json(200, { message: issued.message });
        }
        case "/api/partner/wallet/verify": {
          const address = parseAddress(body.address);
          const challenge = opts.store.getChallenge(sid);
          if (!challenge) throw new ServiceError(400, "请先获取验证信息。");
          if (challenge.consumed)
            throw new ServiceError(409, "验证信息已使用，请重新发起。");
          if (now() > challenge.expiresAt)
            throw new ServiceError(400, "验证信息已过期，请重新发起。");
          if (challenge.address.toLowerCase() !== address.toLowerCase()) {
            throw new ServiceError(400, "钱包地址与验证信息不一致。");
          }
          const recovered = await recoverBoundAddress(
            challenge.message,
            body.signature,
          );
          if (recovered.toLowerCase() !== address.toLowerCase()) {
            throw new ServiceError(400, "签名无效。");
          }
          opts.store.consumeChallenge(sid);
          opts.store.setWallet(recovered);
          return json(200, { ok: true });
        }
        case "/api/demo/wallet": {
          opts.store.setWallet(demoWalletAddress(opts.config));
          return json(200, { ok: true });
        }
        case "/api/partner/transfer": {
          if (opts.source.kind !== "fixture") {
            throw new ServiceError(403, "当前来源不支持划入测试消费余额。");
          }
          opts.store.transfer(parseAmount(body.amount));
          return json(200, { ok: true });
        }
        case "/api/admin/pause": {
          if (typeof body.paused !== "boolean") {
            throw new ServiceError(400, "请选择是否暂停出款。");
          }
          opts.store.setPaused(body.paused);
          return json(200, { ok: true });
        }
        case "/api/admin/run": {
          await opts.worker.tick({ force: true });
          const sourceError = opts.worker.getSourceError();
          return json(
            200,
            sourceError ? { ok: true, sourceError } : { ok: true },
          );
        }
        default:
          return json(404, { error: "找不到该接口。" });
      }
    } catch (err) {
      return fail(err);
    }
  };

  return {
    fetch,
    origin,
    store: opts.store,
    worker: opts.worker,
    config: opts.config,
  };
}

export async function startFromEnv(env = process.env) {
  const config = loadConfig({ env });
  assertLoopbackBind(config.host);
  const lock = acquireProcessLock(config.lockPath);
  let store: Store | undefined;
  try {
    const fingerprint = runtimeFingerprint(config);
    store = createStore({
      path: config.dbPath,
      merchantId: config.merchantId,
      partnerId: config.partnerId,
      partnerName: config.partnerName,
      fingerprint,
    });
    const chain = await loadEvmChain(config);
    try {
      await chain.balances();
    } catch {
      throw new Error("结算链未就绪，拒绝启动。");
    }
    const source = createSource(store, config);
    const worker = createWorker({ store, chain, source, config });
    const app = createApp({ store, worker, chain, source, config });
    const server = Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch: app.fetch,
    });
    worker.start();
    void worker.tick().catch(() => {});
    let shuttingDown: Promise<void> | undefined;
    const shutdown = () =>
      (shuttingDown ??= (async () => {
        worker.stop();
        server.stop(true);
        await worker.drain();
        store?.close();
        lock.release();
      })());
    process.on("SIGINT", () => {
      void shutdown().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void shutdown().then(() => process.exit(0));
    });
    return { app, server, lock, shutdown };
  } catch (err) {
    try {
      store?.close();
    } catch {
      /* ignore */
    }
    lock.release();
    throw err;
  }
}

if (import.meta.main) {
  startFromEnv().catch((err) => {
    console.error(sanitizeError(err));
    process.exit(1);
  });
}
