# 订单驱动演示

本轮演示从零佣金开始：邀请关系 → 测试订单 → 模拟支付成功 → BeefAPI 原有逻辑计算佣金 → 签名绑定的钱包 → 冻结结算 → 自动出款 → 回执。支付成功是隔离测试事件，不代表 Stripe 或其他收款渠道收到了钱。

默认订单实付 10 USD，海外默认返佣 10%，产生 1 USDC 测试佣金。订单采用创建时的比例，界面的当前比例不是重算历史订单的依据。

## 启动

在隔离 BeefAPI 工作树编译测试来源：

```sh
cd /Volumes/ExternalWork/Worktrees/beefapi/fuji-settlement
go test -c ./controller -o /Volumes/ExternalWork/Worktrees/settlement/fuji-demo/.local/beefapi-fixture.test
```

已有本地链启动后，在独立项目运行：

```sh
bun scripts/order-demo.ts
```

页面为 `http://127.0.0.1:4314`。来源和结算数据库保存在 `.local/orders-local/`，共同保留才能恢复订单和出款状态。停止启动器时会同时停止来源和执行器；重启不重新预置收益。签名绑定钱包后创建订单并模拟支付，结算由后台调度执行。

本地真实 EVM/HTTP 验证：

```sh
bun scripts/verify-order-demo.ts
```

该脚本只允许链 31337，并使用公开本地测试钱包完成签名；绝不对 Fuji 执行。

## Fuji

Fuji 使用既有 Settlement 合约和单独的 `.local/orders-fuji/` 账本。只有明确授权新的测试付款之后才执行以下启动命令，并在浏览器由钱包所有者签名绑定收款钱包：

```sh
FUJI_KEY_FILE=/Users/sunny/Work/CC/beefapi/.env bun scripts/order-demo.ts --fuji
```

只在内存读取指定文件的 `fuji_test_private_key` 字段，不载入整份环境配置，不打印或复制私钥。该启动器不部署合约、不自动向合约充值。此前的单笔 Fuji 验收不等于本轮订单演示已在 Fuji 验收。

仍为本机单商家测试工作区，不具备公网用户认证或生产钱包托管。新付款必须遵守当前授权范围，不得把测试订单模拟付款说成实际收款。
