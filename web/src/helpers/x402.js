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

import { createX402Pay } from '@settlement/app';

export function createStableX402Pay(io) {
  const payloads = io.payloads || new Map();
  const pay = createX402Pay({
    ...io,
    payloads,
    fetch: io.fetch || ((input, init) => fetch(input, init)),
    getProvider: io.getProvider || (() => window.ethereum),
    now: io.now || (() => Date.now()),
  });
  return pay;
}

export function resetX402Payloads(payloads) {
  if (payloads && typeof payloads.clear === 'function') payloads.clear();
}
