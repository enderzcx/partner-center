// Credentials arrive over stdin. Never print credentials, cookies or raw errors.
import assert from 'node:assert/strict';
let stage = 'input';
try {
  const access = await Bun.stdin.json();
  const origin = process.env.VERIFY_ORIGIN ?? 'https://partner.bflabs.app';
  const base = process.env.VERIFY_BASE_URL ?? origin;
  const call = async (path, {cookie, body, requestOrigin=origin}={}) => {
    const r = await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:new URL(origin).host,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const text = await r.text();let data=null;try{data=JSON.parse(text);}catch{}
    return {status:r.status,data,cookie:r.headers.get('set-cookie')};
  };
  const login = async (role) => {
    const a=access.accounts.find(a=>a.username===role);assert.ok(a);
    const r=await call('/api/auth/login',{body:{username:a.username,password:a.password}});
    assert.equal(r.status,200);assert.equal(r.data.role,role);
    assert.ok(r.cookie?.includes('HttpOnly')&&r.cookie.includes('Secure')&&r.cookie.includes('SameSite=Strict'));
    return r.cookie.split(';')[0];
  };
  stage='anonymous';assert.equal((await call('/')).cookie,null);assert.equal((await call('/api/state')).status,401);
  assert.equal((await call('/api/auth/login',{requestOrigin:'https://untrusted.example',body:{username:'merchant',password:'invalid'}})).status,403);
  assert.equal((await call('/api/settlement-test/orders')).status===200,false);
  stage='merchant';const m=await login('merchant');const ms=(await call('/api/state',{cookie:m})).data;
  assert.equal(ms.role,'merchant');assert.equal(ms.network.chainId,43113);assert.equal(ms.partner.paid,'1000000');assert.equal(ms.partner.pending,'0');
  assert.ok(ms.payouts.some(p=>p.status==='completed'&&p.txHash==='0x4d90fbc94781a485ff31834e98f43161e3c257b68b450771694d7c855f2f9a48'));
  assert.equal((await call('/api/partner/wallet/challenge',{cookie:m,body:{address:ms.partner.wallet}})).status,403);
  stage='completed-order-replay';const replay=await call('/api/demo/orders/'+ms.orders[0].requestId+'/pay',{cookie:m,body:{}});assert.equal(replay.status,200);const replayState=(await call('/api/state',{cookie:m})).data;assert.equal(replayState.payouts.length,ms.payouts.length);assert.equal(replayState.partner.paid,ms.partner.paid);
  stage='promoter';const p=await login('promoter');assert.notEqual(p,m);const ps=(await call('/api/state',{cookie:p})).data;
  assert.equal(ps.role,'promoter');assert.equal(ps.orders,undefined);assert.equal(ps.wallet.token,'');assert.equal(ps.wallet.gas,'');assert.equal(ps.sourceError,undefined);assert.equal(ps.partner.paid,'1000000');assert.equal(ps.paused,ms.paused);
  for(const [path,body] of [['/api/admin/run',{}],['/api/admin/pause',{paused:true}],['/api/demo/orders',{}]]) assert.equal((await call(path,{cookie:p,body})).status,403);
  stage='wallet-domain';const challenge=await call('/api/partner/wallet/challenge',{cookie:p,body:{address:ps.partner.wallet}});assert.equal(challenge.status,200);assert.ok(challenge.data.message.includes('Domain: '+origin));
  stage='logout';assert.equal((await call('/api/auth/logout',{cookie:m,body:{}})).status,200);assert.equal((await call('/api/state',{cookie:m})).status,401);assert.equal((await call('/api/auth/logout',{cookie:p,body:{}})).status,200);assert.equal((await call('/api/state',{cookie:p})).status,401);
  console.log(JSON.stringify({result:'PASS',origin,transport:base.startsWith('https:')?'HTTPS':'private-loopback',checks:['anonymous denial','secure role sessions','cross-origin denial','source routes not exposed','merchant/promoter isolation','wallet signature domain','preserved Fuji receipt','completed order replay','logout invalidation'],newPayments:0},null,2));
} catch { console.error(JSON.stringify({result:'FAIL',stage,details:'Credential-bearing error details suppressed'}));process.exitCode=1; }
