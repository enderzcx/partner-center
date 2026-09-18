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

- Fuji 合约部署、实际测试 USDC 转账及回写未运行，缺少测试钱包与签名配置；未使用主网。
- MySQL/PostgreSQL 未跑运行测试，适配使用可移植 GORM，但不能据此称为三库实测通过。
- 页面是回环地址上的单商家/单推广者测试工作区。公网身份认证、真正角色隔离、生产密钥托管与多商户不在这次本地验收结论内。
- Ganache 在当前 Bun/macOS 使用 JS 回退，原生扩展提示不影响已完成测试。
- 原型阶段测试数据库不提供旧开发快照迁移承诺；保持链、来源 fixture 和服务账本配套。运行说明为新安装路径，保留旧快照用于核验，不自动改写旧资金记录。

## 交付与清理

Grok 临时工作树已移除，原作者分支保留作为本地审阅引用，任务回执归档在 `.local/grok-receipts/`。独立应用工作目录和 BeefAPI 适配工作树保留为交付物。实际 BeefAPI fixture 已停止；本地链和独立应用的 fixture 预览继续运行，演示参数为成熟期0、扫描1秒。全部提交仅在本地，无远端推送。
