import ganache from 'ganache';
import solc from 'solc';
import {readFileSync} from 'node:fs';
import {createPublicClient,createWalletClient,defineChain,http,parseAbi} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {compile} from './compile.ts';
import {CIRCLE_FUJI_USDC} from '../src/config.ts';
// Ephemeral accounts funded only inside the isolated local EVM.
export const X402_LOCAL_EXECUTOR = generatePrivateKey();
export const X402_LOCAL_PAYER = generatePrivateKey();
export const X402_LOCAL_RECIPIENT = privateKeyToAccount(generatePrivateKey()).address;
export async function startX402LocalChain() {
  const server=ganache.server({chain:{chainId:43113,hardfork:'shanghai'},wallet:{accounts:[X402_LOCAL_EXECUTOR,X402_LOCAL_PAYER].map(secretKey=>({secretKey,balance:`0x${(1000n*10n**18n).toString(16)}`}))},logging:{quiet:true}});
  await server.listen(0,'127.0.0.1');
  try {
    const rpcUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const chain=defineChain({id:43113,name:'Isolated EVM fixture, NOT Fuji',nativeCurrency:{name:'Test',symbol:'TEST',decimals:18},rpcUrls:{default:{http:[rpcUrl]}}});
    const client=createPublicClient({chain,transport:http(rpcUrl),cacheTime:0});
    const wallet=createWalletClient({account:privateKeyToAccount(X402_LOCAL_EXECUTOR),chain,transport:http(rpcUrl)});
    const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Token.sol':{content:readFileSync(new URL('./fixtures/X402TestUSDC.sol',import.meta.url),'utf8')}},settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}})));
    const errors=(output.errors??[]).filter((e:{severity:string})=>e.severity==='error');if(errors.length)throw Error(JSON.stringify(errors));
    const code='0x'+output.contracts['Token.sol'].X402TestUSDC.evm.deployedBytecode.object;
    await server.provider.request({method:'evm_setAccountCode',params:[CIRCLE_FUJI_USDC,code]});
    const contractReceipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({...compile().Settlement,args:[CIRCLE_FUJI_USDC,wallet.account.address,wallet.account.address]})});
    if(contractReceipt.status!=='success'||!contractReceipt.contractAddress)throw Error('Local treasury deployment failed');
    const treasury=contractReceipt.contractAddress;
    const abi=parseAbi(['function mint(address,uint256)','function balanceOf(address) view returns(uint256)']);
    await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:CIRCLE_FUJI_USDC,abi,functionName:'mint',args:[privateKeyToAccount(X402_LOCAL_PAYER).address,100_000_000n]})});
    return {server,rpcUrl,client,wallet,treasury,token:CIRCLE_FUJI_USDC,payer:privateKeyToAccount(X402_LOCAL_PAYER),recipient:X402_LOCAL_RECIPIENT};
  }catch(error){await server.close();throw error;}
}
