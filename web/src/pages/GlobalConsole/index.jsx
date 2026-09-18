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

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePartner } from '../../context/Partner';
import Loading from '../../components/common/ui/Loading';
import {
  PAYOUT_STATUSES,
  micro,
  precise,
  rateCopy,
  short,
  statusClass,
  time,
  units,
} from '../../helpers/format';
import {
  fixtureMutationsOpen,
  orderDemoOn,
} from '../../helpers/source-support';
import {
  ConsoleNotice,
  EmptyState,
  NetworkBar,
  WorkspaceHeader,
} from './workspace';
import './global-console.css';
import './invitation.css';

const COPY = {
  merchantTitle: '结算',
  merchantDescription: '查看可用收益和出款进度。',
  promoterTitle: '我的收益',
  promoterDescription: '查看收益和到账记录。',
  summary: '账户摘要',
  available: '可用收益',
  pending: '结算中',
  paid: '已到账',
  token: '出款余额',
  recent: '最近结算',
  viewAll: '全部记录',
  empty: '还没有结算记录',
  emptyBody: '出款开始后，进度和回执会显示在这里。',
  pause: '暂停出款',
  resume: '恢复出款',
  run: '立即检查结算',
  paused: '已暂停',
  running: '出款已开启',
};

export default function GlobalConsole() {
  const { role, state, busy, runAction, api } = usePartner();
  const [commissionAmount, setCommissionAmount] = useState('');
  const [commissionError, setCommissionError] = useState('');
  if (!state) return <Loading />;
  const merchant = role === 'merchant';
  const partner = state.partner || {};
  const rate = rateCopy(state.commission);
  const payouts = Array.isArray(state.payouts) ? state.payouts : [];
  const recent = payouts.slice(0, 6);
  const metrics = merchant
    ? [
        { label: COPY.available, value: precise(partner.available) },
        { label: COPY.pending, value: precise(partner.pending) },
        { label: COPY.paid, value: precise(partner.paid) },
        {
          label: COPY.token,
          value: precise(state.wallet && state.wallet.token),
        },
      ]
    : [
        { label: COPY.available, value: precise(partner.available) },
        { label: COPY.pending, value: precise(partner.pending) },
        { label: COPY.paid, value: precise(partner.paid) },
        { label: '现行比例', value: rate.value },
      ];

  return (
    <main className='global-console-page global-dashboard-page'>
      <div className='global-console-shell global-console-shell--compact'>
        <section className='global-workspace'>
          <WorkspaceHeader
            title={merchant ? COPY.merchantTitle : COPY.promoterTitle}
            description={
              merchant ? COPY.merchantDescription : COPY.promoterDescription
            }
            docs
          />
          <div className='global-workspace-content'>
            <NetworkBar />
            <ConsoleNotice />
            <section
              className='global-dashboard-metrics'
              aria-label={COPY.summary}
            >
              {metrics.map((metric) => (
                <article className='global-dashboard-metric' key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </section>

            <div className='global-dashboard-main'>
              <section className='global-dashboard-panel global-dashboard-activity'>
                <div className='global-dashboard-panel-head'>
                  <h2>{COPY.recent}</h2>
                  <Link to='/console/settlements'>{COPY.viewAll}</Link>
                </div>
                {recent.length > 0 ? (
                  <div className='global-dashboard-request-list'>
                    <div
                      className='global-dashboard-request-head partner-ledger-head'
                      aria-hidden='true'
                    >
                      <span>结算单</span>
                      <span>金额</span>
                      <span>状态</span>
                    </div>
                    {recent.map((payout) => (
                      <div
                        className='global-dashboard-request partner-ledger-row'
                        key={payout.id}
                      >
                        <strong title={payout.id}>{short(payout.id)}</strong>
                        <span>{precise(payout.amount)} USDC</span>
                        <b className={statusClass(payout.status)}>
                          {PAYOUT_STATUSES[payout.status] || payout.status}
                        </b>
                        <time>{time(payout.createdAt)}</time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={COPY.empty} body={COPY.emptyBody} />
                )}
              </section>

              <section className='global-dashboard-panel global-dashboard-setup'>
                <div className='global-dashboard-panel-head'>
                  <h2>{rate.badge || '现行比例'}</h2>
                </div>
                <div className='partner-side-panel'>
                  <p className='partner-rate-value'>{rate.value}</p>
                  <p>{rate.rule}</p>
                  <p>{rate.limit}</p>
                  {rate.example ? <p>{rate.example}</p> : null}
                  {merchant ? (
                    <div className='partner-actions'>
                      <p>
                        {state.paused ? COPY.paused : COPY.running}
                      </p>
                      <button
                        className='global-button'
                        type='button'
                        disabled={busy}
                        onClick={() =>
                          runAction(
                            () =>
                              api.request('/api/admin/pause', {
                                paused: !state.paused,
                              }),
                            '出款设置已更新',
                          )
                        }
                      >
                        {state.paused ? COPY.resume : COPY.pause}
                      </button>
                      <button
                        className='global-button secondary'
                        type='button'
                        disabled={busy || !state.network.configured}
                        onClick={() =>
                          runAction(
                            () => api.request('/api/admin/run', {}),
                            '已检查结算，请查看记录。',
                          )
                        }
                      >
                        {COPY.run}
                      </button>
                      {orderDemoOn(state) ? (
                        <Link className='global-button secondary' to='/console/orders'>
                          测试订单
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    <div className='partner-actions'>
                      <Link className='global-button' to='/console/wallet'>
                        收款钱包
                      </Link>
                    </div>
                  )}
                  {fixtureMutationsOpen(state) ? (
                    <div className='partner-actions'>
                      <button
                        className='global-button secondary'
                        type='button'
                        disabled={busy}
                        onClick={() =>
                          runAction(
                            () =>
                              api.request('/api/partner/auto', {
                                enabled: !state.partner.autoSettle,
                              }),
                            '自动结算设置已更新',
                          )
                        }
                      >
                        {state.partner.autoSettle
                          ? '关闭自动结算'
                          : '开启自动结算'}
                      </button>
                      <form
                        className='partner-amount-form'
                        onSubmit={(event) => {
                          event.preventDefault();
                          setCommissionError('');
                          let amount;
                          try {
                            amount = micro(commissionAmount);
                          } catch (error) {
                            setCommissionError(error.message);
                            return;
                          }
                          runAction(
                            () =>
                              api.request('/api/demo/commission', { amount }),
                            '测试收益已添加',
                          );
                        }}
                      >
                        <label>
                          添加测试收益
                          <input
                            value={commissionAmount}
                            onChange={(event) =>
                              setCommissionAmount(event.target.value)
                            }
                            inputMode='decimal'
                          />
                        </label>
                        {commissionError ? (
                          <p className='partner-login-error'>
                            {commissionError}
                          </p>
                        ) : null}
                        <button
                          className='global-button secondary'
                          type='submit'
                          disabled={busy}
                        >
                          添加
                        </button>
                      </form>
                    </div>
                  ) : null}
                  {merchant && state.wallet ? (
                    <p>
                      出款余额 {precise(state.wallet.token)} USDC，燃料{' '}
                      {units(state.wallet.gas, 18, 4)}
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
