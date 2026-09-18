import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {encodeAbiParameters,parseAbiParameters,type TransactionReceipt} from 'viem';
import {receiptMatchesPayment} from '../src/x402/verify.ts';
const receipt=JSON.parse(readFileSync(new URL('./fixtures/x402-fuji-multicall-receipt.json',import.meta.url),'utf8')) as TransactionReceipt;
const terms={token:'0x5425890298aed601595a70AB815c96711a31Bc65',payTo:'0x5c905e43e0BB381534530d5e05DF56ab1f420899',payer:'0x28172e0d973fFf24651B6Ed4cA6d1007bc168C94',amount:10000000n,nonce:'0x06804d328a264de350af122b4d2d2103869cd70de6728bab273110af020fd12a'} as const;
test('actual finalized Fuji PayAI Multicall receipt matches this authorization transfer',()=>{
 expect(receipt.to?.toLowerCase()).toBe('0xca11bde05977b3631167028862be2a173976ca11');
 expect(receiptMatchesPayment({receipt,...terms})).toBe(true);
});
test('another transfer in the same batch cannot cover a wrong authorization transfer',()=>{
 const wrong={...receipt.logs[1]!,data:encodeAbiParameters(parseAbiParameters('uint256'),[1n])};
 const fake={...receipt,logs:[receipt.logs[0]!,wrong,receipt.logs[1]!]};
 expect(receiptMatchesPayment({receipt:fake,...terms})).toBe(false);
});
test('another authorization cannot lend its transfer to the requested nonce',()=>{
 const unrelated={...receipt.logs[0]!,topics:[receipt.logs[0]!.topics[0],receipt.logs[0]!.topics[1],('0x'+'ff'.repeat(32)) as `0x${string}`]};
 expect(receiptMatchesPayment({receipt:{...receipt,logs:[receipt.logs[0]!,unrelated,receipt.logs[1]!] as TransactionReceipt['logs']},...terms})).toBe(false);
});
test('wrong token, recipient, amount and reverted receipt remain rejected',()=>{
 expect(receiptMatchesPayment({receipt,...terms,amount:1000000n})).toBe(false);
 expect(receiptMatchesPayment({receipt,...terms,payTo:terms.payer})).toBe(false);
 expect(receiptMatchesPayment({receipt:{...receipt,status:'reverted'},...terms})).toBe(false);
});
