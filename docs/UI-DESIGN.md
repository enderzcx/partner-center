# 结算台 UI

产品名为「结算台」，设计系统复用 BeefAPI 海外站 global console。

## 参照

只读源（与 `origin/codex-enhance` `18005f3013` 一致）：

- `web/src/styles/global-site.css`
- `web/src/pages/GlobalConsole/global-console.css`
- `web/src/pages/GlobalConsole/GlobalInvitation.jsx`
- `web/src/pages/GlobalConsole/invitation.css`

路径在 BeefAPI 工作树 `/Volumes/ExternalWork/Worktrees/beefapi/fuji-settlement/`。以当前源码和线上样式为准，旧暖色记录不作本轮依据。

## 令牌

| 用途 | 值 |
| --- | --- |
| canvas | `oklch(0.958 0.004 250)` |
| paper | `oklch(0.982 0.003 255)` |
| card | `oklch(0.995 0.002 255)` |
| ink | `oklch(0.225 0.015 262)` |
| accent | `oklch(0.5 0.19 264)` |
| accent-deep | `oklch(0.42 0.17 265)` |
| soft | `oklch(0.45 0.018 258)` |
| dim | `oklch(0.6 0.014 255)` |
| line | ink 13% |
| green | `oklch(0.52 0.1 162)` |

字体：Schibsted Grotesk（400–900）+ 系统 CJK；技术标识用 Geist Mono（100–900）。自托管 `/fonts/schibsted-latin.woff2`、`/fonts/geist-mono-latin.woff2`。字号下限 11px，正文 14px，控件 13px。

## 结构

- 侧栏 238px paper；选中项浅蓝底，不是黑胶囊。
- 主栏 `max-width: 1160px`，header + 墨色主按钮 + 浅灰刷新，与 global-console 一致。
- 指标、出款、表格用细线分栏，不用成组投影卡片，没有营销大标题。
- 合成数据放在折叠的原生 `details#fixture-controls` / `#transfer-controls`，标题「演示工具」。
- 订单演示开启时，商家页增加「测试订单」分栏：默认 10 USD、待确认/已确认、锁定比例与佣金。按钮文案固定为「模拟支付成功」，并写明不会向买家扣款。推广者页显示绑定控件和钱包地址。旧 fixture 与未开启演示的 BeefAPI 视图不变。

## TTU：已删的页面用语

页面不再出现：本机隔离网络、Chain ID（页头）、独立结算演示、测试身份切换、仅用于本地演示、回写原账本、已预留、待记账、已回写、SETTLEMENT / OVERVIEW、每笔收益有据可查、收益到账清楚可见、01/02 装饰。

保留一处资金说明：`资金无实际价值`（与测试网络名称同栏）。网络只写 `Fuji 测试网` / `测试网络`。链、代币、完整地址放在回执里。

## 主会话整合与 TTU 验收

- 2026-09-18 线上 `global.beefapi.com` 读回的 canvas/accent/字体与源代码一致，四份参考文件在 `ae1b6fb224` 至 `18005f3013` 无差异。
- 本地字体资源 HTTP200、MIME font/woff2，浏览器确认 Schibsted Grotesk 与 Geist Mono 都已 loaded；原 CSP 保持 self，不新增第三方字体请求。
- 1440 / 390 / 375 / 320px 检查：没有横向溢出或越界元素；正文可见字号不低于11px。
- 手机指标沿用邀请页的首项通栏、其余分栏结构。去掉重复身份/演示说明，必要资金提示只保留一处。测试消费划转后不再参与结算的后果，放在对应操作旁。
- 320px 金额列临时放入 `999,999.999998` 做布局探针后立即恢复，修正后 scrollWidth=clientWidth=127；不截断或四舍五入金额。回执完整地址/哈希保留，弹层无水平溢出。
- 浏览器实际操作：暂停；非法金额 -1 显示邻近提示；添加1单位测试收益保持可用；恢复后自动到账，累计由10变11；两个视图切换和回执打开正常。
- `node --check public/app.js` 与 `git diff --check` 通过；新增字体静态路由后 `bun test tests/http.test.ts` 6项通过。资金逻辑没有变更。

截图保留在 `.local/overseas-ui-{1440,390,375}.png`、`.local/overseas-ui-receipt-320.png`。Grok 作者提交 `e20fd12`，主会话整合为 `77acf2d`，再做上述TTU和窄屏修正。未公开部署。
