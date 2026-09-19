# Builder Hub 项目材料

2026-09-19 更新稿，提交结果以 SUBMISSION.md 为准。

## short_description

A partner center for new-api and sub2api operators, connecting existing business ledgers to Avalanche commission settlement. BeefAPI Fuji demo verified; standard adapters and configurable L1 deployment packages are on the roadmap.

## full_description

Partner Center, built by BF Labs, is being developed for AI API service operators using new-api and sub2api. The product direction combines a self-deployed partner center, versioned business adapters, and a commission settlement protocol on Avalanche. Operators retain their existing gateway, billing and business systems. Standard upstream adapters and multi-product partner management are roadmap items, not currently verified compatibility.

Current evidence: BeefAPI is our first controlled test integration. On Avalanche Fuji (43113), an x402 payment sent 10 test USDC to the deployed Settlement contract. The business system locked a 10% rate and confirmed the commission; the same settlement contract then paid 1 test USDC to the partner, followed by verified ledger reconciliation. Payment and commission payout are separate transactions. Test funds have no monetary value. Production orders, mainnet funds and paid AI inference are not connected.

The next step is funded commission rights: fixed beneficiary, amount and claimable time, backed by reserved funds. CommissionEscrow is implemented and locally tested, but is not deployed on Fuji or connected to the live worker. It registers final confirmed commissions; it does not yet calculate a percentage automatically when an x402 payment arrives.

Development roadmap:
1. Wire commission rights into Fuji and verify claims with a replacement executor when our worker is offline.
2. Validate adapters against specified new-api and sub2api versions, including duplicate events, refunds, restarts and settlement recovery.
3. Prototype an Avalanche settlement L1 combining versioned business rules and funded rights with configurable network admission, fees and separately budgeted execution.
4. Prepare reusable L1 configuration packages. Possible profiles will be discussed and validated later, rather than fixed in this narrative. Offer merchant-specific rule configuration and deployment assistance after validation. These packages and services are not available yet. Validator operation, asset routes, upgrade governance and existing claim rights remain explicit deployment decisions.
5. Explore ICM/ICTT integration for other L1s, then assess commission precompiles or native scheduling against measured needs. MCP access for partner queries and assistance is a later interface direction.

Merchants may run the partner software on an existing chain; a dedicated L1 is an optional future delivery. The product positioning is settled; detailed L1 architecture, fees, validators, admission, scheduling and cross-chain choices will be discussed separately. We do not claim upstream endorsement, universal compatibility, automatic legal compliance or a live proprietary L1.

Presentation: https://partner.bflabs.app/demo
Product: https://partner.bflabs.app/
Roadmap: https://partner.bflabs.app/progress
Source: https://github.com/enderzcx/partner-center
Fuji contract: 0x5c905e43e0BB381534530d5e05DF56ab1f420899
Incoming payment: https://testnet.avascan.info/blockchain/c/tx/0xd0df9f773a5d033e4ee0475a47cf48f54c653b778077662555e6c531d45104c6#logs
Commission payout: https://testnet.avascan.info/blockchain/c/tx/0x6f9843b7c2d14211c07ef6d539a625cd4c8b1c962426b49ada6b15ac8fdea23d

## tech_stack

Current implementation: React/Vite frontend, Bun/TypeScript settlement service with SQLite, viem, Solidity and OpenZeppelin on Avalanche Fuji. A dedicated Go adapter connects an isolated BeefAPI test ledger. x402 v2 exact uses EIP-3009 signed USDC authorization through PayAI. The business system determines commission amounts; Settlement executes role-controlled payouts and prevents reuse of payout IDs.

Independent receipt verification matches USDC AuthorizationUsed and adjacent Transfer logs, including PayAI Multicall3 batches. Signed payout transactions are persisted before broadcast; unknown results recover the same transaction, while ledger completion is retried separately. A real Fuji payment was recovered without charging the buyer twice.

CommissionEscrow has local tests for fixed recipients, funded reservation, maturity checks, duplicate claims and withdrawal of unreserved funds only. It is not deployed on Fuji or wired to the live executor. Business confirmation and refund conditions precede registration.

Planned architecture: versioned new-api/sub2api adapters feed the partner service and settlement protocol. The L1 prototype will test rule versioning, merchant fund separation, replaceable execution, network admission and fee budgets. Reusable L1 configuration packages and merchant-specific deployment are planned, not shipped. ICM/ICTT, custom precompiles and native scheduling are future research; no live L1 or cross-chain capability is claimed.

## explanation

Yes. BeefAPI and its overseas frontend existed before this event. The Fuji Settlement contract, dedicated test ledger adapter and completed x402 payment/commission loop were developed and verified on September 18, 2026, before the September 19 event. We do not claim these as built from scratch during the event.

On September 19 we organized the personal public repository and documentation, built and deployed the product-progress/evidence page and its C pulse presentation, corrected explorer links, and prepared an online/offline demo deck. We also clarified the target audience and the roadmap for versioned new-api/sub2api adapters, funded commission rights and configurable Avalanche L1 deployment packages.

CommissionEscrow is locally tested but not deployed on Fuji. Standard upstream adapters, multi-product management, L1 packages, custom L1 deployment and MCP remain future work; roadmap content is not presented as completed implementation.
