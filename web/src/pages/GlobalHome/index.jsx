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

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import GlobalPublicHeader from '../../components/layout/GlobalPublicHeader';
import GlobalPublicFooter from '../../components/layout/GlobalPublicFooter';
import './global-home.css';

gsap.registerPlugin(ScrollTrigger);

const COPY = {
  ratesUnit: '返佣怎么算',
  ratesLink: '查看使用说明',

  brandHome: '伙伴中心首页',
  brand: '伙伴中心',
  primaryNavigation: '主要导航',
  title: '伙伴中心。',
  titleSecond: '佣金按实付入账。',
  heroCopy:
    '商家查看可用收益和出款进度。推广者查看收益和到账记录。当前接入 BeefAPI。',
  getStarted: '进入控制台',
  receiptAria: '结算回执示例',
  receipt: '结算回执',
  receiptRows: [
    { model: 'BeefAPI 付款', tokens: '实付 100 USD', cost: '10.00' },
    { model: '比例锁定', tokens: '下单时确定', cost: '10%' },
    { model: '赠送与试用', tokens: '不计返佣', cost: '0.00' },
    { model: '收益转入', tokens: '不计返佣', cost: '0.00' },
    { model: '已有订单', tokens: '比例不变', cost: '10.00' },
  ],
  receiptTotalLabel: '合计 · 佣金',
  receiptTotal: '10.00 USDC',
  routerTitle: '比例在下单时锁定。',
  routerTitleSecond: '之后调整不影响已有订单。',
  routerLead: '佣金按实际支付金额计算。',
  routerLeadBreak: '赠送、试用与收益转入不计返佣。',
  routerLeadSecond: '当前比例来自接入来源。',
  routerLeadSecondBreak: '无法读取时不会显示成 10%。',
  routerAria: '返佣规则字段依次切换',
  priceTitle: '按实付计算。',
  priceTitleSecond: '不计赠送。',
  priceLead: '页面展示来源给出的现行比例。',
  priceLeadBreak: '不按展示比例重算已有结算单。',
  priceLeadSecond: '显式 0% 时不产生新返佣。',
  priceLeadSecondBreak: '已生成的付款会继续处理。',
  priceAria: '返佣计算规则',
  request: '规则',
  consoleTitle: '可用收益、结算记录和回执在同一处。',
  consoleShotAlt: '伙伴中心工作台示意，包含收益、结算记录与回执',
  finalTitle: '登录后查看',
  finalTitleSecond: '出款进度与到账记录',
  finalTitleThird: '当前接入 BeefAPI。',
};

const RATE_ROWS = [
  { name: '实际支付', price: '计入返佣', save: '' },
  { name: '赠送与试用', price: '不计返佣', save: '' },
  { name: '下单时锁定', price: '已有订单不变', save: '' },
  { name: '显式 0%', price: '不产生新返佣', save: '' },
  { name: '无法读取', price: '不回退比例', save: '' },
];

const ROUTER_FIELDS = ['actual_payment', 'order_creation', 'BeefAPI'];
const ROUTER_HOLD_MS = 1500;
const ROUTER_DELETE_MS = 26;
const ROUTER_TYPE_MS = 40;

const GlobalHomeGetStarted = ({ className = '' }) => (
  <Link
    className={['global-home-get-started', className].filter(Boolean).join(' ')}
    to='/console'
  >
    {COPY.getStarted}
  </Link>
);

