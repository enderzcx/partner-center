# 海外站前端迁入伙伴中心

上游：BeefAPI `origin/codex-enhance` `d8a3f6d1fdb8df8c238ce723b561dca60f6bf315` 的完整 `web/`。
本仓库基线：`9c575c8`。

做法：先整棵拷入，再删国内/管理/模型/充值/试用/对话等无关部分，把留下的海外站页面改成独立伙伴中心。不是另做一套简化 HTML。

产品名：伙伴中心，BF Labs。BeefAPI 是当前第一个接入来源。用户可见文案为中文。

## 路由

| 路径 | 来源 | 现在做什么 |
| --- | --- | --- |
| `/` | `pages/GlobalHome` | 海外首页结构：hero / 回执 / 规则 / 价格栏 / 控制台预览 / 收尾。文案改成佣金与结算。 |
| `/login` | `components/auth/GlobalAuthFrame` + 登录表单 | 海外站登录布局。只保留账号密码。无注册、找回、OAuth。 |
| `/console` | `pages/GlobalConsole` | 商家：结算总览、暂停/恢复、立即检查。推广者：收益总览。 |
| `/console/orders` | 新页面，沿用 console 工作台 | 商家测试订单。x402 走 `public/app.js` 的 `createX402Pay`。 |
| `/console/settlements` | `GlobalInvitation` 的记录/回执视觉 | 结算记录和回执。 |
| `/console/wallet` | `GlobalInvitation` 的比例/地址视觉 | 推广者绑定收款钱包。 |
| `/docs` | 新说明页，套公共页头页脚 | 如实说明登录、角色、返佣和资金。 |

未登录访问 `/console*` 会到 `/login`。角色不符会回到 `/console`。权限只看服务端 session / `/api/state`，不用 localStorage 提权。

## 保留并沿用的上游文件

视觉与结构以这些文件为准：

- `web/src/pages/GlobalHome/global-home.css`
- `web/src/pages/GlobalHome/index.jsx`（结构保留，文案与数据改成佣金）
- `web/src/styles/global-site.css`（补了自托管 `@font-face` 和 CJK 回退）
- `web/src/pages/GlobalConsole/global-console.css`
- `web/src/pages/GlobalConsole/invitation.css`
- `web/src/components/layout/GlobalPublicHeader.jsx` + `.css`
- `web/src/components/layout/GlobalPublicFooter.jsx` + `.css`
- `web/src/components/layout/PageLayout.jsx`（去掉国内顶栏、公告、问卷、客服）
- `web/src/components/layout/SiderBar.jsx`（海外侧栏视觉，导航改成伙伴中心）
- `web/src/components/auth/GlobalAuthFrame.jsx`
- `web/src/components/common/logo/GlobalBrandMark.jsx`
- `web/src/hooks/common/useIsMobile.js`
- `web/src/hooks/common/useSidebarCollapsed.js`
- `web/public/global/console-preview.png` 及品牌图标
- `web/public/fonts/schibsted-latin.woff2`、`geist-mono-latin.woff2`（从仓库 `public/fonts/` 拷入）

QuantumNous / new-api 版权头保留。`UPSTREAM-LICENSE` 为 AGPLv3 原文。

## 适配后的新接线

这些文件接现有结算 API，不改 `public/app.js` 协议：

- `web/src/context/Partner.jsx`：session / login / logout / 序列化刷新 / generation
- `web/src/helpers/api.js`、`x402.js`、`format.js`、`source-support.js`、`routes.jsx`
- `web/src/pages/GlobalConsole/Orders.jsx`、`Settlements.jsx`、`Wallet.jsx`、`workspace.jsx`、`order-view.js`
- `web/src/pages/Docs/index.jsx`
- `web/src/styles/partner-chrome.css`：把原先写在 JSX `style=` 里的布局挪到 CSS，并补订单/回执/说明

x402 通过 Vite alias `@settlement/app` 引用仓库 `public/app.js` 的 `createX402Pay`。React 树里没有 `#app-shell`，旧 `bindUi()` 不会启动。付款签名缓存在稳定的 `Map` 实例里。

## 删除的上游面

从拷入的 973 个文件里去掉国内站、管理后台、模型、密钥、定价、充值、试用、用量、聊天/操练场、企业站、Playwright、i18n、GEO 文档和相关依赖。主要包括：

- `pages/Home`、`Channel`、`Setting`、`Business`、`User`、`Token`、`TopUp`、`Pricing`、`Playground`、`Chat*`、`OnlineExperience`、`Enterprise`、`Model*`、`Redemption`、`RiskControl`、`Subscription`、`Task`、`Log`、`Setup`
- `pages/GlobalConsole` 中的 ApiKeys / Usage / Pricing / TopUp / Trial / Status / Docs / Connect / FirstRequest
- `components/table`、`playground`、`settings`、`topup`、`campaign`、`onboarding`
- `e2e/`、`playwright*.js`、`i18next.config.js`、`tailwind.config.js`
- 国内字体链路、Google Fonts 内联脚本、模型文档与 mockup 静态资源

依赖按留下的海外组件收缩：React 18、react-router 7.18.0、Vite 5.4.21、Semi 2.72.2、lucide-react、gsap、boring-avatars、react-icons。已重新生成 `web/bun.lock`。

## 前端如何调用现有 API

| 动作 | 接口 | 谁能用 |
| --- | --- | --- |
| 读登录态 | `GET /api/auth/session` | 公开 |
| 登录/退出 | `POST /api/auth/login`、`/api/auth/logout` | cookie，same-origin |
| 读状态 | `GET /api/state` | 已登录 |
| 暂停/恢复、立即检查 | `POST /api/admin/pause`、`/api/admin/run` | 商家 |
| 创建/确认测试订单 | `POST /api/demo/orders`、`/api/demo/orders/:id/pay` | 商家，且来源打开订单演示 |
| x402 支付 | `POST /api/x402/orders/:id/pay` | 商家；签名只在用户点击后 |
| 绑定钱包 | `POST /api/partner/wallet/challenge`、`/verify` | 推广者；`personal_sign` 只在点击后 |
| 自动结算 / 划转 / 测试收益 | `/api/partner/auto`、`/api/partner/transfer`、`/api/demo/commission` | 仅 `source=fixture` 且服务端未开 auth 时展示。auth 开启时这些接口会 403，页面不画入口 |

轮询 3 秒一次，同一 generation 不并行。过期 401 且 generation 未变才清登录态。退出会清 state、角色和 x402 缓存。

开发代理只指向 `http://127.0.0.1:4322`，Vite 端口 `4321`。生产接口同源，包里不写后端地址。构建产物 `web/dist`（已 gitignore）。无内联脚本。

## 验证

已在本边界内完成：

- `cd web && bun install`
- `cd web && bun test`：7 pass
- `cd web && bun run build`：写出 `web/dist`，外部 JS/CSS，字体在 `/fonts`

未做、也不声称：浏览器对照海外站截图、资金验收、部署。

## 空隙

- `/global/console-preview.png` 仍是上游海外控制台截图，首页用来保持原构图，不是本仓库运行时画面。
- 海外顶栏在 820px 以下隐藏文字导航，只留品牌和「进入控制台」。这是上游行为。页脚仍有「说明」「登录」。
- Semi 体积仍大，因为登录表单和侧栏要沿用海外站组件。
- 未实现注册、找回密码、OAuth。`/register`、`/reset` 转到 `/login`。
