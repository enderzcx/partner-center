# 验收记录 · 2026-09-18

**当前：Fuji 订单闭环及 partner.bflabs.app 受控公网演示已完成；未接入生产余额或主网。以下按阶段保留历史证据。**

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
- Go 独立审查 `20260918-152046-review-4eea4f06`：approve，无可执行发现。评审确认事务提取、订单唯一键回滚、支付事件幂等、冻结比例及双开关鉴权。限制保留：SQLite fixture 最大连接数1，多连接竞争与MySQL/PostgreSQL未做运行验证。
- Ender 已追加授权本轮现有 Fuji 合约充值1测试USDC及10USD订单产生的1测试USDC付款。Fuji订单演示页已启动在 `http://127.0.0.1:4315`，独立持久库 `.local/orders-fuji/`。已创建 pending 订单 `fuji-order-demo-20260918-001`，冻结比例0.1；当前尚未绑定收款钱包，等待持有人签名，未进行本轮充值/付款。后续执行脚本 `.local/run-fuji-order.ts` 在签名前拒绝继续，严格核对唯一订单、指定收款地址、金额、来源结算单和原签名交易 journal。
- 两个 Grok 开发/审查工作树已移除，任务回执归档在 `.local/grok-order-backend-receipts/` 和 `.local/grok-order-console-receipts/`；作者分支保留为本地审阅引用。

## 2026-09-18 Fuji 订单闭环完成

用户亲自在页面重新签名，将钱包从出款地址改绑为已授权收款地址 `0x831C5C93a221D8508ad4808C2A64D58B15f77c85`。服务端核对一致后，执行已授权的单笔充值及订单演示；未绕过钱包绑定。

订单 `fuji-order-demo-20260918-001` / `global_6c1a68e9158845c9ba37fde7345a2013`：模拟实付10USD，创建时锁定比例0.1，既有 BeefAPI 支付完成逻辑实际记入1000000 micro-USDC佣金。定时器自动冻结/付款，收款钱包余额1→2测试USDC；来源结算单completed、withdrawal_id=1、pending=0、paid=1000000。重复确认和再次执行未重复付款。

付款交易 `0x4d90fbc94781a485ff31834e98f43161e3c257b68b450771694d7c855f2f9a48`，receipt success，区块58457829已finalized。合约充值交易 `0x85ab27243343d8cb982a53c94d83a868d6db9fba6720254f064c5045f023e139`。完整公开凭证见 [Fuji订单验收](evidence/fuji-order-demo-2026-09-18.json)。此次是测试订单模拟支付、真实Fuji测试币出款，不是生产支付渠道收款验收。此前“等待签名”状态已由本节完成记录取代；当前单笔授权已执行，不可重复充值或新建付款。

浏览器读回也已确认：Fuji 测试网、累计到账1.00、订单“已到账”、回执“已完成”，收款地址与交易链接均匹配上述凭证。截图捕获遇到 CDP timeout，因此不把截图列为本次证据；实际 DOM 与 API 读回成功。


## 2026-09-18 伙伴中心公网演示

- 地址 https://partner.bflabs.app，独立目录 `/home/ubuntu/partner-demo`，独立 Nginx vhost、Docker 和成对 SQLite 账本。DNS-only A 指向已批准服务器；有效 TLS 证书到 2026-12-17。既有 beefapi.com / global.beefapi.com 上线前后均返回200。
- 应用提交 `9b7fd07`；Go 来源提交 `9195e27074`。发布镜像 `partner-demo:public-v2`，摘要 `sha256:abee753ae99239e74ade75973cc0f2be4e98cc3ddca767999bd2fc13b830d841`。Git 提交保留本地，未推送远端。
- Bun 75 pass / 0 fail / 636 assertions，TypeScript及浏览器脚本语法通过；Go settlementdemo/model/controller 的 Settlement 检查及治理检查通过。Go 来源为专用常驻可执行文件，替代限时测试二进制。
- 私有回环和公网HTTPS检查均通过：匿名拒绝、Secure/HttpOnly/Strict会话、跨源拒绝、角色隔离、钱包签名域、退出失效。证据：`evidence/public-demo-private-qa.json`、`evidence/public-demo-https-qa.json`。
- 迁移保留原10 USD测试订单、10%返佣及1 USDC已到账记录。部署后重放已完成订单不新增出款/账本行。此次发布新增付款0笔；合约测试USDC余额为0，新出款前需另行补充测试资金。
- 来源地址必须保留127.0.0.1:18784，因为它参与账本运行身份指纹；首次18785配置被正确拒绝，修正配置而未重写指纹或重建订单。
- 故障恢复实测：public-v1运行中终止容器内精确Go来源进程，Bun退出，Docker重启次数0→1，健康恢复且旧回执/余额不变。public-v2仅修正浏览器账号切换时等待当前账号数据与丢弃旧响应，监督入口未变。
- 浏览器商家→推广者切换，在工作区首次可见时检查角色面板，均正确；320px无横向溢出，累计到账1.00。早前1440/390/320布局读回均无横向溢出。证据 `evidence/public-demo-browser-qa.json`。Ego截图接口超时、CDP截图失败，因此未宣称取得公网截图或完成截图验收。
- 安全复核任务 `20260918-163018-review-853a1549`：原始HTML首屏暴露工作区的问题已修复（默认登录页、POST表单、JS就绪前禁用提交）；“process.exitCode无法退出”未复现，缺密钥容器1.96秒以1退出及上述真实来源崩溃重启证据否定该判断；付款方BeefAPI为已批准商家品牌，保留。
- 版本化v1镜像和初始成对账本备份保留用于回滚；秘密仅挂载私有0600文件，不在镜像/Git/前端。旧本地Fuji来源与worker已停止，避免双执行器。

