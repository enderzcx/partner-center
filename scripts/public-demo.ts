import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { startFromEnv, loadConfig } from '../src/server.ts';
import { acquireProcessLock, type ProcessLock } from '../src/lock.ts';

// A single supervised process owns the paired source and settlement services.
// Signing and authentication secrets are file-mounted, never baked into images.
const folder = process.env.PARTNER_DATA_DIR ?? '/data';
const secretFile = process.env.PARTNER_SECRET_FILE ?? '/run/secrets/partner-demo.json';
const sourcePort = '18784';
const appPort = '4316';
let source: ReturnType<typeof Bun.spawn> | undefined;
let runtime: Awaited<ReturnType<typeof startFromEnv>> | undefined;
let lock: ProcessLock | undefined;
let stopping: Promise<void> | undefined;
let stage = "configuration";
const stop = () => stopping ??= (async () => {
  try { if (runtime) await runtime.shutdown(); }
  finally { if (source) { source.kill('SIGTERM'); await source.exited; } lock?.release(); }
})();
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => { void stop().then(() => process.exit(0)); });
try {
  if (!isAbsolute(folder) || !isAbsolute(secretFile)) throw Error('Absolute paths required');
  const origin = process.env.SETTLEMENT_PUBLIC_ORIGIN;
  if (!origin || new URL(origin).protocol !== 'https:') throw Error('Public HTTPS origin required');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  lock = acquireProcessLock(resolve(folder,'supervisor.lock'));
  if (existsSync(resolve(folder,'source.sqlite')) !== existsSync(resolve(folder,'settlement.sqlite'))) throw Error('Paired ledgers required');
  const secrets = JSON.parse(readFileSync(secretFile,'utf8'));
  if (!/^0x[0-9a-fA-F]{64}$/.test(secrets.privateKey) || !/^[0-9a-f]{64}$/.test(secrets.sourceToken)) throw Error('Invalid secrets');
  if (typeof secrets.merchantPasswordHash !== 'string' || typeof secrets.promoterPasswordHash !== 'string') throw Error('Missing account hashes');
  const binary = process.env.PARTNER_SOURCE_BINARY ?? '/usr/local/bin/settlement-demo-source';
  const sourceURL = `http://127.0.0.1:${sourcePort}`;
  const runtimeEnv = {
    SETTLEMENT_CHAIN_ID:'43113', SETTLEMENT_RPC_URL:'https://api.avax-test.network/ext/bc/C/rpc',
    SETTLEMENT_CONTRACT:'0x5c905e43e0BB381534530d5e05DF56ab1f420899',
    SETTLEMENT_TOKEN:'0x5425890298aed601595a70AB815c96711a31Bc65',
    SETTLEMENT_PRIVATE_KEY:secrets.privateKey,
    SETTLEMENT_SOURCE:'beefapi', SETTLEMENT_ORDER_DEMO:'true',
    BEEFAPI_TEST_BASE_URL:sourceURL, SETTLEMENT_TEST_TOKEN:secrets.sourceToken, SETTLEMENT_PARTNER_USER_ID:'1',
    SETTLEMENT_DB:resolve(folder,'settlement.sqlite'),SETTLEMENT_LOCK:resolve(folder,'settlement.lock'),
    SETTLEMENT_PORT:appPort, SETTLEMENT_TICK_MS:'5000',
    SETTLEMENT_AUTH_ENABLED:'true', SETTLEMENT_PUBLIC_ORIGIN:origin,
    SETTLEMENT_MERCHANT_PASSWORD_HASH:secrets.merchantPasswordHash,
    SETTLEMENT_PROMOTER_PASSWORD_HASH:secrets.promoterPasswordHash,
  };
  loadConfig({env:runtimeEnv});
  stage = "source-startup";
  source = Bun.spawn([binary], {
    cwd: folder,
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      BEEFAPI_SETTLEMENT_TEST_MODE: 'true', SETTLEMENT_TEST_ORDER_MODE: 'true',
      SETTLEMENT_TEST_TOKEN: secrets.sourceToken, SETTLEMENT_TEST_CHAIN_ID: '43113',
      SETTLEMENT_TEST_TOKEN_ADDRESS: '0x5425890298aed601595a70AB815c96711a31Bc65',
      SETTLEMENT_FIXTURE_DB: resolve(folder,'source.sqlite'), SETTLEMENT_FIXTURE_PORT: sourcePort,
    },
    stdout: 'ignore', stderr: 'ignore',
  });
  let ready = false;
  for (let i=0;i<60;i++) {
    try {
      const res = await fetch(sourceURL+'/api/settlement-test/orders', {headers:{Authorization:'Bearer '+secrets.sourceToken},signal:AbortSignal.timeout(1000)});
      if (res.ok && (await res.json()).success === true) { ready=true;break; }
    } catch { /* startup only */ }
    if (source.exitCode !== null) break;
    await Bun.sleep(500);
  }
  if (!ready) throw Error('Source unavailable');
  stage = "application-startup";
  runtime = await startFromEnv(runtimeEnv, {handleSignals:false});
  console.log('Partner demo ready; authenticated HTTPS proxy required.');
  void source.exited.then(async()=>{ if(!stopping){ console.error('Demo source stopped; shutting down.');await stop();process.exitCode=1;} });
} catch {
  console.error(`Partner demo startup failed at ${stage}; credentials suppressed. Check paired data, source binary and secret configuration.`);
  await stop();process.exitCode=1;
}
