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

import React, { useEffect, useRef, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { usePartner } from '../../context/Partner';
import Loading from '../../components/common/ui/Loading';
import {
  PAYOUT_STATUSES,
  fujiExplorerTx,
  isTxHash,
  networkLabel,
  precise,
  short,
  statusClass,
  time,
} from '../../helpers/format';
import { orderUsesX402 } from '../../../../public/app.js';
import { x402Enabled } from '../../helpers/source-support';
import { orderPayment } from './order-view';
import {
  ConsoleNotice,
  EmptyState,
  NetworkBar,
  WorkspaceHeader,
} from './workspace';

function orderForPayout(state, payout) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const sourceId = String((payout && payout.sourceId) || '');
  return orders.find((order) =>
    sourceId.startsWith('beefapi:order-' + order.requestId + ':'),
  );
}

export default function ConsoleSettlements() {
  const { state, role } = usePartner();
  const [selected, setSelected] = useState(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);
  if (!state) return <Loading />;
  const payouts = Array.isArray(state.payouts) ? state.payouts : [];
  const selectedPayout = payouts.find(
    (item) => String(item.id) === String(selected),
  );
  const matched = selectedPayout
    ? orderForPayout(state, selectedPayout)
    : null;
  const incomingHash =
    matched && orderPayment(matched) && orderPayment(matched).txHash;
  const showIncoming =
    matched &&
    (orderUsesX402(matched, x402Enabled(state)) ||
      isTxHash(incomingHash));
  const n = state.network || {};
  const fuji = Number(n.chainId) === 43113;
  const confirmed =
    selectedPayout &&
    ['confirmed', 'completed'].includes(selectedPayout.status);

  return (
    <main className='global-console-page invitation-page'>
      <div className='global-console-shell global-console-shell--compact'>
        <section className='global-workspace'>
          <WorkspaceHeader
            title='结算记录'
            description={
              role === 'merchant'
                ? '查看出款进度和回执。'
                : '查看收益到账记录和回执。'
            }
            docs
          />
          <div className='global-workspace-content'>
            <NetworkBar />
            <ConsoleNotice />
            <section className='invitation-activity' aria-label='结算记录'>
              <h2>全部记录 · {payouts.length} 笔</h2>
              {payouts.length === 0 ? (
                <div className='invitation-empty'>
                  <ReceiptText size={24} aria-hidden='true' />
                  <strong>还没有结算记录</strong>
                  <span>出款开始后，进度和回执会显示在这里。</span>
                </div>
              ) : (
                <div className='partner-table-wrap'>
                  <table className='partner-table'>
                    <thead>
                      <tr>
                        <th scope='col'>结算单</th>
                        <th scope='col'>金额 · USDC</th>
                        <th scope='col'>收款钱包</th>
                        <th scope='col'>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((payout) => (
                        <tr key={payout.id}>
                          <td>
                            <button
                              className='partner-receipt-button'
                              type='button'
                              onClick={() => setSelected(payout.id)}
                            >
                              {short(payout.id)}
                              <span>
                                {time(payout.createdAt)} · 查看回执
                              </span>
                            </button>
                          </td>
                          <td>{precise(payout.amount)}</td>
                          <td title={payout.recipient}>
                            {short(payout.recipient)}
                          </td>
                          <td>
                            <span
                              className={
                                'partner-badge ' + statusClass(payout.status)
                              }
                            >
                              {PAYOUT_STATUSES[payout.status] || payout.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
      <dialog
        className='invitation-transfer'
        ref={dialogRef}
        aria-label='结算回执'
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
      >
        {selectedPayout ? (
          <div className='invitation-transfer-card'>
            <div className='partner-receipt-header'>
              <h2>结算回执</h2>
              <button className='global-button secondary' type='button' onClick={() => setSelected(null)}>关闭</button>
            </div>
            <span className={'partner-badge ' + statusClass(selectedPayout.status)}>
              {PAYOUT_STATUSES[selectedPayout.status] || selectedPayout.status}
            </span>
            <p className='partner-receipt-amount'>
              {precise(selectedPayout.amount)} <small>USDC</small>
            </p>
            <p className='partner-payee'>{networkLabel(n.chainId)}<br />收款地址<br /><span>{selectedPayout.recipient}</span></p>
            <details className='partner-receipt-details'>
              <summary>单号与交易详情</summary>
            <dl className='partner-receipt-fields'>
              <div>
                <dt>结算单号</dt>
                <dd>{selectedPayout.id}</dd>
              </div>
              <div>
                <dt>业务单号</dt>
                <dd>{selectedPayout.sourceId || '暂无单号'}</dd>
              </div>
              <div>
                <dt>网络</dt>
                <dd>
                  {networkLabel(n.chainId)} · {n.chainId}
                </dd>
              </div>
              <div>
                <dt>代币</dt>
                <dd>{n.token || '暂无代币地址'}</dd>
              </div>
              <div>
                <dt>收款地址</dt>
                <dd>{selectedPayout.recipient}</dd>
              </div>
              {showIncoming ? (
                <div>
                  <dt>付款交易</dt>
                  <dd>
                    {isTxHash(incomingHash) ? incomingHash : '尚未支付'}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{showIncoming ? '出款交易' : '链上交易'}</dt>
                <dd>{selectedPayout.txHash || '尚未发送'}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{time(selectedPayout.createdAt)}</dd>
              </div>
              <div>
                <dt>到账</dt>
                <dd>{confirmed ? '已确认' : '尚未确认'}</dd>
              </div>
              <div>
                <dt>记录</dt>
                <dd>
                  {selectedPayout.status === 'completed' ? '已完成' : '更新中'}
                </dd>
              </div>
              {selectedPayout.error ? (
                <div>
                  <dt>待处理原因</dt>
                  <dd>{selectedPayout.error}</dd>
                </div>
              ) : null}
            </dl>
            </details>
            {fuji && isTxHash(incomingHash) ? (
              <p>
                <a
                  href={fujiExplorerTx(incomingHash)}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  在 Fuji 浏览器查看付款
                </a>
              </p>
            ) : null}
            {fuji && isTxHash(selectedPayout.txHash) ? (
              <p>
                <a
                  href={fujiExplorerTx(selectedPayout.txHash)}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {showIncoming
                    ? '在 Fuji 浏览器查看出款'
                    : '在 Fuji 浏览器查看交易'}
                </a>
              </p>
            ) : null}

          </div>
        ) : null}
      </dialog>
    </main>
  );
}
