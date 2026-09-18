import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startFromEnv } from '../src/server.ts';

// Local orchestration only. The source is a dedicated demo SQLite database.
// --fuji is an explicit operator action, never a default or fallback.
const root = resolve(import.meta.dir, '..');
const fuji = process.argv.includes('--fuji');
const folder = resolve(root, '.local', fuji ? 'orders-fuji' : 'orders-local');
mkdirSync(folder, { recursive: true, mode: 0o700 });
let child: ReturnType<typeof Bun.spawn> | undefined;
let runtime: Awaited<ReturnType<typeof startFromEnv>> | undefined;
let stopping: Promise<void> | undefined;
async function stop() {
  return stopping ??= (async () => {
    if (runtime) await runtime.shutdown();
    if (child) { child.kill('SIGTERM'); await child.exited; }
  })();
}
try {
  const binary = process.env.BEEFAPI_FIXTURE_BINARY ?? resolve(root, '.local/beefapi-fixture.test');
  if (!existsSync(binary)) throw new Error('Compile the isolated BeefAPI fixture binary first.');
  const authPath = resolve(folder, 'source-token');
  if (!existsSync(authPath)) writeFileSync(authPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const auth = readFileSync(authPath, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(auth)) throw new Error('Invalid demo source token file.');
  const local = fuji ? undefined : JSON.parse(readFileSync(resolve(root, '.local/chain.json'), 'utf8'));
  const evidence = fuji ? JSON.parse(readFileSync(resolve(root, 'docs/evidence/fuji-acceptance-2026-09-18.json'), 'utf8')) : undefined;
  const chainId = fuji ? 43113 : 31337;
  if (local && local.chainId !== 31337) throw new Error('Local demo requires local chain 31337.');
  const token = fuji ? '0x5425890298aed601595a70AB815c96711a31Bc65' : local.token;
  let key: string;
  if (fuji) {
    const keyFile = process.env.FUJI_KEY_FILE;
    if (!keyFile) throw new Error('Set FUJI_KEY_FILE to the user-authorized key file; never pass the key in command arguments.');
    const text = readFileSync(keyFile, 'utf8');
    const value = text.match(/^\s*fuji_test_private_key\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
    if (!value || !/^(0x)?[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid Fuji key field.');
    key = value.startsWith('0x') ? value : '0x' + value;
  } else key = local.privateKey;
  const sourcePort = fuji ? 18784 : 18783;
  const appPort = fuji ? 4315 : 4314;
  child = Bun.spawn([binary, '-test.run', '^TestSettlementHTTPFixture$', '-test.timeout', '24h'], {
    cwd: root,
    env: {
      PATH: process.env.PATH!, HOME: process.env.HOME!,
      RUN_SETTLEMENT_FIXTURE: 'true', BEEFAPI_SETTLEMENT_TEST_MODE: 'true',
      SETTLEMENT_TEST_ORDER_MODE: 'true', SETTLEMENT_TEST_TOKEN: auth,
      SETTLEMENT_TEST_CHAIN_ID: String(chainId), SETTLEMENT_TEST_TOKEN_ADDRESS: token,
      SETTLEMENT_FIXTURE_PORT: String(sourcePort), SETTLEMENT_FIXTURE_DB: resolve(folder, 'source.sqlite'),
    },
    stdout: 'ignore', stderr: 'ignore',
  });
  const sourceURL = `http://127.0.0.1:${sourcePort}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(sourceURL + '/api/settlement-test/orders', { headers: { Authorization: 'Bearer ' + auth } });
      if (response.ok && (await response.json()).success === true) { ready = true; break; }
    } catch { /* source startup */ }
    if (child.exitCode !== null) break;
    await Bun.sleep(250);
  }
  if (!ready) throw new Error('Order fixture did not become ready.');
  runtime = await startFromEnv({
    SETTLEMENT_CHAIN_ID: String(chainId), SETTLEMENT_RPC_URL: fuji ? 'https://api.avax-test.network/ext/bc/C/rpc' : local.rpcUrl,
    SETTLEMENT_CONTRACT: fuji ? evidence.contract : local.contract, SETTLEMENT_TOKEN: token,
    SETTLEMENT_PRIVATE_KEY: key, SETTLEMENT_SOURCE: 'beefapi', SETTLEMENT_ORDER_DEMO: 'true',
    BEEFAPI_TEST_BASE_URL: sourceURL, SETTLEMENT_TEST_TOKEN: auth, SETTLEMENT_PARTNER_USER_ID: '1',
    SETTLEMENT_DB: resolve(folder, 'settlement.sqlite'), SETTLEMENT_LOCK: resolve(folder, 'settlement.lock'),
    SETTLEMENT_PORT: String(appPort), SETTLEMENT_TICK_MS: '2000',
  });
  console.log(`Order demo ready: http://127.0.0.1:${appPort} (${fuji ? 'Fuji testnet' : 'local chain'}; synthetic payment confirmation)`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void stop().then(() => process.exit(0)); });
  // A dead source must not leave an apparently working demo behind.
  void child.exited.then(async () => { if (!stopping) { console.error('Demo source stopped; stopping settlement service.'); await stop(); process.exitCode = 1; } });
} catch {
  // Neither RPC errors nor configuration errors may print credentials.
  console.error('Order demo startup failed. Check dedicated demo configuration, fixture build and local chain. Credentials suppressed.');
  await stop(); process.exitCode = 1;
}
