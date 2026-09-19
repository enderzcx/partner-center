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
              伙伴中心由 BF Labs 构建，面向商家的推广合作与链上佣金结算。BeefAPI 是首个测试接入案例。登录后可查看本人权限范围内的收益与回执。
            </p>
          </header>

          <section>
            <h2>商家自己的伙伴中心</h2>
            <p>我们正在建设可由商家自主部署、连接已有业务的伙伴中心，逐步支持旗下多个产品的合作计划与收益管理。</p>
            <p>当前为单商家 Fuji 测试版本。源码已公开，部署时需要配置业务适配器、账号和结算服务，尚未提供通用的一键接入。</p>
            <p>现有业务负责确认订单、推广归属和佣金金额，伙伴中心负责执行结算、核对到账并回写结果。x402 是已验证的测试收款入口，其他收款方式仍需适配。</p>
            <p><a href='https://github.com/enderzcx/partner-center' target='_blank' rel='noreferrer'>查看源码与部署说明</a></p>
          </section>

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
            <p>测试案例由业务系统在下单时锁定比例并计算佣金。之后调整只作用于新订单，不影响已有结算单。</p>
            <p>以订单中显示的锁定比例为准。比例为 0% 时不产生新返佣。</p>
          </section>

          <section>
            <h2>佣金权利与后续接入</h2>
            <p>新佣金托管合约已完成本地验证，尚未部署 Fuji 或接入线上执行器。它在登记最终确认的佣金时固定金额、受益人和可领取时间，并预留对应资金。</p>
            <p>当前设计在业务退款与确认条件结束后登记权利。到期需要服务、推广者或其他执行者发起调用，款项只能付给原受益人。</p>
            <p>下一步将验证 Fuji 领取路径和更多业务接入。Avalanche ICM／ICTT 跨 L1 接入、专用 L1 评估及 MCP 接口均为后续规划。</p>
            <p><Link to='/progress'>查看产品进展</Link> · <a href='/demo'>查看演示</a></p>
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
