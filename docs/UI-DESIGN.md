# 结算台 UI

独立产品名仍是「结算台」，不是 BeefAPI 控制台。视觉对齐海外站 global console，不是另一套暖色或通用后台。

## 参照

只读源（与 `origin/codex-enhance` `18005f3013` 一致）：

- `web/src/styles/global-site.css`
- `web/src/pages/GlobalConsole/global-console.css`
- `web/src/pages/GlobalConsole/GlobalInvitation.jsx`
- `web/src/pages/GlobalConsole/invitation.css`

路径在 BeefAPI 工作树 `/Volumes/ExternalWork/Worktrees/beefapi/fuji-settlement/`。旧的暖白/橙色记忆作废。

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

## TTU：已删的页面用语

页面不再出现：本机隔离网络、Chain ID（页头）、独立结算演示、测试身份切换、仅用于本地演示、回写原账本、已预留、待记账、已回写、SETTLEMENT / OVERVIEW、每笔收益有据可查、收益到账清楚可见、01/02 装饰。

保留一处资金说明：`测试环境 · 资金无实际价值`。网络只写 `Fuji 测试网` / `测试网络`。链、代币、完整地址放在回执里。

## 本包未做的验证

字体文件和 `/fonts/` 静态放行由父任务处理。浏览器 320 / 375 / 390 / 1440 实机检查由父任务做。本包不声称截图或浏览器通过。
