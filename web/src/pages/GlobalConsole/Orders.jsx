/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { usePartner } from '../../context/Partner';
import Loading from '../../components/common/ui/Loading';
import { fujiExplorerTx, isTxHash, short } from '../../helpers/format';
import { orderDemoOn, x402Enabled } from '../../helpers/source-support';
import { orderView } from './order-view';
import {
  ConsoleNotice,
  EmptyState,
  NetworkBar,
  WorkspaceHeader,
} from './workspace';

export default function ConsoleOrders() {
  const {
    state,
    busy,
    authEnabled,
    runAction,
    payX402,
    api,
    x402Payloads,
  } = usePartner();
  const createIdRef = useRef(null);
  if (!state) return <Loading />;
  if (!orderDemoOn(state)) return <Navigate to='/console' replace />;

  const orders = Array.isArray(state.orders) ? state.orders : [];
  const x402On = x402Enabled(state);

  return (
    <main className='global-console-page'>
      <div className='global-console-shell global-console-shell--compact'>
        <section className='global-workspace'>
          <WorkspaceHeader
            title='测试订单'
            description={
              x402On
                ? '默认创建 10 测试 USDC 订单。'
                : '默认创建 10 USD 测试订单。'
            }
            docs
          />
          <div className='global-workspace-content'>
            <NetworkBar />
            <ConsoleNotice />
            <div className='partner-actions'>
              <button
                className='global-button'
                type='button'
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    createIdRef.current ??= crypto.randomUUID();
                    await api.request('/api/demo/orders', {
                      request_id: createIdRef.current,
                    });
                    createIdRef.current = null;
                  }, '测试订单已创建')
                }
              >
                {x402On ? '创建 10 测试 USDC 订单' : '创建 10 USD 测试订单'}
              </button>
            </div>
            {orders.length === 0 ? (
              <EmptyState
                title='还没有测试订单'
                body='创建后可确认支付并查看佣金。'
              />
            ) : (
              <div className='partner-order-list'>
                {orders.map((order) => {
                  const view = orderView(
                    order,
                    state,
                    x402Payloads,
                    authEnabled,
                  );
                  return (
                    <article
                      className='partner-order'
                      key={order.requestId}
                    >
                      <div className='partner-order-top'>
                        <span>{short(order.tradeNo || order.requestId)}</span>
                        <span className='partner-badge'>{view.statusLabel}</span>
                      </div>
                      <div className='partner-order-facts'>
                        <span>{view.amountLabel}</span>
                        <span>
                          锁定比例 <strong>{view.rateText}</strong>
                        </span>
                        <span>
                          佣金 <strong>{view.commissionText}</strong>
                        </span>
                      </div>
                      {view.orderError ? (
                        <p className='partner-login-error'>{view.orderError}</p>
                      ) : null}
                      <p className='partner-order-hint'>{view.hint}</p>
                      {view.x402 && isTxHash(view.incomingHash) ? (
                        <p>
                          <a
                            href={fujiExplorerTx(view.incomingHash)}
                            target='_blank'
                            rel='noopener noreferrer'
                          >
                            在 Fuji 浏览器查看付款
                          </a>
                        </p>
                      ) : null}
                      {view.canPay ? (
                        <button
                          className='global-button'
                          type='button'
                          disabled={busy || view.payDisabled}
                          onClick={() => {
                            if (view.x402) {
                              payX402(order);
                              return;
                            }
                            runAction(
                              () =>
                                api.request(
                                  '/api/demo/orders/' +
                                    encodeURIComponent(order.requestId) +
                                    '/pay',
                                  {},
                                ),
                              '测试订单已确认，不会向买家扣款。',
                            );
                          }}
                        >
                          {view.buttonText}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
