import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvmChain, type EvmConfig } from "../src/chain.js";
import { compile } from "./compile.js";
// PUBLIC local test keys. Never fund on any public network.
export const LOCAL_KEY = `0x${"1".padStart(64, "0")}` as const;
export const OTHER_KEY = `0x${"2".padStart(64, "0")}` as const;
export async function startLocalChain(
  port = 8547,
  persistence?: { databasePath: string; config?: EvmConfig },
) {
  if (persistence) mkdirSync(persistence.databasePath, {recursive:true,mode:0o700});
  const server = ganache.server({
    chain: { chainId: 31337, hardfork: "shanghai" },
    wallet: {
      accounts: [LOCAL_KEY, OTHER_KEY].map((secretKey) => ({
        secretKey,
        balance: `0x${(1000n * 10n ** 18n).toString(16)}`,
      })),
    },
    logging: { quiet: true },
    ...(persistence ? { database: { dbPath: persistence.databasePath } } : {}),
  });
  await server.listen(port, "127.0.0.1");
  try {
    const actualPort = (server.address() as { port: number }).port;
    const rpcUrl = `http://127.0.0.1:${actualPort}`;
    const chain = defineChain({
      id: 31337,
      name: "Local test only",
      nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const account = privateKeyToAccount(LOCAL_KEY);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
      cacheTime: 0,
    });
    const wallet = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    if (persistence?.config) {
      const config = { ...persistence.config, rpcUrl };
      if (config.chainId !== 31337 || config.privateKey !== LOCAL_KEY)
        throw new Error("Existing config is not the local demo");
      await new EvmChain(config).balances();
      return {
        server,
        config,
        recipient: privateKeyToAccount(OTHER_KEY).address,
        publicClient,
        wallet,
      };
    }
    const artifacts = compile();
    const deploy = async (
      artifact: typeof artifacts.Settlement,
      args: unknown[] = [],
    ) => {
      const hash = await wallet.deployContract({ ...artifact, args });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress)
        throw new Error("Local deployment failed");
      return receipt.contractAddress;
    };
    const token = await deploy(artifacts.TestUSDC);
    const contract = await deploy(artifacts.Settlement, [
      token,
      account.address,
      account.address,
    ]);
    const hash = await wallet.writeContract({
      address: token,
      abi: parseAbi(["function transfer(address,uint256) returns(bool)"]),
      functionName: "transfer",
      args: [contract, 10_000n * 10n ** 6n],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return {
      server,
      config: {
        rpcUrl,
        chainId: 31337 as const,
        contract,
        token,
        privateKey: LOCAL_KEY,
      },
      recipient: privateKeyToAccount(OTHER_KEY).address,
      publicClient,
      wallet,
    };
  } catch (e) {
    await server.close();
    throw e;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const databasePath = resolve(".local/ganache");
  const configPath = resolve(".local/chain.json");
  if (existsSync(databasePath) !== existsSync(configPath))
    throw new Error(
      "Local chain database/config pair incomplete. Restore both; do not reset while settlement ledger exists.",
    );
  const previous = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as EvmConfig)
    : undefined;
  const local = await startLocalChain(
    Number(process.env.LOCAL_CHAIN_PORT ?? 8547),
    { databasePath, config: previous },
  );
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  writeFileSync(
    ".local/chain.json",
    JSON.stringify(
      { ...local.config, recipient: local.recipient, testOnly: true },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Local EVM ready at ${local.config.rpcUrl}. Test-only config: .local/chain.json`,
  );
  console.log(
    `Settlement: ${local.config.contract}; mock token: ${local.config.token}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      await local.server.close();
      process.exit(0);
    });
}
