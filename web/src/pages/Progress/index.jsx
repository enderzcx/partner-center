import React, { useEffect, useRef, useState } from 'react';
import GlobalPublicHeader from '../../components/layout/GlobalPublicHeader';
import GlobalPublicFooter from '../../components/layout/GlobalPublicFooter';
import '../GlobalHome/global-home.css';
import './progress.css';

const explorer = 'https://testnet.avascan.info';
const incoming = '0xd0df9f773a5d033e4ee0475a47cf48f54c653b778077662555e6c531d45104c6';
const outgoing = '0x6f9843b7c2d14211c07ef6d539a625cd4c8b1c962426b49ada6b15ac8fdea23d';
const stages = [
  { value: '10', unit: 'USDC', title: '订单收款', detail: 'x402 付款，链上核验到账', href: `${explorer}/tx/${incoming}` },
  { value: '10', unit: '%', title: '确认佣金', detail: '比例随订单锁定，业务账本计算' },
  { value: '1', unit: 'USDC', title: '伙伴到账', detail: '合约出款，核对后回写账本', href: `${explorer}/tx/${outgoing}` },
];
const roadmap = [
  ['01', '已验证 · Fuji 测试网', '把佣金，付到伙伴手中。', '从钱包绑定、订单收款到自动返佣，每笔结算关联业务记录与链上凭证。', 'x402 测试收款 / 佣金结算 / 异常恢复'],
  ['02', '下一步', '让更多项目接得上。', '整理商家接入文档与适配器，让不同支付方式产生的合格订单进入同一套结算流程。', '支付来源适配 / 接入文档 / 独立商家试点'],
  ['03', '规划中', '让确认的收益，更有保障。', '探索有资金支持的佣金锁定与领取条件。服务停机时，伙伴也能按规则领取已确认收益。', '资金预留 / 规则约束 / 自主领取'],
  ['04', '规划中', '从测试走向真实业务。', '验证生产订单、退款与结算规则，完善资金限额、监控和密钥管理，再进行主网上线验收。', '真实订单 / 退款处理 / 主网验收'],
];

export default function Progress() {
  const root = useRef(null);
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    document.title = '产品进展 · 伙伴中心';
    const observer = new IntersectionObserver((entries) => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    root.current.querySelectorAll('.progress-reveal').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return <div className='global-home-page progress-page' ref={root}>
    <GlobalPublicHeader pathname='/progress' />
    <main>
      <section className='progress-intro progress-shell'>
        <div className='progress-eyebrow'>伙伴中心 / 产品进展</div>
        <h1>从一笔到账，<br /><span>到每一次合作。</span></h1>
        <div className='progress-intro-bottom'><p>Fuji 测试网收款与返佣，已跑通。<br />下一步：接入更多项目，保障伙伴收益。</p><a href='#verified'>查看已验证成果 ↓</a></div>
      </section>
      <section className='progress-proof' id='verified'>
        <div className='progress-shell'>
          <div className='progress-section-top'><div><span className='progress-eyebrow'>已完成案例 / 2026.09.18</span><h2>一笔订单，全程有据。</h2></div><span className='progress-network'>Avalanche Fuji · 测试 USDC</span></div>
          <div className='progress-flow' key={replay}>
            {stages.map((stage, i) => <article className='progress-flow-step' key={stage.title} style={{ '--step': i }}>
              <div className='progress-flow-index'><span>0{i + 1}</span><i aria-hidden='true' /></div>
              <div className='progress-amount'>{stage.value}<small>{stage.unit}</small></div>
              <h3>{stage.title}</h3><p>{stage.detail}</p>
              {stage.href ? <a href={stage.href} target='_blank' rel='noreferrer'>查看{ i === 0 ? '收款' : '出款'}交易 ↗</a> : <span className='progress-rule'>按实际支付金额计算</span>}
            </article>)}
          </div>
          <div className='progress-proof-caption'><p>已完成案例的流程回放。收款与返佣是两笔交易，测试资金无实际价值。</p><button onClick={() => setReplay(n => n + 1)} type='button'>重播流程 ↻</button></div>
        </div>
      </section>
      <section className='progress-roadmap progress-shell'>
        <header className='progress-reveal'><span className='progress-eyebrow'>接下来，逐步兑现</span><h2>每一步，都有明确的验证目标。</h2></header>
        <div className='progress-roadmap-list'>{roadmap.map(([number, status, title, copy, tags]) => <article className='progress-roadmap-row progress-reveal' key={number}>
          <div className='progress-milestone'><span className='progress-number'>{number}</span><span className={number === '01' ? 'progress-status complete' : 'progress-status'}>{status}</span></div>
          <div><h3>{title}</h3><p>{copy}</p><span className='progress-tags'>{tags}</span></div>
        </article>)}</div>
        <aside className='progress-research progress-reveal'><span className='progress-eyebrow'>后续探索</span><p>收款与分佣的原子执行，以及真实 AI 服务的付款、交付与结算。</p></aside>
      </section>
      <section className='progress-evidence progress-shell progress-reveal'>
        <h2>成果，可以核对。</h2>
        <dl><div><dt>当前环境</dt><dd>Avalanche Fuji / Chain ID 43113</dd></div><div><dt>结算合约</dt><dd><a href={`${explorer}/address/0x5c905e43e0BB381534530d5e05DF56ab1f420899`} target='_blank' rel='noreferrer'>0x5c905e43e0BB381534530d5e05DF56ab1f420899 ↗</a></dd></div><div><dt>当前范围</dt><dd>单商家测试环境，尚未接入生产订单或主网资金。</dd></div></dl>
        <p>业务账本确认佣金，合约执行付款，结算服务核对到账。当前合约不独立判断推广归因或计算返佣比例。</p>
      </section>
      <section className='progress-contact progress-shell progress-reveal'><span className='progress-eyebrow'>与 BF Labs 一起验证</span><h2>下一笔合作，<br />可以从你的项目开始。</h2><p>我们正在寻找愿意参与接入验证的项目方，<br />也欢迎对结算机制与资金保障提出建议。</p><a href='mailto:hello@bflabs.cn'>联系 BF Labs ↗</a></section>
    </main><GlobalPublicFooter />
  </div>;
}
