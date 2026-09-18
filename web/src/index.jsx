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
import ReactDOM from 'react-dom/client';
import { LocaleProvider } from '@douyinfe/semi-ui';
import zhCN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import '@douyinfe/semi-ui/dist/css/semi.css';
import { PartnerProvider } from './context/Partner';
import PageLayout from './components/layout/PageLayout';
import './index.css';
import './styles/global-site.css';
import './pages/GlobalConsole/global-console.css';
import './pages/GlobalConsole/invitation.css';
import './styles/partner-chrome.css';
import './styles/partner-visual.css';

if (typeof window !== 'undefined') {
  console.log(
    '%cWE ❤ NEWAPI%c Github: https://github.com/QuantumNous/new-api',
    'color: #10b981; font-weight: bold; font-size: 24px;',
    'color: inherit; font-size: 14px;',
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LocaleProvider locale={zhCN}>
    <PartnerProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <PageLayout />
      </BrowserRouter>
    </PartnerProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