const GlobalHomeRouterRequest = () => {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(ROUTER_FIELDS[0]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setInterval(() => {
        setIndex((current) => {
          const next = (current + 1) % ROUTER_FIELDS.length;
          setTyped(ROUTER_FIELDS[next]);
          return next;
        });
      }, 2000);
      return () => window.clearInterval(timer);
    }

    let timer = 0;
    let cancelled = false;
    const wait = (ms) =>
      new Promise((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    const run = async () => {
      const current = ROUTER_FIELDS[index];
      const nextIndex = (index + 1) % ROUTER_FIELDS.length;
      const next = ROUTER_FIELDS[nextIndex];
      setTyped(current);
      setEditing(false);
      await wait(ROUTER_HOLD_MS);
      if (cancelled) return;
      setEditing(true);
      for (let length = current.length; length >= 0; length -= 1) {
        if (cancelled) return;
        setTyped(current.slice(0, length));
        await wait(ROUTER_DELETE_MS);
      }
      for (let length = 1; length <= next.length; length += 1) {
        if (cancelled) return;
        setTyped(next.slice(0, length));
        await wait(ROUTER_TYPE_MS);
      }
      if (cancelled) return;
      setEditing(false);
      setIndex(nextIndex);
    };

    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [index]);

  const fieldKey =
    index === 0 ? 'basis' : index === 1 ? 'locked_at' : 'source';

  return (
    <div className='global-home-router-stage' aria-label={COPY.routerAria}>
      <div className='global-home-router-panel' role='region'>
        <div className='global-home-router-bar' aria-hidden='true'>
          <i />
          <i />
          <i />
          <span>{COPY.request}</span>
        </div>
        <pre role='group' aria-label={`返佣规则字段 ${fieldKey}`}>
          <code>
            <span className='global-home-router-dim'>{'{\n  '}</span>
            <span className='global-home-router-line'>
              <span className='global-home-router-live'>{`"${fieldKey}": "`}</span>
              <span
                className={
                  editing
                    ? 'global-home-router-slot is-editing'
                    : 'global-home-router-slot'
                }
                aria-hidden='true'
              >
                <span className='global-home-router-model'>{typed}</span>
                <span className='global-home-router-caret' aria-hidden='true' />
                <span className='global-home-router-live'>{'"'}</span>
              </span>
            </span>
            <span className='global-home-router-dim'>{'\n}'}</span>
          </code>
        </pre>
      </div>
    </div>
  );
};

const GlobalHome = () => {
  useEffect(() => {
    document.title = '伙伴中心';
    document.documentElement.lang = 'zh-CN';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    const root = document.querySelector('.global-home-page');
    if (!root) return undefined;
    const media = gsap.matchMedia();

    media.add('(min-width: 821px)', () => {
      const heroStage = root.querySelector('.global-home-product-stage');
      const receipt = root.querySelector('.global-home-receipt-object');
      if (heroStage && receipt) {
        gsap.fromTo(
          heroStage,
          { y: 42, opacity: 0 },
          { y: 0, opacity: 1, duration: 1.1, delay: 0.2, ease: 'power4.out' },
        );
        gsap.fromTo(
          receipt,
          { opacity: 0, filter: 'blur(8px)' },
          {
            opacity: 1,
            filter: 'blur(0px)',
            duration: 0.9,
            delay: 0.45,
            ease: 'power3.out',
          },
        );
        gsap.to(heroStage, {
          yPercent: -8,
          ease: 'none',
          scrollTrigger: {
            trigger: root.querySelector('.global-home-hero'),
            start: 'top top',
            end: 'bottom top',
            scrub: 1,
          },
        });
      }

      const routerPanel = root.querySelector('.global-home-router-panel');
      if (routerPanel) {
        gsap.to(routerPanel, {
          y: -24,
          rotateZ: -0.5,
          ease: 'none',
          scrollTrigger: {
            trigger: root.querySelector('#router'),
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        });
      }

      gsap.fromTo(
        gsap.utils.toArray('.global-home-rates li', root),
        { x: 42, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.65,
          stagger: 0.08,
          ease: 'power4.out',
          scrollTrigger: {
            trigger: root.querySelector('.global-home-rates'),
            start: 'top 78%',
            once: true,
          },
        },
      );

      const shotImage = root.querySelector('.global-home-shot img');
      if (shotImage) {
        gsap.fromTo(
          shotImage,
          { y: 28, scale: 1.035, clipPath: 'inset(8% 3% 8% 3% round 18px)' },
          {
            y: 0,
            scale: 1,
            clipPath: 'inset(0% 0% 0% 0% round 18px)',
            duration: 1.1,
            ease: 'power4.out',
            scrollTrigger: {
              trigger: root.querySelector('.global-home-shot'),
              start: 'top 82%',
              once: true,
            },
          },
        );
        gsap.to(shotImage, {
          yPercent: -3,
          ease: 'none',
          scrollTrigger: {
            trigger: root.querySelector('.global-home-shot'),
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        });
      }
    });

    return () => media.revert();
  }, []);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const targets = document.querySelectorAll(
      '.global-home-section-head, .global-home-router-copy, .global-home-router, .global-home-rates-copy, .global-home-rates, .global-home-shot',
    );
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    targets.forEach((target) => {
      target.classList.add('global-home-scrollfx');
      observer.observe(target);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = document.querySelector('.global-home-product-stage');
    const receipt = document.querySelector('.global-home-receipt-object');
    if (!stage || !receipt) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    let frame = 0;
    let lastTime = performance.now();
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const updateTarget = (event) => {
      const bounds = stage.getBoundingClientRect();
      target.x = Math.max(
        -1,
        Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
      );
      target.y = Math.max(
        -1,
        Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
      );
    };

    const resetTarget = () => {
      target.x = 0;
      target.y = 0;
    };

    const tick = (time) => {
      const delta = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;
      const blend = 1 - Math.exp(-9 * delta);
      current.x += (target.x - current.x) * blend;
      current.y += (target.y - current.y) * blend;
      receipt.style.setProperty('--receipt-tilt-y', `${current.x * 2.2}deg`);
      receipt.style.setProperty('--receipt-tilt-x', `${current.y * -2.4}deg`);
      receipt.style.setProperty('--receipt-tilt-z', `${current.x * 0.32}deg`);
      frame = window.requestAnimationFrame(tick);
    };

    stage.addEventListener('pointermove', updateTarget, { passive: true });
    stage.addEventListener('pointerleave', resetTarget, { passive: true });
    frame = window.requestAnimationFrame(tick);
    return () => {
      stage.removeEventListener('pointermove', updateTarget);
      stage.removeEventListener('pointerleave', resetTarget);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className='global-home-page'>
      <GlobalPublicHeader pathname='/' />

      <main id='top'>
        <section className='global-home-hero'>
          <div className='global-home-shell'>
            <h1 className='global-home-reveal global-home-delay-1'>
              {COPY.title} <br className='global-home-h1-break' />
              {COPY.titleSecond}
            </h1>
            <p className='global-home-hero-copy global-home-reveal global-home-delay-2'>
              {COPY.heroCopy}
            </p>
            <div className='global-home-actions global-home-reveal global-home-delay-3'>
              <GlobalHomeGetStarted />
            </div>

            <div
              className='global-home-product-stage global-home-reveal global-home-delay-4'
              aria-label={COPY.receiptAria}
            >
              <div className='global-home-stage-floor' />
              <div className='global-home-receipt-object'>
                <div className='global-home-receipt-shadow' />
                <div className='global-home-receipt-paper'>
                  <div className='global-home-receipt-inner'>
                    <div className='global-home-receipt-top'>
                      <span className='global-home-receipt-name'>
                        {COPY.receipt}
                      </span>
                    </div>
                    <div className='global-home-receipt-lines'>
                      {COPY.receiptRows.map((row) => (
                        <div
                          className='global-home-receipt-line'
                          key={row.model}
                        >
                          <strong>{row.model}</strong>
                          <span>{row.tokens}</span>
                          <b>{row.cost}</b>
                        </div>
                      ))}
                    </div>
                    <div className='global-home-receipt-bottom'>
                      <span>{COPY.receiptTotalLabel}</span>
                      <b className='global-home-receipt-total'>
                        {COPY.receiptTotal}
                      </b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className='global-home-section global-home-shell' id='router'>
          <div className='global-home-section-head'>
            <h2>
              {COPY.routerTitle} <br />
              {COPY.routerTitleSecond}
            </h2>
          </div>

          <div className='global-home-router-layout'>
            <div className='global-home-router-copy'>
              <p>
                {COPY.routerLead} <br />
                {COPY.routerLeadBreak}
              </p>
              <p>
                {COPY.routerLeadSecond} <br />
                {COPY.routerLeadSecondBreak}
              </p>
            </div>
            <div className='global-home-router'>
              <GlobalHomeRouterRequest />
            </div>
          </div>
        </section>

        <section className='global-home-section global-home-shell' id='rates'>
          <div className='global-home-section-head'>
            <h2>
              {COPY.priceTitle} <br />
              {COPY.priceTitleSecond}
            </h2>
          </div>

          <div className='global-home-rates-layout'>
            <div className='global-home-rates-copy'>
              <p>
                {COPY.priceLead} <br />
                {COPY.priceLeadBreak}
              </p>
              <p>
                {COPY.priceLeadSecond} <br />
                {COPY.priceLeadSecondBreak}
              </p>
            </div>
            <div className='global-home-rates'>
              <p>{COPY.ratesUnit}</p>
              <ul aria-label={COPY.priceAria}>
                {RATE_ROWS.map((row) => (
                  <li key={row.name}>
                    <span className='global-home-rates-name'>{row.name}</span>
                    <span
                      className='global-home-rates-leader'
                      aria-hidden='true'
                    />
                    <span className='global-home-rates-price'>{row.price}</span>
                    <span className='global-home-rates-save'>{row.save}</span>
                  </li>
                ))}
              </ul>
              <a href='/docs'>{COPY.ratesLink}</a>
            </div>
          </div>
        </section>

        <section className='global-home-section global-home-shell' id='console'>
          <div className='global-home-section-head'>
            <h2>{COPY.consoleTitle}</h2>
          </div>
          <figure className='global-home-shot'>
            <div className='global-home-shot-bar' aria-hidden='true'>
              <i />
              <i />
              <i />
            </div>
            <img
              src='/global/console-preview.png'
              alt={COPY.consoleShotAlt}
              loading='lazy'
              width='2360'
              height='1512'
            />
          </figure>
        </section>

        <section className='global-home-final'>
          <div className='global-home-shell'>
            <h2>
              {COPY.finalTitle} <br />
              {COPY.finalTitleSecond} <br />
              <span className='global-home-final-last'>
                {COPY.finalTitleThird}
              </span>
            </h2>
            <div className='global-home-actions'>
              <GlobalHomeGetStarted />
            </div>
          </div>
        </section>
      </main>

      <GlobalPublicFooter homeHref='#top' />
    </div>
  );
};

export default GlobalHome;
