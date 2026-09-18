# 本地验收 · 2026-09-18

**已完成本地原型验收；未部署 Fuji、未公开发布、未接触生产余额。**

## 证据

| 范围 | 命令/方式 | 结果 |
|---|---|---|
| 独立应用 | `bun run typecheck` | 通过 |
| 资金、来源、权限、进程锁、真实本地 EVM | `bun test` | 40 pass，0 fail，224 assertions |
| 真实 BeefAPI 模型/控制器 | `go test ./model ./controller -run '^TestSettlement' -count=1` | 两包通过；SQLite 实测 |
| BeefAPI 仓库约束 | `bash scripts/ci/repo-governance-contract.sh` | OK |
| 独立合成佣金 → 本地 EVM | `bun scripts/verify-live.ts`，fixture 模式 | 10 单位到账、回写完成；重复检查不多付 |
| BeefAPI 冻结 → 服务 → 本地 EVM → BeefAPI 回写 | 同一脚本，beefapi 模式 | 10 单位到账、pending 归零、已提现增加；普通路径由定时器运行，未手动触发出款 |
| 浏览器 | Ego，1440px / 390px / 375px | 商家、推广者、回执正常；无横向溢出 |
| Fuji RPC | `bun scripts/fuji-preflight.ts` | 只读 chainId=43113，官方测试 USDC decimals=6，区块58454259；finalized接口也已确认可读取 |

完整 E2E 回执：[fixture](evidence/fixture-e2e.json)、[BeefAPI](evidence/beefapi-e2e.json)。这些交易哈希属于本地 EVM，不能放到 Fuji 浏览器冒充测试网证据。

## 回归与修正

Grok 初版自身 23 项测试通过，主会话另行复现并保留失败测试：小额累计、部分消费后的剩余收益、来源游标在导入前推进造成漏单、自动出款依赖错误本地开关、已到账但响应丢失后暂停重启不能确认。另确认 HTTP404 回写被接受、文件心跳锁竞争及错误信息边界问题。

Grok 修复后主会话重跑 38 项全部通过。主会话再修复大额聚合超过单笔上限、来源分页不推进和启动/关闭顺序，最终 40 项通过。没有把回归期待改成旧实现行为。

真实 EVM 验收还覆盖：广播实际成功但响应抛错，随后 RPC 不可读，进程重启且暂停，链上确认后来源回写仍失败，再恢复来源回写。最终只有一次代币转移、相同交易哈希和一次已提现记账。

网页只展示 API 数据；修复了空余额误显示零、刷新重建按钮打断点击，以及回执窄屏长地址换行。来源模式隐藏不影响来源地址的本地钱包编辑，避免误导使用者。

## 协作者与提交

- BeefAPI 基线 `ae1b6fb224`；适配提交 `e5f5651bdc`，保留在 `codex/fuji-settlement`，未推送。
- Grok Companion full 开发任务 `20260918-112414-delegate-58392126`，修复任务 `20260918-114837-continue-87ed8170`。
- Grok 作者提交 `f8eb8e1`、`4cadbc3`；主会话整合为 `8bb9c6a`、`6e5f969`，主会话验收测试提交 `0fd6970`。
- 原生 bounded workers完成合约、UI、BeefAPI 适配，主会话独立读代码并重跑真实链/HTTP验证。Grok 报告不作为完成依据。
- Structural review：主会话基于固定提交、失败探针和修复后测试完成；资金来源仍由 BeefAPI 拥有，独立服务只保存执行状态；fixture ledger 为明确标记的隔离测试来源。没有引入另一个生产余额来源。

## 剩余边界

- 原本地验收阶段未运行 Fuji；后续已获单笔授权并完成真实 Fuji 部署、1 测试 USDC 付款及测试来源回写，见文末凭证。未使用主网。
- MySQL/PostgreSQL 未跑运行测试，适配使用可移植 GORM，但不能据此称为三库实测通过。
- 页面是回环地址上的单商家/单推广者测试工作区。公网身份认证、真正角色隔离、生产密钥托管与多商户不在这次本地验收结论内。
- Ganache 在当前 Bun/macOS 使用 JS 回退，原生扩展提示不影响已完成测试。
- 原型阶段测试数据库不提供旧开发快照迁移承诺；保持链、来源 fixture 和服务账本配套。运行说明为新安装路径，保留旧快照用于核验，不自动改写旧资金记录。

## 交付与清理

Grok 临时工作树已移除，原作者分支保留作为本地审阅引用，任务回执归档在 `.local/grok-receipts/`。独立应用工作目录和 BeefAPI 适配工作树保留为交付物。实际 BeefAPI fixture 已停止；本地链和独立应用的 fixture 预览继续运行，演示参数为成熟期0、扫描1秒。全部提交仅在本地，无远端推送。

## 2026-09-18 返佣比例补齐

