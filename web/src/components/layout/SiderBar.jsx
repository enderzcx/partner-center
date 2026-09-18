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

import React, { useEffect, useMemo, useRef } from 'react';
import Avatar from 'boring-avatars';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  ChevronLeft,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { useSidebarCollapsed } from '../../hooks/common/useSidebarCollapsed';
import { usePartner } from '../../context/Partner';
import GlobalBrandMark from '../common/logo/GlobalBrandMark';
import { Nav } from '@douyinfe/semi-ui';
import {
  selectedSidebarKey,
  sidebarItemsFor,
} from '../../helpers/source-support';

const GLOBAL_SIDEBAR_COPY = {
  brand: '伙伴中心',
  docs: '说明',
  signOut: '退出',
  accountMenu: '账号菜单',
};

const GLOBAL_AVATAR_COLORS = [
  '#1D2430',
  '#33415C',
  '#3F5FD7',
  '#8FA3C8',
  '#2F7A54',
];

const ICONS = {
  console: LayoutDashboard,
  orders: ReceiptText,
  settlements: ScrollText,
  wallet: Wallet,
};

const SiderBar = ({ onNavigate = () => {} }) => {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const location = useLocation();
  const { role, state, logout, loginBusy } = usePartner();
  const globalAccountDetailsRef = useRef(null);
  const selectedKey = selectedSidebarKey(location.pathname);
  const items = useMemo(
    () => sidebarItemsFor(role, state),
    [role, state],
  );
  const accountLabel =
    role === 'merchant' ? '商家' : role === 'promoter' ? '推广者' : '账号';

  useEffect(() => {
    if (collapsed) {
      globalAccountDetailsRef.current?.removeAttribute('open');
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
    return () => document.body.classList.remove('sidebar-collapsed');
  }, [collapsed]);

  return (
    <div className='sidebar-container'>
      <div className='global-sidebar-brand'>
        <Link
          className='global-sidebar-brand-link'
          to='/'
          onClick={onNavigate}
        >
          <GlobalBrandMark />
          <span className='global-sidebar-brand-copy'>
            <strong>{GLOBAL_SIDEBAR_COPY.brand}</strong>
          </span>
        </Link>
        <button
          type='button'
          className='global-sidebar-collapse-button'
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!collapsed}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleCollapsed();
          }}
        >
          <ChevronLeft
            size={17}
            strokeWidth={2.25}
            aria-hidden='true'
            className={
              collapsed
                ? 'partner-collapse-icon is-collapsed'
                : 'partner-collapse-icon'
            }
          />
        </button>
      </div>
      <Nav
        className='sidebar-nav'
        defaultIsCollapsed={collapsed}
        isCollapsed={collapsed}
        onCollapseChange={toggleCollapsed}
        selectedKeys={[selectedKey]}
        itemStyle='sidebar-nav-item'
        hoverStyle='sidebar-nav-item:hover'
        selectedStyle='sidebar-nav-item-selected'
        renderWrapper={({ itemElement, props }) => {
          const item = items.find((entry) => entry.key === props.itemKey);
          if (!item) return itemElement;
          return (
            <Link
              className='partner-nav-link'
              to={item.to}
              onClick={onNavigate}
            >
              {itemElement}
            </Link>
          );
        }}
      >
        {items.map((item) => {
          const Icon = ICONS[item.key] || LayoutDashboard;
          const selected = selectedKey === item.key;
          return (
            <Nav.Item
              key={item.key}
              itemKey={item.key}
              text={<span className='partner-nav-label'>{item.text}</span>}
              icon={
                <div className='sidebar-icon-container'>
                  <Icon
                    size={16}
                    strokeWidth={selected ? 2.2 : 1.9}
                    aria-hidden='true'
                  />
                </div>
              }
            />
          );
        })}
      </Nav>
      <div className='global-sidebar-account'>
        <Link
          className='global-sidebar-community-link'
          to='/docs'
          onClick={onNavigate}
        >
          <span>{GLOBAL_SIDEBAR_COPY.docs}</span>
          <ArrowUpRight size={14} aria-hidden='true' />
        </Link>
        <details ref={globalAccountDetailsRef}>
          <summary>
            <span className='global-sidebar-avatar' aria-hidden='true'>
              <Avatar
                size={32}
                name={accountLabel}
                variant='bauhaus'
                colors={GLOBAL_AVATAR_COLORS}
                square
              />
            </span>
            <span className='global-sidebar-account-copy'>
              <strong>{accountLabel}</strong>
            </span>
            <span className='global-sidebar-account-chevron' aria-hidden='true'>
              ⌃
            </span>
          </summary>
          <nav aria-label={GLOBAL_SIDEBAR_COPY.accountMenu}>
            <button
              type='button'
              onClick={() => {
                onNavigate();
                logout();
              }}
              disabled={loginBusy}
            >
              {GLOBAL_SIDEBAR_COPY.signOut}
            </button>
          </nav>
        </details>
      </div>
    </div>
  );
};

export default SiderBar;
