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
import { Spin } from '@douyinfe/semi-ui';
import { usePartner } from '../../../context/Partner';

const Loading = ({ size = 'small' }) => {
  const { notice, refresh } = usePartner();
  if (notice?.kind === 'sync') return (
    <div className='partner-loading' role='alert'>
      <span>{notice.text}</span>
      <button className='global-button secondary' onClick={() => refresh().catch(() => {})}>重新读取</button>
    </div>
  );
  return (
    <div className='partner-loading' role='status'>
      <Spin size={size} spinning={true} />
      <span>正在读取</span>
    </div>
  );
};

export default Loading;
