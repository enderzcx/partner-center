import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compile } from "../scripts/compile.ts";
import { FUJI_USDC } from "../src/chain.ts";

const TIMEOUT = 30_000;
const ADMIN_KEY = key(1);
const REGISTRAR_KEY = key(2);
const BENEFICIARY_KEY = key(3);
const STRANGER_KEY = key(4);
const OTHER_KEY = key(5);
const SURPLUS_KEY = key(6);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_ID = `0x${"0".repeat(64)}` as Hex;
const REGISTRAR_ROLE = keccak256(toHex("REGISTRAR_ROLE"));
const DEFAULT_ADMIN_ROLE = ZERO_ID;
const tokenAbi = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function setRevertTransfers(bool)",
  "function setReturnFalse(bool)",
]);

function key(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`;
}
function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

const artifacts = compile();
const escrowAbi = artifacts.CommissionEscrow.abi as Abi;

test("compile keeps Settlement and TestUSDC and adds CommissionEscrow without deposit or mutation APIs", () => {
  expect(artifacts.Settlement.bytecode.startsWith("0x")).toBe(true);
  expect(artifacts.TestUSDC.bytecode.startsWith("0x")).toBe(true);
  expect(artifacts.CommissionEscrow.bytecode.startsWith("0x")).toBe(true);
  const fns = new Set(
    artifacts.CommissionEscrow.abi
      .filter((item: { type: string }) => item.type === "function")
      .map((item: { name: string }) => item.name),
  );
  for (const name of [
    "register",
    "claim",
    "withdrawSurplus",
    "pause",
    "unpause",
    "surplus",
    "totalReserved",
    "grantRole",
    "revokeRole",
  ])
    expect(fns.has(name)).toBe(true);
  for (const name of [
    "deposit",
    "cancel",
    "update",
    "setBeneficiary",
    "setAmount",
    "setClaimableAt",
  ])
    expect(fns.has(name)).toBe(false);
});

test(
  "constructor allows only testnets and Fuji official USDC",
  async () => {
    await withChain(1, async (local) => {
      await setCode(local.server, local.admin.account.address, "0xfe");
      expect(
        (
          await send(local.admin, local.publicClient, {
            data: encodeDeployData({
              abi: escrowAbi,
              bytecode: artifacts.CommissionEscrow.bytecode,
              args: [
                local.admin.account.address,
                local.admin.account.address,
                local.registrar.account.address,
              ],
            }),
          })
        ).status,
      ).toBe("reverted");
    });
    await withChain(43113, async (local) => {
      const fake = "0x0000000000000000000000000000000000000042" as Address;
      await setCode(local.server, fake, "0xfe");
      expect(
        (
          await send(local.admin, local.publicClient, {
            data: encodeDeployData({
              abi: escrowAbi,
              bytecode: artifacts.CommissionEscrow.bytecode,
              args: [
                fake,
                local.admin.account.address,
                local.registrar.account.address,
              ],
            }),
          })
        ).status,
      ).toBe("reverted");
      await setCode(local.server, FUJI_USDC, "0xfe");
      const receipt = await local.publicClient.waitForTransactionReceipt({
        hash: await local.admin.deployContract({
          abi: escrowAbi,
          bytecode: artifacts.CommissionEscrow.bytecode,
          args: [
            FUJI_USDC,
            local.admin.account.address,
            local.registrar.account.address,
          ],
        }),
      });
      expect(receipt.status).toBe("success");
      expect(receipt.contractAddress).toBeTruthy();
    });
  },
  TIMEOUT,
);

test(
  "real EVM: unauthorized calls, unique ids, third-party claim, pause, surplus, conservation",
  async () => {
    await withChain(31337, async (local) => {
      const { publicClient, admin, registrar, beneficiary, stranger, other } =
        local;
      const token = await deploy(admin, publicClient, artifacts.TestUSDC);
      expect(
        (
          await send(admin, publicClient, {
            data: encodeDeployData({
              abi: escrowAbi,
              bytecode: artifacts.CommissionEscrow.bytecode,
              args: [admin.account.address, admin.account.address, registrar.account.address],
            }),
          })
        ).status,
      ).toBe("reverted");
      expect(
        (
          await send(admin, publicClient, {
            data: encodeDeployData({
              abi: escrowAbi,
              bytecode: artifacts.CommissionEscrow.bytecode,
              args: [token, ZERO, registrar.account.address],
            }),
          })
        ).status,
      ).toBe("reverted");
      expect(
        (
          await send(admin, publicClient, {
            data: encodeDeployData({
              abi: escrowAbi,
              bytecode: artifacts.CommissionEscrow.bytecode,
              args: [token, admin.account.address, ZERO],
            }),
          })
        ).status,
      ).toBe("reverted");
      const escrow = await deploy(admin, publicClient, artifacts.CommissionEscrow, [
        token,
        admin.account.address,
        registrar.account.address,
      ]);
      expect(same(String(await read(publicClient, escrow, "token")), token)).toBe(
        true,
      );
      expect(
        await read(publicClient, escrow, "hasRole", [
          DEFAULT_ADMIN_ROLE,
          admin.account.address,
        ]),
      ).toBe(true);
      expect(
        await read(publicClient, escrow, "hasRole", [
          REGISTRAR_ROLE,
          admin.account.address,
        ]),
      ).toBe(false);
      expect(
        await read(publicClient, escrow, "hasRole", [
          REGISTRAR_ROLE,
          registrar.account.address,
        ]),
      ).toBe(true);
      expect(
        await read(publicClient, escrow, "hasRole", [
          DEFAULT_ADMIN_ROLE,
          registrar.account.address,
        ]),
      ).toBe(false);

      const funded = 100_000_000n;
      await transfer(admin, publicClient, token, escrow, funded);
      expect(await read(publicClient, escrow, "surplus")).toBe(funded);
      expect(await read(publicClient, escrow, "totalReserved")).toBe(0n);

      const idA = keccak256(toHex("merchant/order/A"));
      const idB = keccak256(toHex("merchant/order/B"));
      const idC = keccak256(toHex("merchant/order/C"));
      const idFuture = keccak256(toHex("merchant/order/future"));
      const idD = keccak256(toHex("merchant/order/D"));
      const amtA = 30_000_000n;
      const amtFuture = 10_000_000n;
      const amtB = 50_000_000n;
      const amtC = 5_000_000n;
      const extra = 5_000_000n;

      await expectReverted(stranger, publicClient, escrow, "register", [
        idA,
        beneficiary.account.address,
        amtA,
        0n,
      ]);
      await expectReverted(admin, publicClient, escrow, "register", [
        idA,
        beneficiary.account.address,
        amtA,
        0n,
      ]);
      await expectReverted(stranger, publicClient, escrow, "pause", []);
      await expectReverted(registrar, publicClient, escrow, "pause", []);
      await expectReverted(stranger, publicClient, escrow, "withdrawSurplus", [
        local.surplusTo.account.address,
        1n,
      ]);
      await expectReverted(registrar, publicClient, escrow, "withdrawSurplus", [
        local.surplusTo.account.address,
        1n,
      ]);
      await expectReverted(registrar, publicClient, escrow, "register", [
        idA,
        beneficiary.account.address,
        funded + 1n,
        0n,
      ]);
      await expectReverted(registrar, publicClient, escrow, "register", [
        ZERO_ID,
        beneficiary.account.address,
        amtA,
        0n,
      ]);
      await expectReverted(registrar, publicClient, escrow, "register", [
        idA,
        ZERO,
        amtA,
        0n,
      ]);
      await expectReverted(registrar, publicClient, escrow, "register", [
        idA,
        escrow,
        amtA,
        0n,
      ]);
      await expectReverted(registrar, publicClient, escrow, "register", [
        idA,
        beneficiary.account.address,
        0n,
        0n,
      ]);

      const registeredA = await receiptOf(
        registrar.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "register",
          args: [idA, beneficiary.account.address, amtA, 0n],
        }),
        publicClient,
      );
      expect(eventName(registeredA, escrow, "Registered")).toBe(true);
      await expectReverted(registrar, publicClient, escrow, "register", [
        idA,
        other.account.address,
        1n,
        0n,
      ]);
      expect(await read(publicClient, escrow, "totalReserved")).toBe(amtA);
      expect(await read(publicClient, escrow, "surplus")).toBe(funded - amtA);

      const now = Number((await publicClient.getBlock()).timestamp);
      await receiptOf(
        registrar.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "register",
          args: [
            idFuture,
            beneficiary.account.address,
            amtFuture,
            BigInt(now + 3600),
          ],
        }),
        publicClient,
      );
      await expectReverted(stranger, publicClient, escrow, "claim", [idFuture]);

      const beforeBeneficiary = await balanceOf(
        publicClient,
        token,
        beneficiary.account.address,
      );
      const beforeStranger = await balanceOf(
        publicClient,
        token,
        stranger.account.address,
      );
      const claimedA = await receiptOf(
        stranger.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "claim",
          args: [idA],
        }),
        publicClient,
      );
      expect(eventName(claimedA, escrow, "Claimed")).toBe(true);
      expect(
        await balanceOf(publicClient, token, beneficiary.account.address),
      ).toBe(beforeBeneficiary + amtA);
      expect(await balanceOf(publicClient, token, stranger.account.address)).toBe(
        beforeStranger,
      );
      expect((await right(publicClient, escrow, idA)).status).toBe(2);
      expect(await read(publicClient, escrow, "totalReserved")).toBe(amtFuture);
      await expectReverted(stranger, publicClient, escrow, "claim", [idA]);
      await expectReverted(registrar, publicClient, escrow, "register", [
        idA,
        other.account.address,
        1n,
        0n,
      ]);

      await receiptOf(
        admin.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "pause",
        }),
        publicClient,
      );
      await expectReverted(registrar, publicClient, escrow, "register", [
        idB,
        other.account.address,
        amtB,
        0n,
      ]);
      await increaseTime(local.server, 3600);
      const claimedFuture = await receiptOf(
        beneficiary.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "claim",
          args: [idFuture],
        }),
        publicClient,
      );
      expect(claimedFuture.status).toBe("success");
      expect(await read(publicClient, escrow, "totalReserved")).toBe(0n);
      await receiptOf(
        admin.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "unpause",
        }),
        publicClient,
      );

      await receiptOf(
        registrar.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "register",
          args: [idB, other.account.address, amtB, 0n],
        }),
        publicClient,
      );
      await receiptOf(
        registrar.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "register",
          args: [idC, beneficiary.account.address, amtC, 0n],
        }),
        publicClient,
      );
      expect(await read(publicClient, escrow, "totalReserved")).toBe(amtB + amtC);
      expect(await read(publicClient, escrow, "surplus")).toBe(extra);
      await expectReverted(admin, publicClient, escrow, "withdrawSurplus", [
        local.surplusTo.account.address,
        extra + 1n,
      ]);
      await expectReverted(admin, publicClient, escrow, "withdrawSurplus", [
        ZERO,
        extra,
      ]);
      await expectReverted(admin, publicClient, escrow, "withdrawSurplus", [
        escrow,
        extra,
      ]);
      await expectReverted(admin, publicClient, escrow, "withdrawSurplus", [
        local.surplusTo.account.address,
        0n,
      ]);
      const reservedBeforeWithdraw = (await read(
        publicClient,
        escrow,
        "totalReserved",
      )) as bigint;
      const withdrawn = await receiptOf(
        admin.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "withdrawSurplus",
          args: [local.surplusTo.account.address, extra],
        }),
        publicClient,
      );
      expect(eventName(withdrawn, escrow, "SurplusWithdrawn")).toBe(true);
      expect(await read(publicClient, escrow, "totalReserved")).toBe(
        reservedBeforeWithdraw,
      );
      expect(await balanceOf(publicClient, token, local.surplusTo.account.address)).toBe(
        extra,
      );
      expect(await read(publicClient, escrow, "surplus")).toBe(0n);
      await expectReverted(admin, publicClient, escrow, "withdrawSurplus", [
        local.surplusTo.account.address,
        1n,
      ]);

      const beforeOther = await balanceOf(
        publicClient,
        token,
        other.account.address,
      );
      await receiptOf(
        stranger.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "claim",
          args: [idB],
        }),
        publicClient,
      );
      await receiptOf(
        stranger.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "claim",
          args: [idC],
        }),
        publicClient,
      );
      expect(await balanceOf(publicClient, token, other.account.address)).toBe(
        beforeOther + amtB,
      );
      expect(await read(publicClient, escrow, "totalReserved")).toBe(0n);
      expect(await balanceOf(publicClient, token, escrow)).toBe(0n);
      expect(
        (await balanceOf(publicClient, token, beneficiary.account.address)) +
          (await balanceOf(publicClient, token, other.account.address)) +
          (await balanceOf(publicClient, token, local.surplusTo.account.address)),
      ).toBe(funded);

      await transfer(admin, publicClient, token, escrow, 1_000_000n);
      await receiptOf(
        admin.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "grantRole",
          args: [REGISTRAR_ROLE, stranger.account.address],
        }),
        publicClient,
      );
      await receiptOf(
        stranger.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "register",
          args: [idD, beneficiary.account.address, 1_000_000n, 0n],
        }),
        publicClient,
      );
      await receiptOf(
        admin.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "revokeRole",
          args: [REGISTRAR_ROLE, stranger.account.address],
        }),
        publicClient,
      );
      await expectReverted(stranger, publicClient, escrow, "register", [
        keccak256(toHex("merchant/order/E")),
        beneficiary.account.address,
        1n,
        0n,
      ]);
      // Administrative escalation cannot consume existing registered rights.
      await receiptOf(admin.writeContract({address:escrow,abi:escrowAbi,functionName:"grantRole",args:[REGISTRAR_ROLE,admin.account.address]}),publicClient);
      await expectReverted(admin,publicClient,escrow,"register",[idD,admin.account.address,1n,0n]);
      await expectReverted(admin,publicClient,escrow,"register",[keccak256(toHex("steal-reserved")),admin.account.address,1n,0n]);
      await expectReverted(admin,publicClient,escrow,"withdrawSurplus",[admin.account.address,1n]);
      await receiptOf(admin.writeContract({address:escrow,abi:escrowAbi,functionName:"revokeRole",args:[REGISTRAR_ROLE,registrar.account.address]}),publicClient);
      await receiptOf(admin.writeContract({address:escrow,abi:escrowAbi,functionName:"pause"}),publicClient);
      const beneficiaryBefore = await balanceOf(publicClient,token,beneficiary.account.address);
      await receiptOf(stranger.writeContract({address:escrow,abi:escrowAbi,functionName:"claim",args:[idD]}),publicClient);
      expect(await balanceOf(publicClient,token,beneficiary.account.address)).toBe(beneficiaryBefore+1_000_000n);
      expect(await read(publicClient,escrow,"totalReserved")).toBe(0n);
      await expectReverted(stranger,publicClient,escrow,"claim",[idD]);
    });
  },
  TIMEOUT,
);

test(
  "real EVM: failed token transfer rolls back claim reservation",
  async () => {
    await withChain(31337, async (local) => {
      const reverting = compileRevertingUsdc();
      const token = await deploy(local.admin, local.publicClient, reverting);
      const escrow = await deploy(
        local.admin,
        local.publicClient,
        artifacts.CommissionEscrow,
        [
          token,
          local.admin.account.address,
          local.registrar.account.address,
        ],
      );
      const amount = 2_000_000n;
      await transfer(local.admin, local.publicClient, token, escrow, amount);
      const id = keccak256(toHex("merchant/order/revert"));
      await receiptOf(
        local.registrar.writeContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "register",
          args: [id, local.beneficiary.account.address, amount, 0n],
        }),
        local.publicClient,
      );
      await receiptOf(
        local.admin.writeContract({
          address: token,
          abi: tokenAbi,
          functionName: "setRevertTransfers",
          args: [true],
        }),
        local.publicClient,
      );
      const failed = await expectReverted(local.stranger, local.publicClient, escrow, "claim", [id]);
      expect(eventName(failed, escrow, "Claimed")).toBe(false);
      expect(await read(local.publicClient, escrow, "totalReserved")).toBe(amount);
      expect((await right(local.publicClient, escrow, id)).status).toBe(1);
      expect(
        await balanceOf(
          local.publicClient,
          token,
          local.beneficiary.account.address,
        ),
      ).toBe(0n);
      expect(await balanceOf(local.publicClient, token, escrow)).toBe(amount);
      await receiptOf(local.admin.writeContract({address:token,abi:tokenAbi,functionName:"setRevertTransfers",args:[false]}),local.publicClient);
      await receiptOf(local.admin.writeContract({address:token,abi:tokenAbi,functionName:"setReturnFalse",args:[true]}),local.publicClient);
      await expectReverted(local.stranger,local.publicClient,escrow,"claim",[id]);
      expect(await read(local.publicClient,escrow,"totalReserved")).toBe(amount);
      expect((await right(local.publicClient,escrow,id)).status).toBe(1);
      await receiptOf(local.admin.writeContract({address:token,abi:tokenAbi,functionName:"setReturnFalse",args:[false]}),local.publicClient);
      await receiptOf(local.beneficiary.writeContract({address:escrow,abi:escrowAbi,functionName:"claim",args:[id]}),local.publicClient);
      expect(await balanceOf(local.publicClient,token,local.beneficiary.account.address)).toBe(amount);
      expect(await read(local.publicClient,escrow,"totalReserved")).toBe(0n);
      await expectReverted(local.stranger,local.publicClient,escrow,"claim",[id]);
    });
  },
  TIMEOUT,
);

function compileRevertingUsdc() {
  const source = readFileSync(
    fileURLToPath(new URL("./fixtures/RevertingUSDC.sol", import.meta.url)),
    "utf8",
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "RevertingUSDC.sol": { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const errors = (output.errors ?? []).filter(
    (item: { severity: string }) => item.severity === "error",
  );
  if (errors.length)
    throw new Error(
      errors
        .map((item: { formattedMessage: string }) => item.formattedMessage)
        .join("\n"),
    );
  const contract = output.contracts["RevertingUSDC.sol"].RevertingUSDC;
  return {
    abi: contract.abi as Abi,
    bytecode: `0x${contract.evm.bytecode.object}` as Hex,
  };
}

async function withChain(
  chainId: number,
  run: (local: Awaited<ReturnType<typeof startChain>>) => Promise<void>,
) {
  const local = await startChain(chainId);
  try {
    await run(local);
  } finally {
    await local.server.close();
  }
}

async function startChain(chainId: number) {
  const keys = [
    ADMIN_KEY,
    REGISTRAR_KEY,
    BENEFICIARY_KEY,
    STRANGER_KEY,
    OTHER_KEY,
    SURPLUS_KEY,
  ];
  const server = ganache.server({
    chain: { chainId, hardfork: "shanghai" },
    wallet: {
      accounts: keys.map((secretKey) => ({
        secretKey,
        balance: `0x${(1000n * 10n ** 18n).toString(16)}`,
      })),
    },
    logging: { quiet: true },
  });
  await server.listen(0, "127.0.0.1");
  const rpcUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const chain = defineChain({
    id: chainId,
    name: "Commission escrow local test",
    nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
    cacheTime: 0,
  });
  const wallet = (secret: Hex) =>
    createWalletClient({
      account: privateKeyToAccount(secret),
      chain,
      transport: http(rpcUrl),
    }) as unknown as TestWallet;
  return {
    server: server as unknown as TestServer,
    publicClient: publicClient as unknown as TestPublic,
    admin: wallet(ADMIN_KEY),
    registrar: wallet(REGISTRAR_KEY),
    beneficiary: wallet(BENEFICIARY_KEY),
    stranger: wallet(STRANGER_KEY),
    other: wallet(OTHER_KEY),
    surplusTo: wallet(SURPLUS_KEY),
  };
}

type TestWallet = {
  account: ReturnType<typeof privateKeyToAccount>;
  deployContract: (params: Record<string, unknown>) => Promise<Hex>;
  writeContract: (params: Record<string, unknown>) => Promise<Hex>;
  sendTransaction: (params: Record<string, unknown>) => Promise<Hex>;
};
type TestPublic = {
  waitForTransactionReceipt: (params: { hash: Hex }) => Promise<{
    status: "success" | "reverted";
    contractAddress?: Address | null;
    logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  }>;
  getBlock: () => Promise<{ timestamp: bigint }>;
  readContract: (params: Record<string, unknown>) => Promise<unknown>;
};
type TestServer = {
  provider: { request: (args: Record<string, unknown>) => Promise<unknown> };
  close: () => Promise<unknown>;
};

async function deploy(
  wallet: TestWallet,
  publicClient: TestPublic,
  artifact: { abi: Abi; bytecode: Hex },
  args: unknown[] = [],
) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: await wallet.deployContract({ ...artifact, args }),
  });
  expect(receipt.status).toBe("success");
  if (!receipt.contractAddress) throw new Error("missing contract address");
  return receipt.contractAddress;
}

async function send(
  wallet: TestWallet,
  publicClient: TestPublic,
  tx: { to?: Address; data: Hex },
) {
  const hash = await wallet.sendTransaction({ ...tx, gas: 2_000_000n });
  return publicClient.waitForTransactionReceipt({ hash });
}

async function expectReverted(
  wallet: TestWallet,
  publicClient: TestPublic,
  to: Address,
  functionName: string,
  args: unknown[],
) {
  const receipt = await send(wallet, publicClient, {
    to,
    data: encodeFunctionData({ abi: escrowAbi, functionName, args }),
  });
  expect(receipt.status).toBe("reverted");
  return receipt;
}

async function receiptOf(hashPromise: Promise<Hex>, publicClient: TestPublic) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: await hashPromise,
  });
  expect(receipt.status).toBe("success");
  return receipt;
}

async function transfer(
  wallet: TestWallet,
  publicClient: TestPublic,
  token: Address,
  to: Address,
  amount: bigint,
) {
  await receiptOf(
    wallet.writeContract({
      address: token,
      abi: tokenAbi,
      functionName: "transfer",
      args: [to, amount],
    }),
    publicClient,
  );
}

async function balanceOf(
  publicClient: TestPublic,
  token: Address,
  account: Address,
) {
  return (await publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

async function read(
  publicClient: TestPublic,
  address: Address,
  functionName: string,
  args: unknown[] = [],
) {
  return publicClient.readContract({
    address,
    abi: escrowAbi,
    functionName,
    args,
  });
}

async function right(publicClient: TestPublic, escrow: Address, id: Hex) {
  const [beneficiary, amount, claimableAt, status] = (await read(
    publicClient,
    escrow,
    "rights",
    [id],
  )) as [Address, bigint, bigint, number];
  return { beneficiary, amount, claimableAt, status };
}

function eventName(
  receipt: { logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] },
  escrow: Address,
  name: string,
) {
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) return false;
    try {
      return (
        decodeEventLog({
          abi: escrowAbi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        }).eventName === name
      );
    } catch {
      return false;
    }
  });
}

async function setCode(server: TestServer, address: Address, code: Hex) {
  await server.provider.request({
    method: "evm_setAccountCode",
    params: [address, code],
  });
}

async function increaseTime(server: TestServer, seconds: number) {
  await server.provider.request({
    method: "evm_increaseTime",
    params: [seconds],
  });
  await server.provider.request({ method: "evm_mine", params: [] });
}
