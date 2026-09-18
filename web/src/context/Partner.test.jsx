import React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { PartnerProvider, usePartner } from './Partner';

// Capture callbacks before any browser paint. React state updates cannot provide
// mutual exclusion in this interval; the ref must already own the action.
test('same-frame action calls execute once and release after completion', async () => {
  let api;
  function Capture() { api = usePartner(); return null; }
  renderToString(<PartnerProvider><Capture /></PartnerProvider>);
  let calls = 0;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const task = async () => { calls++; await waiting; };
  const first = api.runAction(task);
  const second = api.runAction(task);
  expect(calls).toBe(1);
  release();
  await Promise.all([first, second]);
  await api.runAction(async () => { calls++; });
  expect(calls).toBe(2);
});

test('same-frame login calls issue a single authentication request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async () => { calls++; await pending; return Response.json({error:'test rejection'}, {status:401}); };
  try {
    let api;
    function Capture() { api = usePartner(); return null; }
    renderToString(<PartnerProvider><Capture /></PartnerProvider>);
    const first = api.login('merchant', 'local-test');
    const second = api.login('merchant', 'local-test');
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
  } finally { globalThis.fetch = original; }
});

test('same-frame x402 payment calls submit only once', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async () => { calls++; await pending; return Response.json({error:'local denial'}, {status:403}); };
  try {
    let api;
    function Capture() { api = usePartner(); return null; }
    renderToString(<PartnerProvider><Capture /></PartnerProvider>);
    const order = {requestId:'local-no-payment',paymentAmountMinor:'1000',status:'pending'};
    const first = api.payX402(order);
    const second = api.payX402(order);
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
  } finally { globalThis.fetch = original; }
});
