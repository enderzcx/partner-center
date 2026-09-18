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

// BFLabs monogram (the single-color UI mark from the brand kit). All strokes
// follow the surrounding text color so the mark adapts to light and dark
// surfaces; the orange accent is reserved for the tile icon.
const GlobalBrandMark = ({ className = 'global-brand-mark' }) => (
  <svg
    className={className}
    viewBox='0 0 1200 700'
    aria-hidden='true'
    focusable='false'
  >
    <path
      fill='currentColor'
      fillRule='evenodd'
      clipRule='evenodd'
      d='M0 4H463C570 4 648 82 648 207C648 268 629 318 598 350C634 382 658 432 658 500C658 616 582 700 470 700H0ZM144 160H440C476 160 499 186 499 224C499 253 486 271 463 278H144ZM370 278H445L582 350H428ZM428 350H582L470 422H374ZM374 422H470C493 433 506 458 506 490C506 524 481 550 442 550H144V430H374Z'
    />
    <path fill='currentColor' d='M556 4H1122L1035 160H680C665 104 622 47 556 4Z' />
    <path
      fill='currentColor'
      d='M679 292H1200L1114 444H684C670 414 658 384 650 350C657 328 667 309 679 292Z'
    />
  </svg>
);

export default GlobalBrandMark;
