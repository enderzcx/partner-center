import React, { useEffect, useState } from 'react';
import './lab.css';
const nodes = [
  ['创建订单','10 USD · 比例锁定 10%','01'],
  ['钱包付款','x402 · 10 测试 USDC','02'],
  ['确认佣金','业务账本 · 1 测试 USDC','03'],
  ['伙伴到账','链上出款 · 账本完成','04'],
  ['锁定权益','合约升级 · 本地开发中','05'],
  ['自主领取','下一阶段 · 待接入验证','06'],
  ['更多商家','后续规划 · 生产验收','07'],
];
const variants = {rail:['A / 光轨','一条光轨，串起每笔到账。'],circuit:['B / 回路','让付款的每一步，都有回响。'],pulse:['C / 脉冲','从一次付款，到伙伴到账。']};
const incoming='https://testnet.avascan.info/tx/0xd0df9f773a5d033e4ee0475a47cf48f54c653b778077662555e6c531d45104c6';
const outgoing='https://testnet.avascan.info/tx/0x6f9843b7c2d14211c07ef6d539a625cd4c8b1c962426b49ada6b15ac8fdea23d';
export default function ProgressLab({preview=true}){
 const initial=new URLSearchParams(location.search).get('variant');
 const [variant,setVariant]=useState(preview ? (variants[initial]?initial:'rail') : 'pulse');
 const [running,setRunning]=useState(true);
 useEffect(()=>{document.title=preview?'进度动效方案 · 伙伴中心':'产品进展 · 伙伴中心';},[preview]);
 function choose(key){setVariant(key);history.replaceState(null,'',`?variant=${key}`);}
 return <main className={`chain-lab chain-${variant} ${running?'':'chain-paused'}`}>
  <header className='chain-top'><a href='/'>伙伴中心 <span>BF Labs</span></a><a href={preview?'/progress':'/docs'}>{preview?'查看产品进展 ↗':'使用说明 ↗'}</a></header>
  <div className='chain-controls' aria-label='动效方案'>{preview ? <div role='group' aria-label='选择方案'>{Object.entries(variants).map(([key,[name]])=><button key={key} aria-pressed={variant===key} onClick={()=>choose(key)}>{name}</button>)}</div> : <span className='chain-version'>产品进展 / Avalanche Fuji</span>}<button className='chain-toggle' onClick={()=>setRunning(!running)}>{running?'暂停动效':'播放动效'}</button></div>
  <section className='chain-story'><p className='chain-kicker'>BUILDING PARTNER CENTER / 产品进展</p><h1>{variants[variant][1]}</h1><p className='chain-intro'>每一步，都能核对到账。<br/>下一步，让伙伴收益更有保障。</p><div className='chain-legend'><span><i/>已验证 · Fuji</span><span><i/>开发与规划</span></div></section>
  <section className='chain-map' aria-label='付款到佣金到账及后续开发链路' key={variant}>
    <svg className='chain-wires' viewBox='0 0 1000 450' preserveAspectRatio='none' aria-hidden='true'>
      <path className='wire-dim' d={variant==='circuit'?'M70 100 H970 V340 H70':'M60 200 H940'}/>
      <path className='wire-lit' d={variant==='circuit'?'M70 100 H820':'M60 200 H500'}/>
    </svg>
    <div className='chain-beam' aria-hidden='true'/>
    <ol>{nodes.map(([name,detail,number],i)=><li key={number} className={i<4?'chain-node is-done':'chain-node is-next'} style={{'--i':i}}>
      <div className='chain-junction' aria-hidden='true'><span/></div><span className='chain-step'>{number} / {i<4?'已验证':i===4?'开发中':'待验证'}</span><h2>{name}</h2><p>{detail}</p>{i===1&&<a href={incoming} target='_blank' rel='noreferrer'>收款凭证 ↗</a>}{i===3&&<a href={outgoing} target='_blank' rel='noreferrer'>到账凭证 ↗</a>}
    </li>)}</ol>
  </section>
  <footer className='chain-caption'><div><span>已完成案例 · 2026.09.18</span><p>10 测试 USDC 收款 → 10% 佣金 → 1 测试 USDC 到账</p></div><p>动画为历史流程示意，不发起付款。<br/>Avalanche Fuji 测试资金无实际价值。</p></footer>
  {!preview && <section className='chain-about'><div><h2>成果，可以核对。</h2><p>当前为单商家测试环境，尚未接入生产订单或主网资金。业务账本确认佣金，合约执行付款，结算服务核对到账。</p><a href='https://testnet.avascan.info/address/0x5c905e43e0BB381534530d5e05DF56ab1f420899' target='_blank' rel='noreferrer'>查看当前 Fuji 结算合约 ↗</a></div><div><h2>一起验证下一步。</h2><p>我们正在寻找愿意参与接入验证的项目方，也欢迎对结算机制与资金保障提出建议。</p><a href='mailto:hello@bflabs.cn'>联系 BF Labs ↗</a><a href='https://github.com/enderzcx/partner-center' target='_blank' rel='noreferrer'>查看开源代码 ↗</a></div></section>}
 </main>
}
