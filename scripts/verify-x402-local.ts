// Fully isolated HTTP + EIP-3009 + commission E2E. Never uses public keys or RPCs from env.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseAbi,parseSignature} from 'viem';
import {x402Client,x402HTTPClient} from '@x402/core/client';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import {startFromEnv} from '../src/server.ts';
import {startX402LocalChain,X402_LOCAL_EXECUTOR} from './x402-local-chain.ts';
const dir=mkdtempSync(join(tmpdir(),'partner-x402-e2e-'));
const chain=await startX402LocalChain();
const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const sourcePort='18786';const port='4318';const origin=`http://127.0.0.1:${port}`;
const binary=resolve(process.env.X402_TEST_SOURCE_BINARY??'.local/settlement-demo-source');
const originalFetch=globalThis.fetch;
let runtime:Awaited<ReturnType<typeof startFromEnv>>|undefined;
let source:ReturnType<typeof Bun.spawn>|undefined;
let settles=0;
const tokenAbi=parseAbi(['function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)','function balanceOf(address) view returns(uint256)']);
try {
  source=Bun.spawn([binary],{cwd:dir,env:{PATH:process.env.PATH??'',BEEFAPI_SETTLEMENT_TEST_MODE:'true',SETTLEMENT_TEST_ORDER_MODE:'true',SETTLEMENT_TEST_TOKEN:token,SETTLEMENT_TEST_CHAIN_ID:'43113',SETTLEMENT_TEST_TOKEN_ADDRESS:chain.token,SETTLEMENT_FIXTURE_DB:join(dir,'source.sqlite'),SETTLEMENT_FIXTURE_PORT:sourcePort},stdout:'ignore',stderr:'inherit'});
  let ready=false;for(let i=0;i<150;i++){try{const r=await originalFetch(`http://127.0.0.1:${sourcePort}/api/settlement-test/orders`,{headers:{Authorization:'Bearer '+token}});if(r.ok){ready=true;break;}}catch{}await Bun.sleep(100);}assert.ok(ready,'dedicated Go source ready');
  // Fake transport ONLY for the facilitator; authorization is really executed by local EVM.
  globalThis.fetch=(async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(!url.startsWith('https://facilitator.payai.network/'))return originalFetch(input,init);
    if(url.endsWith('/supported'))return Response.json({kinds:[{x402Version:2,scheme:'exact',network:'eip155:43113'}]});
    const b=JSON.parse(String(init?.body));
    const a=b.paymentPayload.payload.authorization;
    if(url.endsWith('/verify'))return Response.json({isValid:true,payer:a.from});
    assert.ok(url.endsWith('/settle'));settles++;
    const sig=parseSignature(b.paymentPayload.payload.signature);
    const hash=await chain.wallet.writeContract({address:chain.token,abi:tokenAbi,functionName:'transferWithAuthorization',args:[a.from,a.to,BigInt(a.value),BigInt(a.validAfter),BigInt(a.validBefore),a.nonce,Number(sig.v??BigInt(27+(sig.yParity??0))),sig.r,sig.s]});
    const receipt=await chain.client.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');
    return Response.json({success:true,transaction:hash,network:'eip155:43113',payer:a.from});
  }) as typeof fetch;
  const env={SETTLEMENT_CHAIN_ID:'43113',SETTLEMENT_RPC_URL:chain.rpcUrl,SETTLEMENT_CONTRACT:chain.treasury,SETTLEMENT_TOKEN:chain.token,SETTLEMENT_PRIVATE_KEY:X402_LOCAL_EXECUTOR,SETTLEMENT_SOURCE:'beefapi',SETTLEMENT_ORDER_DEMO:'true',SETTLEMENT_X402_ENABLED:'true',BEEFAPI_TEST_BASE_URL:`http://127.0.0.1:${sourcePort}`,SETTLEMENT_TEST_TOKEN:token,SETTLEMENT_PARTNER_USER_ID:'1',SETTLEMENT_DB:join(dir,'settlement.sqlite'),SETTLEMENT_LOCK:join(dir,'settlement.lock'),SETTLEMENT_PORT:port,SETTLEMENT_TICK_MS:'1000'};
  runtime=await startFromEnv(env,{handleSignals:false});runtime.app.store.setWallet(chain.recipient);
  const cookie=(await originalFetch(origin)).headers.get('set-cookie')!.split(';')[0];
  const call=(path:string,signature?:string)=>originalFetch(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',...(signature?{'PAYMENT-SIGNATURE':signature}:{})},body:path==='/api/demo/orders'?JSON.stringify({request_id:'local-x402-e2e-001'}):'{}'});
  assert.equal((await call('/api/demo/orders')).status,200);
  const path='/api/x402/orders/local-x402-e2e-001/pay';
  const required=await call(path);assert.equal(required.status,402);
  const client=new x402Client().register('eip155:43113',new ExactEvmScheme(chain.payer)).setSpendControls({maxAmountPerPayment:'10',allowedAssets:[{network:'eip155:43113',asset:chain.token,maxAmountPerPayment:'10000000'}]});
  const httpClient=new x402HTTPClient(client);
  const requirements=httpClient.getPaymentRequiredResponse(n=>required.headers.get(n),await required.json());
  const payload=await httpClient.createPaymentPayload(requirements);
  const headers=httpClient.encodePaymentSignatureHeader(payload);
  const signature=headers['PAYMENT-SIGNATURE']??headers['payment-signature'];assert.ok(signature);
  const response=await call(path,signature);assert.equal(response.status,200,await response.clone().text());
  const settlement=httpClient.getPaymentSettleResponse(n=>response.headers.get(n));assert.equal(settlement.success,true);
  let state:any;for(let i=0;i<40;i++){state=await(await originalFetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();if(state.partner.paid==='1000000')break;await Bun.sleep(250);}
  assert.equal(state.partner.paid,'1000000');assert.equal(state.partner.pending,'0');assert.equal(state.payouts.length,1);assert.equal(state.payouts[0].status,'completed');
  const balance=(address:`0x${string}`)=>chain.client.readContract({address:chain.token,abi:tokenAbi,functionName:'balanceOf',args:[address]});
  assert.equal(await balance(chain.payer.address),90_000_000n);assert.equal(await balance(chain.treasury),9_000_000n);assert.equal(await balance(chain.recipient),1_000_000n);
  assert.equal((await call(path,signature)).status,200);assert.equal((await call(path)).status,200);assert.equal(settles,1);assert.equal((await call('/api/demo/orders/local-x402-e2e-001/pay')).status,403);
  const evidence={result:'PASS',network:'isolated Ganache chain43113; NOT public Fuji',sdk:'@x402/core + @x402/evm 2.26.0',requestId:'local-x402-e2e-001',payerUSDC:'90',treasuryUSDC:'9',recipientUSDC:'1',sourceBalances:state.partner,payout:state.payouts[0],payment:state.orders[0].payment,settleCalls:settles,checks:['official client parses402/signs authorization/reads settlement','EVM enforces real EIP712 authorization','Go order commission and automatic EVM payout','same auth replay no additional charge','synthetic payment disabled']};
  await Bun.write('docs/evidence/x402-local-e2e.json',JSON.stringify(evidence,null,2)+'\n');console.log(evidence);
  if(process.env.X402_TEST_KEEP_ALIVE==='true'){
    console.log({preview:origin,rpcUrl:chain.rpcUrl,publicTestPayer:chain.payer.address});
    await new Promise<void>(resolve=>{process.once('SIGINT',()=>resolve());process.once('SIGTERM',()=>resolve());});
  }
}finally{globalThis.fetch=originalFetch;await runtime?.shutdown();if(source){source.kill('SIGTERM');await source.exited;}await chain.server.close();rmSync(dir,{recursive:true,force:true});}
