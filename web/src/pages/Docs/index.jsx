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

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import GlobalPublicHeader from '../../components/layout/GlobalPublicHeader';
import GlobalPublicFooter from '../../components/layout/GlobalPublicFooter';

export default function DocsPage() {
  useEffect(() => {
    document.title = '说明 · 伙伴中心';
  }, []);

  return (
    <div className='global-home-page partner-docs-page'>
      <GlobalPublicHeader pathname='/docs' />
      <main id='page-top' className='partner-docs'>
        <div className='global-home-shell'>
          <header className='partner-docs-head'>
            <h1>使用说明</h1>
            <p>
              伙伴中心由 BF Labs 提供。当前接入 BeefAPI。登录后才能查看收益和出款。
            </p>
          </header>

          <section>
            <h2>登录</h2>
            <p>使用已开通的账号和密码登录。账号开通或登录遇到问题时，请联系演示负责人。</p>
            <p>
              <Link to='/login'>打开登录页</Link>
            </p>
          </section>

          <section>
            <h2>商家</h2>
            <p>登录后可查看可用收益、结算中金额、已到账金额和出款进度。</p>
            <p>可以暂停或恢复出款，也可以立即检查结算。结果出现在结算记录里。</p>
            <p>在测试订单页面创建订单后，可以使用钱包支付测试 USDC，付款确认后按订单比例结算佣金。</p>
          </section>

          <section>
            <h2>推广者</h2>
            <p>登录后可查看收益和到账记录。</p>
            <p>绑定收款钱包时，需要在钱包里确认一条签名。不会自动发起签名或转账。</p>
          </section>

          <section>
            <h2>返佣怎么算</h2>
            <p>按实际支付金额计算。赠送、试用与收益转入不计返佣。</p>
            <p>比例在下单时确定。之后调整只作用于新订单，不影响已有结算单。</p>
            <p>以订单中显示的锁定比例为准。比例为 0% 时不产生新返佣。</p>
          </section>

          <section>
            <h2>资金说明</h2>
            <p>当前使用 Avalanche Fuji 测试网，测试 USDC 没有实际价值。可以在回执中核对金额、地址和链上交易。</p>
          </section>
        </div>
      </main>
      <GlobalPublicFooter />
    </div>
  );
}
