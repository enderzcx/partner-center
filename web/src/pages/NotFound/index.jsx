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
import GlobalPublicHeader from '../../components/layout/GlobalPublicHeader';
import GlobalPublicFooter from '../../components/layout/GlobalPublicFooter';

const COPY = {
  code: '找不到页面',
  title: '没有这一页。',
  body: '请检查地址，返回首页，或登录后进入控制台。',
  recovery: '去向',
  home: '返回首页',
  console: '进入控制台',
};

const NotFound = () => {
  return (
    <div className='global-home-page'>
      <GlobalPublicHeader pathname='' />
      <main className='global-not-found'>
        <div className='global-not-found-inner'>
          <code>{COPY.code}</code>
          <h1>{COPY.title}</h1>
          <p>{COPY.body}</p>
          <nav aria-label={COPY.recovery}>
            <Link to='/'>{COPY.home}</Link>
            <Link to='/console'>{COPY.console}</Link>
          </nav>
        </div>
      </main>
      <GlobalPublicFooter />
    </div>
  );
};

export default NotFound;
