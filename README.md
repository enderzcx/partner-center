# 结算台 · Fuji Demo

独立的佣金自动结算应用，BeefAPI 为第一个测试接入方。商家提供已确认并冻结的佣金单，服务将测试 USDC 支付给推广者，并把核验结果回写原账本。

**当前阶段：隔离本地原型，不是公网生产服务。** 当前实现与验收边界见 [合同](docs/CONTRACT.md)。真实执行结果见 [验证记录](docs/VERIFICATION.md)。

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

独立服务只接受回环地址上的 BeefAPI 测试环境。普通生产提现和钱包入口保持既有行为。适配鉴权 token 由环境配置，不出现在网页中，不写入仓库。

## Fuji 联调所需

当前只有本地部署授权。以下资料准备好并授权测试部署后才能执行 Fuji 写入：

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
