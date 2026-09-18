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
import { usePartner } from '../../context/Partner';
import Loading from '../../components/common/ui/Loading';
import { micro, precise, rateCopy, short } from '../../helpers/format';
import {
  canShowBind,
  fixtureMutationsOpen,
  isFixtureSource,
  orderDemoOn,
} from '../../helpers/source-support';
import {
  ConsoleNotice,
  EmptyState,
  NetworkBar,
  WorkspaceHeader,
} from './workspace';

async function bindWallet(api) {
  if (!window.ethereum)
    throw new Error('未检测到钱包扩展，请先安装并解锁支持 Ethereum 的钱包。');
  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts',
  });
  const address = accounts[0];
  if (!address) throw new Error('钱包未提供账户。');
  const challenge = await api.request('/api/partner/wallet/challenge', {
    address,
  });
  const bytes = new TextEncoder().encode(challenge.message);
  const hex =
    '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [hex, address],
  });
  await api.request('/api/partner/wallet/verify', { address, signature });
}

export default function ConsoleWallet() {
  const { state, busy, runAction, api } = usePartner();
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  if (!state) return <Loading />;
  const partner = state.partner || {};
  const rate = rateCopy(state.commission);
  const showBind = canShowBind(state);
  const fixtureOpen = fixtureMutationsOpen(state);
  const local = Number(state.network && state.network.chainId) !== 43113;

  return (
    <main className='global-console-page invitation-page'>
      <div className='global-console-shell global-console-shell--compact'>
        <section className='global-workspace'>
          <WorkspaceHeader
            title='收款钱包'
            description='绑定后，佣金付到这个地址。'
            docs
          />
          <div className='global-workspace-content'>
            <NetworkBar />
            <ConsoleNotice />
            <section className='invitation-hero' aria-label='收款钱包'>
              <div className='invitation-rate'>
                <span className='invitation-eyebrow'>{rate.badge || '现行比例'}</span>
                <strong className='invitation-rate-value'>{rate.value}</strong>
                <p>{rate.rule}</p>
              </div>
              <div className='invitation-share-body'>
                <div>
                  <h2>收款地址</h2>
                  <p>
                    {isFixtureSource(state) || orderDemoOn(state)
                      ? orderDemoOn(state)
                        ? '测试订单的佣金付到绑定钱包。'
                        : '收款地址由你签名确认。'
                      : '收款地址由 BeefAPI 随结算单确认，可在每笔回执中查看。'}
                  </p>
                </div>
                <div className='invitation-link-field'>
                  <input
                    aria-label='收款地址'
                    value={partner.wallet || '尚未绑定收款钱包'}
                    readOnly
                    onFocus={(event) => event.target.select()}
                  />
                </div>
                {showBind ? (
                  <div className='partner-actions'>
                    <button
                      className='global-button'
                      type='button'
                      disabled={busy}
                      onClick={() =>
                        runAction(() => bindWallet(api), '收款钱包已验证')
                      }
                    >
                      签名绑定收款钱包
                    </button>
                    {fixtureOpen && local ? (
                      <button
                        className='global-button secondary'
                        type='button'
                        disabled={busy}
                        onClick={() =>
                          runAction(
                            () => api.request('/api/demo/wallet', {}),
                            '本地测试收款钱包已绑定',
                          )
                        }
                      >
                        绑定本地测试钱包
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p>当前来源不在这里绑定收款地址。</p>
                )}
              </div>
            </section>

            <section className='invitation-metrics' aria-label='收益'>
              <div className='invitation-metric invitation-metric--pending'>
                <span className='invitation-eyebrow'>可用收益</span>
                <strong>{precise(partner.available)}</strong>
              </div>
              <div className='invitation-metric'>
                <span className='invitation-eyebrow'>结算中</span>
                <strong>{precise(partner.pending)}</strong>
              </div>
              <div className='invitation-metric'>
                <span className='invitation-eyebrow'>已到账</span>
                <strong>{precise(partner.paid)}</strong>
              </div>
            </section>

            {fixtureOpen ? (
              <section className='global-workspace-section'>
                <h2>演示工具</h2>
                <p>
                  转入后用于测试消费，不再参与结算。当前余额{' '}
                  {precise(partner.consumed)} USDC。
                </p>
                <form
                  className='partner-amount-form'
                  onSubmit={(event) => {
                    event.preventDefault();
                    setTransferError('');
                    let amount;
                    try {
                      amount = micro(transferAmount);
                    } catch (error) {
                      setTransferError(error.message);
                      return;
                    }
                    runAction(
                      () => api.request('/api/partner/transfer', { amount }),
                      '已划入测试消费余额',
                    );
                  }}
                >
                  <label>
                    划入金额
                    <input
                      value={transferAmount}
                      onChange={(event) => setTransferAmount(event.target.value)}
                      inputMode='decimal'
                    />
                  </label>
                  {transferError ? (
                    <p className='partner-login-error'>{transferError}</p>
                  ) : null}
                  <button className='global-button' type='submit' disabled={busy}>
                    划入测试消费
                  </button>
                </form>
              </section>
            ) : null}

            {partner.wallet ? (
              <p className='global-workspace-note'>
                当前地址 {short(partner.wallet)}
              </p>
            ) : (
              <EmptyState
                title='尚未绑定收款钱包'
                body='绑定后，新的佣金会付到这个地址。'
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