## 2026-09-18 公网新订单完整实测

- 用户补充的20测试USDC到账后，从 https://partner.bflabs.app 的商家页面创建一笔10 USD测试订单，并点击“模拟支付成功”；未调用手动执行结算按钮，后台自动出款。
- 请求编号 `6876fdb7-40e2-472a-9f2a-0b699f349686`，订单 `global_5d5ab99391c54bd888d44dfb75c1e10e`，锁定10%，实际佣金1测试USDC。
- 新交易 `0x4d42f62f378b4d8cac95ce2f5671ba0f83048188073353ebf12d23155d9c5891`，Fuji receipt success，区块58459415已finalized。RPC独立核对合约paid标记、Paid事件及官方测试USDC Transfer的付款编号/地址/金额一致。
- 来源pending=0、累计paid=2000000；本次新增1笔已完成记录，原订单/交易保留。合约余额20→19测试USDC。公网商家页面显示两笔订单已到账，新回执金额1.00及链上哈希正确。
- 已完成新订单重放没有新增记录或扣款；推广者重新登录后显示累计到账2.00、新回执存在，商家和订单面板隐藏。证据 `evidence/public-order-fuji-2026-09-18.json`。
- 第一次浏览器点击遇到滚动过程指针被article拦截；读回仍pending，重新定位可见按钮后完成一次确认。未以点击调用成功替代订单/链上证据。
- 本轮仅一笔测试币付款，无生产余额或真实支付渠道收款；应用代码及部署镜像未变。旧部署验证脚本的固定累计1USDC断言仅适用于发布时快照，不用于本轮2USDC账本。

## 2026-09-18 x402 集成验收（公网尚未升级）

- 本轮合同见 `X402.md`。Grok 后端作者 `ada87d0`（任务20260918-174331-delegate-7c739179），整合 `3dfe1a7`；前端作者 `226cfce`（任务20260918-174331-delegate-ff2b36b7），整合 `915978f`。主会话修正与独立验收提交 `b5b9931`。
- 主会话重跑 `bun run typecheck` 通过；`bun test` 107 pass / 0 fail / 829 assertions。包括真实钱包RPC签名、迟到401不登出新会话、已收款后原签名过期仍恢复记账、关闭开关不能模拟支付已有x402订单。
- 没有采纳前端作者“eth_signTypedData_v4应省略EIP712Domain”的判断；Ganache钱包RPC实际报 `EIP712Domain definition missing`，已补完整定义并用实际签名恢复地址验证。
- `bun scripts/verify-x402-local.ts` 完整链路通过：官方SDK2.26.0解析402/签名/读取PAYMENT-RESPONSE，本地真实EVM执行EIP3009授权转账，专用Go来源订单锁10%并入账，worker自动支付1，来源pending归零；付款人100→90、合约0→9、收款人0→1。重复请求只调用一次facilitator，模拟付款接口403。
- 本地EVM故意使用43113链ID和Fuji代币地址上的测试代码以检验签名域，RPC始终为127.0.0.1，账户随机生成且仅在本地注资。`evidence/x402-local-e2e.json` 中的交易不属于真实Fuji，不可作为公网付款证据。
- Ego TaskSpace243：从浏览器创建订单、触发402、注入仅用于本地的EIP1193桥接，由Ganache实际签名，页面提交付款，最终收到1测试代币佣金。没有绕过产品CSP。Ganache闲置后区块时间停止导致首轮gas模拟拒绝validAfter；推进本地区块后原授权重试成功，测试facilitator已增加推进本地区块时间，产品代码未放宽时间校验。
- 1440/390/320px DOM布局无横向溢出，付款按钮文本完整，收款与出款回执分开显示；证据 `evidence/x402-local-browser.json`。本轮一次截图调用仍出现Page.captureScreenshot超时，没有截图验收证据。
- 独立G3安全/结构审查任务 `20260918-181229-review-63be7539` 针对b5b9931 vs4ea7442，尚在运行。公网仍为旧public-v2；尚未执行新的真实Fuji x402付款。付款方选择已向Ender询问，未收到答复前不使用原出款私钥代签买家付款。
