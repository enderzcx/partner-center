"use strict";
const $ = (id) => document.getElementById(id);
const statuses = {
  reserved: "已预留",
  prepared: "待广播",
  broadcast: "等待链上确认",
  confirmed: "已到账 · 待记账",
  completed: "已完成",
  blocked: "需要处理",
};
let state = null,
  role = "merchant",
  busy = false,
  fetching = false,
  selectedReceipt = null;
let ledgerSignature = null;
const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function units(value, digits = 6, places = 2) {
  if (value === undefined || value === null || String(value).trim() === "")
    return "暂无数据";
  try {
    const n = BigInt(value),
      base = 10n ** BigInt(digits),
      fraction = (n % base).toString().padStart(digits, "0");
    return (n / base).toLocaleString("en-US") + "." + fraction.slice(0, places);
  } catch {
    return "暂无数据";
  }
}
function precise(value) {
  if (value === undefined || value === null || String(value).trim() === "")
    return "暂无数据";
  try {
    const n = BigInt(value);
    const f = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return (n / 1000000n).toLocaleString("en-US") + (f ? "." + f : ".00");
  } catch {
    return "暂无数据";
  }
}
function micro(input) {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s))
    throw new Error("请输入大于 0 的金额，最多 6 位小数。");
  const [a, b = ""] = s.split(".");
  const n = BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
  if (n <= 0n) throw new Error("金额需大于 0。");
  return n.toString();
}
function short(value) {
  const s = String(value || "");
  return s.length > 20 ? s.slice(0, 8) + "…" + s.slice(-6) : s;
}
function time(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "时间待确认"
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}
function notice(message, error = false) {
  $("notice").hidden = false;
  $("notice").textContent = message;
  $("notice").className = "notice" + (error ? " error" : "");
}
async function api(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("服务没有返回有效结果，请重试。");
  }
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : result.message || "请求未成功，请重试。",
    );
  return result;
}
function lock(value) {
  busy = value;
  document
    .querySelectorAll("main button, main input")
    .forEach((el) => (el.disabled = value || !state));
  $("refresh").disabled = value;
  if (!value && state) renderControls();
}
async function action(button, task, message) {
  if (busy) return;
  const text = button.textContent;
  lock(true);
  button.textContent = "处理中…";
  try {
    await task();
    await refresh();
    notice(message);
  } catch (error) {
    notice(error.message, true);
  } finally {
    button.textContent = text;
    lock(false);
    if (state) renderControls();
  }
}
function renderControls() {
  const fixture = state.source === "fixture",
    local = Number(state.network?.chainId) !== 43113;
  $("merchant-panel").hidden = role !== "merchant";
  $("promoter-panel").hidden = role !== "promoter";
  $("fixture-controls").hidden = !fixture || role !== "merchant";
  $("transfer-controls").hidden = !fixture || role !== "promoter";
  $("demo-wallet").hidden = !local || !fixture;
  $("auto").hidden = !fixture;
  $("bind").hidden = !fixture;
  $("pause").textContent = state.paused ? "恢复出款" : "暂停出款";
  $("pause-state").textContent = state.paused ? "已暂停" : "出款已开启";
  $("pause-state").className = "badge" + (state.paused ? " warn" : " good");
  $("auto").textContent = state.partner.autoSettle
    ? "关闭自动结算"
    : "开启自动结算";
  $("auto-state").textContent = state.partner.autoSettle
    ? "自动结算已开启"
    : "自动结算已关闭";
  if (!fixture)
    $("auto-state").textContent = state.paused
      ? "出款已暂停"
      : "按结算单自动出款";
  $("auto-state").className =
    "badge" +
    ((!fixture ? !state.paused : state.partner.autoSettle) ? " good" : "");
  if (!fixture)
    $("recipient").textContent =
      "收款地址由 BeefAPI 随结算单确认，可在每笔回执中查看。";
  $("min-description").textContent = fixture
    ? "可用收益满 " + precise(state.minAmount) + " USDC 后自动结算。"
    : "佣金由接入方预留，按结算单指定钱包支付。";
  $("source-name").textContent = fixture
    ? "BeefAPI · 测试数据"
    : "BeefAPI · 已接入";
  $("source-description").textContent = fixture
    ? role === "merchant"
      ? "手动添加演示佣金，验证完整结算过程。"
      : "划入后可用于测试消费，不再参与结算。当前余额 " +
        precise(state.consumed ?? state.partner.consumed) +
        " USDC。"
    : "结算单由 BeefAPI 提交，到账后自动回写结果。";
  $("run").disabled = busy || !state.network.configured;
  $("bind").disabled = busy;
}
function render() {
  const n = state.network || {},
    fuji = Number(n.chainId) === 43113;
  const warning = [state.sourceError, n.error].filter(Boolean).join("；");
  $("service-warning").hidden = !warning;
  $("service-warning").textContent = warning;
  $("network-name").textContent = fuji ? "Fuji 测试网" : "本地链演示";
  $("network-description").textContent = n.configured
    ? fuji
      ? "Avalanche · Chain ID 43113 · 测试资金"
      : "本机隔离网络 · 测试资金"
    : "出款网络暂不可用，请检查连接";
  for (const key of ["available", "pending", "paid"])
    $(key).textContent = precise(state.partner[key]);
  $("token-balance").textContent = precise(state.wallet?.token);
  $("gas-balance").textContent = units(state.wallet?.gas, 18, 4);
  $("recipient").textContent = state.partner.wallet || "尚未绑定收款钱包";
  $("view-label").textContent =
    (role === "merchant" ? "商家工作台" : "推广者工作台") +
    " · " +
    (state.partner.name || state.partner.id || "测试推广者");
  const rows = Array.isArray(state.payouts) ? state.payouts : [];
  $("record-count").textContent = rows.length + " 笔记录";
  const signature = JSON.stringify(rows);
  if (signature !== ledgerSignature) {
    ledgerSignature = signature;
    if (!rows.length)
      $("ledger-content").innerHTML =
        '<div class="empty"><strong>还没有结算记录</strong>佣金进入结算后，可在这里查看进度与回执。</div>';
    else
      $("ledger-content").innerHTML =
        '<table class="table"><thead><tr><th scope="col">结算单 / 时间</th><th scope="col" class="number">金额 · USDC</th><th scope="col">收款钱包</th><th scope="col" class="status-cell">状态</th></tr></thead><tbody>' +
        rows
          .map(
            (p) =>
              '<tr><td><button class="receipt-button" data-receipt="' +
              escapeHTML(p.id) +
              '">' +
              escapeHTML(short(p.id)) +
              "<span>" +
              escapeHTML(time(p.createdAt)) +
              ' · 查看回执 ↗</span></button></td><td class="number">' +
              escapeHTML(precise(p.amount)) +
              '</td><td title="' +
              escapeHTML(p.recipient) +
              '">' +
              escapeHTML(short(p.recipient)) +
              '</td><td class="status-cell"><span class="badge ' +
              (p.status === "completed"
                ? "good"
                : p.status === "blocked"
                  ? "warn"
                  : "") +
              '">' +
              escapeHTML(statuses[p.status] || p.status) +
              "</span></td></tr>",
          )
          .join("") +
        "</tbody></table>";
  }
  renderControls();
  if (selectedReceipt) renderReceipt(selectedReceipt);
  $("sync-time").textContent =
    "已同步 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
}
async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    state = await api("/api/state");
    render();
    if (!busy) lock(false);
  } catch (error) {
    notice("同步失败：" + error.message, true);
    $("sync-time").textContent = state ? "数据未更新，请重试" : "尚未连接服务";
    if (!state)
      $("ledger-content").innerHTML =
        '<div class="empty"><strong>无法读取结算记录</strong>请确认服务已启动，然后刷新数据。</div>';
    throw error;
  } finally {
    fetching = false;
  }
}
function renderReceipt(id) {
  const p = state.payouts.find((p) => String(p.id) === String(id));
  if (!p) return;
  const n = state.network;
  const fuji = Number(n.chainId) === 43113;
  const confirmed = ["confirmed", "completed"].includes(p.status);
  const fields = [
    ["结算单号", p.id],
    ["来源单号", p.sourceId],
    ["网络", (fuji ? "Fuji 测试网" : "本地链演示") + " · " + n.chainId],
    ["代币", n.token || "地址未提供"],
    ["收款地址", p.recipient],
    ["链上交易", p.txHash || "尚未广播"],
    ["创建时间", time(p.createdAt)],
    ["到账核验", confirmed ? "链上已确认" : "尚未确认到账"],
    ["账本状态", p.status === "completed" ? "已回写" : "待完成"],
  ];
  if (p.error) fields.push(["待处理原因", p.error]);
  $("receipt-content").innerHTML =
    '<span class="badge ' +
    (p.status === "completed" ? "good" : p.status === "blocked" ? "warn" : "") +
    '">' +
    escapeHTML(statuses[p.status] || p.status) +
    '</span><div class="receipt-amount">' +
    escapeHTML(precise(p.amount)) +
    ' <small>USDC</small></div><dl class="receipt-fields">' +
    fields
      .map(
        ([k, v]) =>
          "<div><dt>" +
          escapeHTML(k) +
          "</dt><dd>" +
          escapeHTML(v) +
          "</dd></div>",
      )
      .join("") +
    "</dl>" +
    (fuji && /^0x[0-9a-fA-F]{64}$/.test(p.txHash || "")
      ? '<p class="explorer-link"><a target="_blank" rel="noopener noreferrer" href="https://testnet.snowtrace.io/tx/' +
        encodeURIComponent(p.txHash) +
        '">在 Fuji 浏览器查看交易 ↗</a></p>'
      : "");
}
document.querySelectorAll("[data-role]").forEach((button) =>
  button.addEventListener("click", () => {
    role = button.dataset.role;
    document.querySelectorAll("[data-role]").forEach((b) => {
      b.classList.toggle("selected", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    });
    $("identity").textContent = role === "merchant" ? "商家" : "推广者";
    $("view-label").textContent =
      role === "merchant" ? "商家工作台" : "推广者工作台";
    $("page-title").textContent =
      role === "merchant" ? "每笔收益，有据可查。" : "收益到账，清楚可见。";
    $("page-description").textContent =
      role === "merchant"
        ? "从佣金入账到钱包到账，在这里查看结算进度。"
        : "管理收款钱包，查看你的收益与到账记录。";
    if (state) renderControls();
  }),
);
$("refresh").addEventListener("click", () =>
  action($("refresh"), async () => {}, "数据已刷新"),
);
$("pause").addEventListener("click", () =>
  action(
    $("pause"),
    () => api("/api/admin/pause", { paused: !state.paused }),
    "出款设置已更新",
  ),
);
$("run").addEventListener("click", () =>
  action(
    $("run"),
    () => api("/api/admin/run", {}),
    "结算检查已执行，请查看记录状态",
  ),
);
$("auto").addEventListener("click", () =>
  action(
    $("auto"),
    () => api("/api/partner/auto", { enabled: !state.partner.autoSettle }),
    "自动结算设置已更新",
  ),
);
$("demo-wallet").addEventListener("click", () =>
  action(
    $("demo-wallet"),
    () => api("/api/demo/wallet", {}),
    "本地测试收款钱包已绑定",
  ),
);
$("bind").addEventListener("click", () =>
  action(
    $("bind"),
    async () => {
      if (!window.ethereum)
        throw new Error(
          "未检测到钱包扩展，请先安装并解锁支持 Ethereum 的钱包。",
        );
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      if (!address) throw new Error("钱包未提供账户。");
      const challenge = await api("/api/partner/wallet/challenge", { address });
      const bytes = new TextEncoder().encode(challenge.message);
      const hex =
        "0x" +
        Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [hex, address],
      });
      await api("/api/partner/wallet/verify", { address, signature });
    },
    "收款钱包已验证",
  ),
);
for (const type of ["commission", "transfer"])
  $(type + "-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const err = $(type + "-error");
    err.textContent = "";
    let amount;
    try {
      amount = micro($(type + "-amount").value);
    } catch (error) {
      err.textContent = error.message;
      return;
    }
    const button =
      event.submitter || event.currentTarget.querySelector("button");
    action(
      button,
      () =>
        api(
          type === "commission"
            ? "/api/demo/commission"
            : "/api/partner/transfer",
          { amount },
        ),
      type === "commission" ? "测试佣金已添加" : "已划入测试消费余额",
    );
  });
$("ledger-content").addEventListener("click", (event) => {
  const button = event.target.closest("[data-receipt]");
  if (!button) return;
  selectedReceipt = button.dataset.receipt;
  renderReceipt(selectedReceipt);
  $("receipt").showModal();
});
$("close-receipt").addEventListener("click", () => $("receipt").close());
$("receipt").addEventListener("close", () => (selectedReceipt = null));
refresh().catch(() => {});
setInterval(() => {
  if (!busy && !document.hidden) refresh().catch(() => {});
}, 3000);
