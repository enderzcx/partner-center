import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

// Launch the real BeefAPI controllers against their opt-in, temporary SQLite fixture.
// The binary is compiled from the task's isolated BeefAPI worktree, never production.
const root = resolve(import.meta.dir, "..");
const executable =
  process.env.BEEFAPI_FIXTURE_BINARY ??
  resolve(root, ".local/beefapi-fixture.test");
if (!existsSync(executable))
  throw new Error(
    "Compile the BeefAPI controller fixture binary first; see README.",
  );
const config = await Bun.file(resolve(root, ".local/chain.json")).json();
if (config.chainId !== 31337)
  throw new Error("This convenience fixture is local-chain only.");
const token = randomBytes(32).toString("hex");
const port = "18781";
mkdirSync(resolve(root, ".local"), { recursive: true, mode: 0o700 });
writeFileSync(
  resolve(root, ".local/beefapi.env"),
  [
    "export SETTLEMENT_SOURCE=beefapi",
    `export SETTLEMENT_DB=.local/beefapi-${Date.now()}.sqlite`,
    `export BEEFAPI_TEST_BASE_URL=http://127.0.0.1:${port}`,
    `export SETTLEMENT_TEST_TOKEN=${token}`,
    "export SETTLEMENT_PARTNER_USER_ID=1",
  ].join("\n") + "\n",
  { mode: 0o600 },
);
const proc = Bun.spawn(
  [
    executable,
    "-test.run",
    "^TestSettlementHTTPFixture$",
    "-test.v",
    "-test.timeout",
    "35m",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      RUN_SETTLEMENT_FIXTURE: "true",
      BEEFAPI_SETTLEMENT_TEST_MODE: "true",
      SETTLEMENT_TEST_TOKEN: token,
      SETTLEMENT_TEST_CHAIN_ID: "31337",
      SETTLEMENT_TEST_TOKEN_ADDRESS: config.token,
      SETTLEMENT_FIXTURE_PORT: port,
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => proc.kill(signal));
console.log(
  "BeefAPI fixture: local synthetic user 1. Server-only connection settings saved in .local/beefapi.env",
);
process.exitCode = await proc.exited;
