import React, { useEffect, useState } from 'react';
import './lab.css';
import { fujiExplorerTx } from '../../helpers/format';
const nodes = [
  ['创建订单','10 USD · 比例锁定 10%','01'],
  ['钱包付款','x402 · 10 测试 USDC','02'],
  ['确认佣金','业务账本 · 1 测试 USDC','03'],
  ['伙伴到账','链上出款 · 账本完成','04'],
  ['锁定权益','本地已验证 · 待接入 Fuji','05'],
  ['自主领取','下一阶段 · 待接入验证','06'],
  ['更多商家','后续规划 · 生产验收','07'],
];
const roadmap = [
 ['佣金权利', '本地已验证', '固定受益人、金额和领取时间，预留已确认佣金的资金。尚未部署 Fuji。'],
 ['到期领取', '下一步验证', '接入 Fuji 与执行器，验证服务停机后仍可触发领取，款项只付给原受益人。'],
 ['更多产品接入', '后续规划', '验证第二个业务与独立商家。统一合作入口，按产品保留订单、规则与收益依据。'],
 ['Avalanche 互通', '研究规划', '通过 ICM／ICTT 验证跨 L1 业务与佣金资金接入，分别核对资金到达与权利登记。'],
 ['专用结算 L1', '按需求评估', '依据实际结算规模、成本与安全要求决定是否建设。商家自部署不要求自建链。'],
];
const variants = {rail:['A / 光轨','一条光轨，串起每笔到账。'],circuit:['B / 回路','让付款的每一步，都有回响。'],pulse:['C / 脉冲','从一次付款，到伙伴到账。']};
const incoming=fujiExplorerTx('0xd0df9f773a5d033e4ee0475a47cf48f54c653b778077662555e6c531d45104c6') + '#logs';
const outgoing=fujiExplorerTx('0x6f9843b7c2d14211c07ef6d539a625cd4c8b1c962426b49ada6b15ac8fdea23d');
export default function ProgressLab({preview=true}){
 const initial=new URLSearchParams(location.search).get('variant');
 const [variant,setVariant]=useState(preview ? (variants[initial]?initial:'rail') : 'pulse');
 const [running,setRunning]=useState(true);
 useEffect(()=>{document.title=preview?'进度动效方案 · 伙伴中心':'产品进展 · 伙伴中心';},[preview]);
 function choose(key){setVariant(key);history.replaceState(null,'',`?variant=${key}`);}
 return <main className={`chain-lab chain-${variant} ${preview?'':'chain-public'} ${running?'':'chain-paused'}`}>
  <header className='chain-top'><a href='/'>伙伴中心 <span>BF Labs</span></a><a href={preview?'/progress':'/docs'}>{preview?'查看产品进展 ↗':'使用说明 ↗'}</a></header>
  <div className='chain-controls' aria-label='动效方案'>{preview ? <div role='group' aria-label='选择方案'>{Object.entries(variants).map(([key,[name]])=><button key={key} aria-pressed={variant===key} onClick={()=>choose(key)}>{name}</button>)}</div> : <span className='chain-version'>产品进展 / Avalanche Fuji</span>}<button className='chain-toggle' onClick={()=>setRunning(!running)}>{running?'暂停动效':'播放动效'}</button></div>
  <section className='chain-story'><p className='chain-kicker'>BUILDING PARTNER CENTER / 产品进展</p><h1>{variants[variant][1]}</h1><p className='chain-intro'>商家确认佣金，伙伴核对到账。<br/>下一步，让佣金有资金保障。</p><div className='chain-legend'><span><i/>已验证 · Fuji</span><span><i/>开发与规划</span></div></section>
  <section className='chain-map' aria-label={preview?'付款到佣金到账及后续开发链路':'已验证的 Fuji 付款与返佣链路'} key={variant}>
    <svg className='chain-wires' viewBox='0 0 1000 450' preserveAspectRatio='none' aria-hidden='true'>
      <path className='wire-dim' d={variant==='circuit'?'M70 100 H970 V340 H70':'M60 200 H940'}/>
      <path className='wire-lit' d={variant==='circuit'?'M70 100 H820':'M60 200 H500'}/>
    </svg>
    <div className='chain-beam' aria-hidden='true'/>
    <ol>{(preview?nodes:nodes.slice(0,4)).map(([name,detail,number],i)=><li key={number} className={i<4?'chain-node is-done':'chain-node is-next'} style={{'--i':i}}>
      <div className='chain-junction' aria-hidden='true'><span/></div><span className='chain-step'>{number} / {i<4?'已验证':i===4?'本地验证':'待验证'}</span><h2>{name}</h2><p>{detail}</p>{i===1&&<a href={incoming} target='_blank' rel='noreferrer'>10 USDC 转账日志 ↗</a>}{i===3&&<a href={outgoing} target='_blank' rel='noreferrer'>到账凭证 ↗</a>}
    </li>)}</ol>
  </section>
  <footer className='chain-caption'><div><span>已完成案例 · 2026.09.18</span><p>10 测试 USDC 收款 → 10% 佣金 → 1 测试 USDC 到账</p></div><p>动画为历史流程示意，不发起付款。<br/>Avalanche Fuji 测试资金无实际价值。</p></footer>
  {!preview && <section className='chain-roadmap' aria-labelledby='roadmap-title'>
    <div className='chain-roadmap-heading'><p className='chain-kicker'>DEVELOPMENT / 开发路线</p><h2 id='roadmap-title'>让已确认的佣金，<br/>有资金保障。</h2><p>从单链权利验证开始，逐步接入更多业务。<br/>以下能力尚未进入当前 Fuji 付款流程。</p></div>
    <ol>{roadmap.map(([title,status,detail],i)=><li key={title}><span className='chain-step'>{String(i+1).padStart(2,'0')} / {status}</span><h3>{title}</h3><p>{detail}</p></li>)}</ol>
    <div className='chain-roadmap-note'><h3>Agent 也能参与合作</h3><p>计划通过 MCP，让商家和伙伴自己的 Agent 查询收益、规则与回执，获取推广资料并辅助准备内容。发布需经授权，实际效果以业务数据核验。</p></div>
  </section>}
  {!preview && <section className='chain-about'><div><h2>成果，可以核对。</h2><p>10 测试 USDC 进入 Settlement 合约，业务系统按锁定的 10% 确认佣金，同一合约付出 1 测试 USDC，再回写账本。收款与返佣是两笔交易。当前为单商家测试环境。</p><a href='https://testnet.avascan.info/blockchain/c/address/0x5c905e43e0BB381534530d5e05DF56ab1f420899' target='_blank' rel='noreferrer'>查看当前 Fuji 结算合约 ↗</a></div><div><h2>商家自己的伙伴中心。</h2><p>我们正在建设可自主部署、连接已有业务的伙伴中心，逐步支持旗下多个产品。欢迎参与业务接入、Fuji 权利验证和合约安全评估。</p><a href='/demo'>查看演示 ↗</a><a href='mailto:hello@bflabs.cn'>联系 BF Labs ↗</a><a href='https://github.com/enderzcx/partner-center' target='_blank' rel='noreferrer'>查看开源代码 ↗</a></div></section>}
 </main>
}
