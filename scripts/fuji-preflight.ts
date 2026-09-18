import {
  createPublicClient,
  defineChain,
  http,
  parseAbi,
  isAddress,
} from "viem";

// READ ONLY. This script never signs, sends, deploys or requests a private key.
const rpcUrl =
  process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
const token = "0x5425890298aed601595a70AB815c96711a31Bc65";
const chain = defineChain({
  id: 43113,
  name: "Avalanche Fuji",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({
  chain,
  transport: http(rpcUrl, { timeout: 15000, retryCount: 1 }),
});
const chainId = await client.getChainId();
if (chainId !== 43113) throw new Error("拒绝非 Fuji 网络");
const tokenAbi = parseAbi([
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
]);
const decimals = await client.readContract({
  address: token,
  abi: tokenAbi,
  functionName: "decimals",
});
if (decimals !== 6) throw new Error("USDC 精度不匹配");
const output: Record<string, unknown> = {
  mode: "read-only",
  chainId,
  token,
  decimals,
  blockNumber: (await client.getBlockNumber()).toString(),
};
const address = process.env.FUJI_EXECUTOR_ADDRESS;
if (address) {
  if (!isAddress(address)) throw new Error("执行钱包地址格式无效");
  output.executor = address;
  output.gasWei = (await client.getBalance({ address })).toString();
  output.usdcMicro = (
    await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [address],
    })
  ).toString();
}
console.log(JSON.stringify(output, null, 2));
