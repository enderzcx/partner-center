# 结算台 · Fuji Demo

独立的佣金自动结算应用，BeefAPI 为第一个测试接入方。商家提供已确认并冻结的佣金单，服务将测试 USDC 支付给推广者，并把核验结果回写原账本。

**当前已验收：Avalanche Fuji 公网测试订单收款与自动返佣闭环。** 本工作树正在将完整海外站 React 前端迁入伙伴中心，迁移范围见 [前端验收合同](docs/OVERSEAS-ACCEPTANCE.md)。公网发布状态与链上证据以 [验证记录](docs/VERIFICATION.md) 为准。

## 前端构建

前端源码位于 `web/`。先执行 `cd web && bun install --frozen-lockfile && bun run build`，再运行根目录服务。服务默认提供 `web/dist`，支持明确的伙伴中心页面路径及构建资源；`SETTLEMENT_PUBLIC_DIR` 可以覆盖该目录。不要把旧 `public/index.html` 作为新版入口。现有 `public/app.js` 保留为已验证 x402 客户端的源码依赖，随 React 构建打包。

下面的本地链、来源和资金示例是原型开发说明，不代表已连接生产账本。

## 本地运行

安装 Bun，然后在本目录运行：

```sh
bun install --frozen-lockfile
bun run chain:local
```

另开终端运行：

```sh
bun run dev
```

打开 http://127.0.0.1:4311 。选择本地测试钱包，开启自动结算，在商家页创建测试佣金。正常执行由定时器推进，也可立即检查。模拟佣金不是营收；本地链代币不是 Circle USDC。测试工作区中的商家/推广者切换仅用于演示，不是账号登录和权限隔离。

状态：待结算 → 已签名 → 已广播 → 链上已确认 → 原账本已完成。服务在发送交易前保存签名交易。结果不明时只重播同一笔交易；账本回写失败时只补回写。异常任务继续保持冻结，不自动解冻或换单重付。

本地链和服务数据都保存在被 Git 忽略的 `.local/`。独占执行钱包不能被其他脚本同时使用。重置本地链时必须同步重置对应的演示账本，不能将旧账本与新链混用。

## BeefAPI 接入

BeefAPI 适配代码位于独立工作树 `codex/fuji-settlement`。它增加默认关闭、独立鉴权的测试接口。BeefAPI 原账本负责实际可用余额、冻结和已提现记录，结算服务不重复计算或复制可用佣金余额。

- `POST /api/settlement-test/reservations` 冻结 global 佣金并返回唯一单。
- `GET /api/settlement-test/reservations` 分页取单。
- `POST /api/settlement-test/reservations/:id/complete` 链上核验后完成原账本。
- `GET /api/settlement-test/partners/:id` 读取原账本余额。

测试订单演示默认关闭。仅当来源为 beefapi 且双方都显式打开时可用：来源 `SETTLEMENT_TEST_ORDER_MODE=true`，本应用 `SETTLEMENT_ORDER_DEMO=true`。此时可创建默认 10 USD 测试订单，页面用「模拟支付成功」确认，不会向买家扣款。佣金金额以来源为准，收款地址在首次确认时固定。出款仍由定时器执行，不在确认接口里上链。

- `GET /api/settlement-test/orders`
- `POST /api/settlement-test/orders`
- `POST /api/settlement-test/orders/:request_id/pay`

独立服务只接受回环地址上的 BeefAPI 测试环境。普通生产提现和钱包入口保持既有行为。适配鉴权 token 由环境配置，不出现在网页中，不写入仓库。

## Fuji 联调所需

已完成一次明确授权的 Fuji 部署及 1 测试 USDC 出款，凭证见 `docs/evidence/fuji-acceptance-2026-09-18.json`。新增付款需按当前金额和收款地址授权；订单驱动演示入口见 [ORDER-DEMO.md](docs/ORDER-DEMO.md)。以下是 Fuji 执行条件：

1. 商家管理员、专用执行钱包和推广者收款钱包的公开地址。
2. 执行钱包的测试 AVAX、出款合约的测试 USDC。
3. 私钥只放受控进程环境，不能粘贴聊天、提交 Git 或放进前端。
4. 部署并确认出款合约地址，核对管理员与执行者角色。

官方测试 USDC 固定为 `0x5425890298aed601595a70AB815c96711a31Bc65`，链 ID `43113`。引用：[Circle 合约地址](https://developers.circle.com/stablecoins/usdc-contract-addresses)。

无需私钥的只读检查：

```sh
bun scripts/fuji-preflight.ts
```

该脚本只检查网络、USDC 精度和区块；可设置 `FUJI_EXECUTOR_ADDRESS` 读取测试钱包余额。成功不代表任何合约部署、出款或最终账本验收。

## 公开部署前

本应用强制回环监听。公网身份认证、商家/推广者权限隔离、TLS 会话、多商家签名隔离、生产密钥托管和人工异常处理尚不在此次本地闭环的完成声明里。不能把本机测试身份切换页面直接发布为真实商家后台。

## 复现接入验收

先启动本地链。编译真实 BeefAPI 控制器的测试 fixture（只需首次或适配源码变化后）：

```sh
cd /Volumes/ExternalWork/Worktrees/beefapi/fuji-settlement
go test -c ./controller -o /Volumes/ExternalWork/Worktrees/settlement/fuji-demo/.local/beefapi-fixture.test
```

在本项目新终端启动 fixture：

```sh
bun scripts/beefapi-fixture.ts
```

它创建全新的临时 SQLite、100 单位测试收益和专用临时 token，运行上限 30 分钟。生成的 `.local/beefapi.env` 只供服务进程读取，并为本轮生成独立结算数据库路径。

停止占用 4311 的 fixture 模式应用后，在本项目另一终端运行：

```sh
source .local/beefapi.env
SETTLEMENT_TICK_MS=1000 bun run dev
```

执行端到端验收：

```sh
bun scripts/verify-live.ts
```

脚本自动提交一张 10 单位的测试结算单，等待定时器出款，核对本地 EVM 余额实际增量与源账本状态，然后重复触发检查确认不多付。只允许本机 31337 网络。fixture 模式也可运行同一脚本，它会绑定本地钱包并添加测试佣金。

仅监听一个服务实例；不得让其他进程共用执行私钥。不同来源使用不同账本文件，默认独占锁仍共用。服务重启后继续使用原账本、链数据库和配置；不同来源/链/代币/合约/执行地址不能复用同一账本。

常规验证：

```sh
bun run verify
```

默认演示参数为 1 USDC 最低金额、60 秒成熟期、30 秒扫描；`SETTLEMENT_MATURITY_MS=0 SETTLEMENT_TICK_MS=1000` 仅用于加速本地测试。BeefAPI 已冻结的单据按来源确认结果处理，不再次套用演示成熟期。