- 独立应用提交 `880e365`；BeefAPI 测试适配提交 `f3938d3bd6`。当前比例复用 global affiliate resolver，默认/个人覆盖/明确零值均保留，不重算冻结金额。
- 主会话复核 `bun run verify`：46 pass / 0 fail / 382 assertions；TypeScript、浏览器脚本语法通过。Go `go test ./model ./controller -run '^TestSettlement' -count=1` 和 repo governance 通过。
- 真实本地 Go HTTP fixture 返回 `commission_rate: "0.1"`, `commission_rate_source: "default"`。该 fixture 使用临时测试库，不代表线上政策或余额。
- 演示页面 1440/390/320px 已验收，比例显示 10% 并标注演示规则，无横向溢出。截图在 `.local/commission-*.png`。
- Fuji 只读预检：chain 43113，出款公开地址 `0x28172e0d973fFf24651B6Ed4cA6d1007bc168C94`，用户指定收款地址 `0x831C5C93a221D8508ad4808C2A64D58B15f77c85`。测试 AVAX/USDC 均为零；Settlement 部署估算 646680 gas（仅当次估值）。无签名广播、部署或转账。私钥未打印、复制、提交或交给 Grok。公开预检记录在 `.local/fuji-preflight.json`。
- Go → 独立服务 `/api/state` → 浏览器联调通过：`source=beefapi`, `scope=global`, `rate=0.1`, `rateSource=default`；320px 商家和我的收益视图均显示 10%。联调服务及临时 Go fixture 已停止，演示预览恢复到 4311。

## 2026-09-18 Fuji 已授权单笔实测

Ender 明确授权后，真实部署 Settlement、充值 1 测试 USDC，使用现有结算 worker 的自动调度完成 BeefAPI 临时测试库中的冻结单。收款地址余额 0 → 1 USDC；来源记录 completed、withdrawal_id=1、pending=0、paid=1000000。重复执行两次 worker tick 没有重复出款。最终 RPC 读回再次核对 receipt success、finalized block、合约 paid 标记及收款余额。

公开凭证见 [Fuji 验收记录](evidence/fuji-acceptance-2026-09-18.json)。此次使用真实 Fuji 网络及测试代币，不是生产 BeefAPI 余额验证。临时来源服务和 Fuji worker 验收后停止；现有 4311 演示预览仍连接本地测试链。执行私钥仍仅从用户指定文件在内存中读取；未进入版本库或前端。

## 2026-09-18 订单驱动本地闭环

- Go 作者提交 `6a52be92af`，整合 `b05e3b1b79`；订单台作者提交 `407b790`，整合 `b3c5fa5`。主会话拥有启动器、真实接口联调、恢复修复和浏览器验收。仅本地提交，无推送/上线。
- Go 主会话执行 `go test ./model ./controller -run 'TestSettlement|TestApplyStripePaymentEvent|TestCreateGlobalPaymentOrder|TestAffiliate' -count=1` 通过；controller fixture 重新编译，repo governance 通过。
- 独立服务 `bun run verify`：63 pass、0 fail、480 assertions；脚本语法通过。测试包括下单锁比例、0比例、签名绑定、失败后改钱包不改原单、并发重试、已完成结算单重放、创建请求编号保留。
- 真实 Go HTTP + 本地 EVM：从零佣金开始，10 USD 测试订单在现有支付完成/返佣代码中产生1 USDC，定时器自动出款并回写来源。首次独立联调抓到 completed 重放被 reserved-only 解析器拒绝的问题，已修复；没有重复付款。后续重放创建、重放付款和重复执行均通过。凭证 `docs/evidence/order-demo-local.json`。
- 中断场景：在创建订单后仅完成来源模拟支付，尚未冻结，停止并重新启动配套服务；页面出现“继续结算”，点击后仅支付一次。此前已完成订单及交易哈希保持不变。凭证 `docs/evidence/order-demo-recovery.json`。这是本地阶段边界故障模拟，不声称已做操作系统崩溃或 Fuji 故障演练。
- 浏览器1440/390/320px无横向溢出，已到账状态与API一致；轮询后订单DOM节点保持不变，避免替换按钮。截图 `.local/order-demo-*.png`。同账本第二启动器被进程锁拒绝，原服务仍HTTP200。
- 独立 Grok UI审查 `20260918-152430-review-3bf4a062` 的四项发现已逐项复核修复：已付款未冻结恢复入口、completed重放、轮询DOM替换、创建请求重试编号。没有采纳把“已记入佣金”误写为“未记入”的建议文案。
- 当前演示入口 `http://127.0.0.1:4314`，配套持久测试库在 `.local/orders-local/`；旧4311演示已停止以避免同一本地执行钱包并发签名。此轮没有新增 Fuji 转账。新的 Fuji 订单流程仍需明确单笔授权及收款钱包持有人在页面签名；此前Fuji单笔实测凭证保留，不替代本轮验证。
