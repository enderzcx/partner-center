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

export function isFixtureSource(state) {
  return !!(state && state.source === 'fixture');
}

export function orderDemoOn(state) {
  return !!(state && state.orderDemo);
}

export function x402Enabled(state) {
  return !!(state && state.x402 && state.x402.enabled === true);
}

export function authRequired(state) {
  return !state || state.authEnabled !== false;
}

export function fixtureMutationsOpen(state) {
  return isFixtureSource(state) && !authRequired(state);
}

export function canShowBind(state) {
  return isFixtureSource(state) || orderDemoOn(state);
}

export function canAccessConsolePath(role, pathname) {
  if (!pathname || pathname === '/console' || pathname === '/console/')
    return true;
  if (pathname === '/console/settlements') return true;
  if (pathname === '/console/orders' || pathname.startsWith('/console/orders/'))
    return role === 'merchant';
  if (pathname === '/console/wallet') return role === 'promoter';
  return false;
}

export function sidebarItemsFor(role, state) {
  const merchant = role === 'merchant';
  const items = [
    {
      key: 'console',
      to: '/console',
      text: merchant ? '结算' : '我的收益',
    },
  ];
  if (merchant && orderDemoOn(state)) {
    items.push({ key: 'orders', to: '/console/orders', text: '测试订单' });
  }
  items.push({
    key: 'settlements',
    to: '/console/settlements',
    text: '结算记录',
  });
  if (role === 'promoter' || (state && state.authEnabled === false)) {
    items.push({ key: 'wallet', to: '/console/wallet', text: '收款钱包' });
  }
  return items;
}

export function selectedSidebarKey(pathname) {
  if (pathname.startsWith('/console/orders')) return 'orders';
  if (pathname.startsWith('/console/settlements')) return 'settlements';
  if (pathname.startsWith('/console/wallet')) return 'wallet';
  return 'console';
}
