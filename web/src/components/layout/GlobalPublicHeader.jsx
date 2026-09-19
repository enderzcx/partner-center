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
import GlobalBrandMark from '../common/logo/GlobalBrandMark';
import './GlobalPublicHeader.css';

export const GLOBAL_PUBLIC_HEADER_COPY = {
  brandHome: '伙伴中心首页',
  brand: '伙伴中心',
  primaryNavigation: '主要导航',
  docs: '说明',
  login: '登录',
  getStarted: '进入控制台',
};

export const GLOBAL_PUBLIC_NAV_LINKS = [
  { text: '产品进展', itemKey: 'progress', to: '/progress' },
  {
    text: GLOBAL_PUBLIC_HEADER_COPY.docs,
    itemKey: 'docs',
    to: '/docs',
  },
  {
    text: GLOBAL_PUBLIC_HEADER_COPY.login,
    itemKey: 'login',
    to: '/login',
  },
];

const NAV_ITEMS = GLOBAL_PUBLIC_NAV_LINKS.map((item) => ({
  key: item.itemKey,
  href: item.to,
  label: item.text,
}));

export function currentGlobalPublicNav(pathname = '') {
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return 'docs';
  if (pathname === '/progress') return 'progress';
  if (pathname === '/login') return 'login';
  return '';
}

export default function GlobalPublicHeader({ pathname = '' }) {
  const active = currentGlobalPublicNav(pathname);

  return (
    <header className='global-public-header'>
      <a
        className='global-public-header-brand'
        href='/'
        aria-label={GLOBAL_PUBLIC_HEADER_COPY.brandHome}
      >
        <GlobalBrandMark />
        <span>{GLOBAL_PUBLIC_HEADER_COPY.brand}</span>
      </a>
      <nav
        className='global-public-header-links'
        aria-label={GLOBAL_PUBLIC_HEADER_COPY.primaryNavigation}
      >
        {NAV_ITEMS.map((item) => (
          <a
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? 'page' : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <a className='global-public-header-cta' href='/console'>
        {GLOBAL_PUBLIC_HEADER_COPY.getStarted}
      </a>
    </header>
  );
}
