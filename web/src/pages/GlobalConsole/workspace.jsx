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

import React from 'react';
import { Link } from 'react-router-dom';
import { usePartner } from '../../context/Partner';
import { networkLabel } from '../../helpers/format';

export function ConsoleNotice() {
  const { notice } = usePartner();
  if (!notice || !notice.text) return null;
  return (
    <p
      className={notice.error ? 'partner-notice is-error' : 'partner-notice'}
      role='status'
    >
      {notice.text}
    </p>
  );
}

export function NetworkBar() {
  const { state } = usePartner();
  const network = (state && state.network) || {};
  const warning = [state && state.sourceError, network.error]
    .filter(Boolean)
    .join('；');
  return (
    <div className='partner-network'>
      <span>资金无实际价值</span>
      <span>{networkLabel(network.chainId)}</span>
      {network.configured ? null : <span>出款网络暂不可用，请检查连接</span>}
      {warning ? (
        <p className='partner-notice is-error' role='status'>
          {warning}
        </p>
      ) : null}
    </div>
  );
}

export function WorkspaceHeader({ title, description, docs }) {
  const { refresh, busy, syncLabel } = usePartner();
  return (
    <header className='global-workspace-header'>
      <div className='global-workspace-title'>
        <h1>{title}</h1>
        {description ? <p className='invitation-subtitle'>{description}</p> : null}
      </div>
      <div className='global-workspace-actions'>
        <span className='partner-sync'>{syncLabel}</span>
        {docs ? (
          <Link className='invitation-docs' to='/docs'>
            说明
          </Link>
        ) : null}
        <button
          className='global-button secondary'
          type='button'
          onClick={() => refresh().catch(() => {})}
          disabled={busy}
        >
          刷新
        </button>
      </div>
    </header>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className='global-empty-state'>
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
      {action}
    </div>
  );
}
