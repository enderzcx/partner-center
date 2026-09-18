"use strict";
const $ = (id) => document.getElementById(id);
const statuses = {
  reserved: "待付款",
  prepared: "准备发送",
  broadcast: "等待确认",
  confirmed: "已到账，更新中",
  completed: "已完成",
  blocked: "需要处理",
};
let state = null,
  role = "merchant",
  busy = false,
  fetching = false,
  selectedReceipt = null;
let ledgerSignature = null;
let auth = { enabled: false, authenticated: false, role: null };
let loginBusy = false;
$("app-shell").hidden = true;
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
function usdMinor(value) {
  if (value === undefined || value === null || String(value).trim() === "")
    return "暂无数据";
  if (!/^(10000|[1-9][0-9]{0,3})$/.test(String(value))) return "暂无数据";
  const cents = Number(value);
  const whole = Math.trunc(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return whole.toLocaleString("en-US") + "." + frac;
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
function parseCommissionRate(value) {
  return typeof value === "string" &&
    /^(0(\.[0-9]{1,18})?|1(\.0{1,18})?)$/.test(value)
    ? value
    : null;
}
function formatCommissionPercent(rate) {
  if (parseCommissionRate(rate) == null) return null;
  const [intPart, frac = ""] = rate.split(".");
  if (intPart === "1") return "100";
  const padded = frac.padEnd(2, "0");
  const whole = padded.slice(0, 2).replace(/^0+(?=\d)/, "") || "0";
  const rest = padded.slice(2).replace(/0+$/, "");
  return rest ? whole + "." + rest : whole;
}
function isZeroCommissionRate(rate) {
  return /^0(\.0+)?$/.test(rate);
}
function renderRate() {
  const commission = state && state.commission;
  const rate = commission ? parseCommissionRate(commission.rate) : null;
  const source =
    commission && typeof commission.rateSource === "string"
      ? commission.rateSource
      : "unavailable";
  const percent = rate != null ? formatCommissionPercent(rate) : null;
  const scopeEl = $("rate-scope");
  const exampleEl = $("rate-example");
  let badge = "";
  if (rate != null && source === "demo") badge = "演示规则";
  else if (rate != null && source === "override") badge = "专属比例";
  else if (rate != null && (source === "default" || source === "disabled"))
    badge = "当前比例";
  scopeEl.hidden = !badge;
  scopeEl.textContent = badge;
  if (rate == null || percent == null || source === "unavailable") {
    $("rate-value").textContent = "无法读取";
    $("rate-rule").textContent = "当前比例暂无法读取。";
    $("rate-limit").textContent = "已有付款金额不变。";
    exampleEl.hidden = true;
    exampleEl.textContent = "";
    return;
  }
  $("rate-value").textContent = percent + "%";
  if (isZeroCommissionRate(rate)) {
    $("rate-rule").textContent = "当前不产生新返佣。";
    $("rate-limit").textContent = "已生成的付款会继续处理。";
    exampleEl.hidden = true;
    exampleEl.textContent = "";
    return;
  }
  $("rate-rule").textContent =
    "按实际支付金额计算。比例在下单时确定，之后调整不影响已有订单。";
  $("rate-limit").textContent = "赠送、试用与收益转入不计返佣。";
  if (percent === "10") {
    exampleEl.hidden = false;
    exampleEl.textContent = "示例：实付 100 USD，返佣 10 USD";
  } else {
    exampleEl.hidden = true;
    exampleEl.textContent = "";
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
function viewCopy() {
  const merchant = role === "merchant";
  $("page-title").textContent = merchant ? "结算" : "我的收益";
  $("page-description").textContent = merchant
    ? "查看可用收益和出款进度。"
    : "查看收益和到账记录。";
}
function showLogin(message) {
  auth.authenticated = false;
  auth.role = null;
  state = null;
  ledgerSignature = null;
  $("login-shell").hidden = false;
  $("app-shell").hidden = true;
  $("account-bar").hidden = true;
  document.querySelector(".skip").setAttribute("href", "#login-username");
  const err = $("login-error");
  err.textContent = message || "";
  $("login-password").value = "";
}
function showApp() {
  $("login-shell").hidden = true;
  $("app-shell").hidden = false;
  document.querySelector(".skip").setAttribute("href", "#main");
  applyAuthChrome();
}
function applyAuthChrome() {
  const authOn = !!auth.enabled;
  document.querySelectorAll("[data-role]").forEach((button) => {
    if (!authOn) {
      button.hidden = false;
      button.disabled = false;
      return;
    }
    const match = button.dataset.role === role;
    button.hidden = !match;
    button.disabled = true;
    button.classList.toggle("selected", match);
    button.setAttribute("aria-pressed", String(match));
  });
  $("account-bar").hidden = !authOn;
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
  if (response.status === 401 && auth.enabled && path !== "/api/auth/login") {
    showLogin(
      typeof result.error === "string" && result.error
        ? result.error
        : "登录已过期，请重新登录。",
    );
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "登录已过期，请重新登录。",
    );
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
    .querySelectorAll("#app-shell main button, #app-shell main input")
    .forEach((el) => (el.disabled = value || !state));
  $("refresh").disabled = value;
  if (!value && state) renderControls();
}
async function action(button, task, message) {
  if (busy) return;
  const html = button.innerHTML;
  lock(true);
  button.textContent = "处理中…";
  try {
    await task();
    await refresh();
    notice(message);
  } catch (error) {
    notice(error.message, true);
  } finally {
    button.innerHTML = html;
    lock(false);
    if (state) renderControls();
  }
}
function orderDemoOn() {
  return !!(state && state.orderDemo);
}
let createOrderRequestId = null;
let orderHtml = "";
function renderOrders() {
  const panel = $("order-panel");
  const demo = orderDemoOn();
  panel.hidden = !demo || role !== "merchant";
  if (!demo) return;
  const orders = Array.isArray(state.orders) ? state.orders : [];
  $("order-count").textContent = orders.length + " 笔";
  if (!orders.length) {
    const empty = '<div class="empty"><strong>还没有测试订单</strong>创建后可确认支付并查看佣金。</div>';
    if (orderHtml !== empty) { $("order-list").innerHTML = empty; orderHtml = empty; }
    return;
  }
  const html = orders
    .map((order) => {
      const pending = order.status !== "paid";
      const percent = formatCommissionPercent(order.commissionRate);
      const payout = state.payouts.find((p) => p.sourceId.startsWith("beefapi:order-" + order.requestId + ":"));
      const orderError = payout?.status === "completed" ? null : order.error;
      const canPay = payout?.status !== "completed" && (pending || orderError || (order.commissionUsdc !== "0" && !payout));
      const bound = !!(state.partner.wallet || order.recipient);
      const payDisabled = busy || (pending && !bound);
      const statusLabel = pending ? "待确认" : payout?.status === "completed" ? "已到账" : payout?.status === "blocked" ? "待处理" : payout ? "结算中" : order.commissionUsdc === "0" ? "无返佣" : "待结算";
      const rateText = percent == null ? "无法读取" : percent + "%";
      const commissionText = pending
        ? "确认后入账"
        : precise(order.commissionUsdc) + " USDC";
      const hint = pending
        ? bound
          ? "不会向买家扣款。"
          : "请先到「我的收益」绑定收款钱包。"
        : orderError
          ? "支付已确认，结算尚未完成，请重试。"
          : order.commissionUsdc === "0"
            ? "当前锁定比例不产生返佣。"
            : payout?.status === "completed"
              ? "已到账，可在下方结算记录查看回执。"
              : "佣金已记入，随后付到本单收款钱包。";
      return (
        '<article class="order-row" data-order="' +
        escapeHTML(order.requestId) +
        '"><div class="order-row-top"><span class="order-id">' +
        escapeHTML(short(order.tradeNo || order.requestId)) +
        '</span><span class="badge' +
        (pending ? "" : " good") +
        '">' +
        statusLabel +
        "</span></div><div class=\"order-facts\"><span>实付 <strong>" +
        escapeHTML(usdMinor(order.paymentAmountMinor)) +
        ' USD</strong></span><span>锁定比例 <strong>' +
        escapeHTML(rateText) +
        "</strong></span><span>佣金 <strong>" +
        escapeHTML(commissionText) +
        "</strong></span></div>" +
        (orderError
          ? '<p class="field-error">' + escapeHTML(orderError) + "</p>"
          : "") +
        '<p class="subtle">' +
        hint +
        "</p>" +
        (canPay
          ? '<div class="actions"><button class="button primary" type="button" data-pay-order="' +
            escapeHTML(order.requestId) +
            '"' +
            (payDisabled ? " disabled" : "") +
            ">" + (pending ? "模拟支付成功" : "继续结算") + "</button></div>"
          : "") +
        "</article>"
      );
    })
    .join("");
  if (orderHtml !== html) { $("order-list").innerHTML = html; orderHtml = html; }
}
function renderControls() {
  const fixture = state.source === "fixture",
    local = Number(state.network?.chainId) !== 43113,
    orderDemo = orderDemoOn();
  $("merchant-panel").hidden = role !== "merchant";
  $("promoter-panel").hidden = role !== "promoter";
  $("order-panel").hidden = !orderDemo || role !== "merchant";
  $("fixture-controls").hidden = !fixture || role !== "merchant";
  $("transfer-controls").hidden = !fixture || role !== "promoter";
  $("demo-wallet").hidden = !local || !fixture;
  $("auto").hidden = !fixture;
  $("bind").hidden = !fixture && !orderDemo;
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
  if (!fixture && !orderDemo) {
    $("recipient").className = "wallet-note";
    $("recipient").textContent =
      "收款地址由 BeefAPI 随结算单确认，可在每笔回执中查看。";
  } else {
    $("recipient").className = "address";
  }
  $("min-description").textContent = fixture
    ? "可用收益满 " + precise(state.minAmount) + " USDC 后自动结算。"
    : orderDemo
      ? "确认测试订单后，佣金付到绑定钱包。"
      : "";
  $("min-description").hidden = !fixture && !orderDemo;
  $("transfer-description").textContent =
    "转入后用于测试消费，不再参与结算。当前余额 " +
    precise(state.partner.consumed) +
    " USDC。";
  $("source-line").hidden = fixture;
  $("source-name").textContent = fixture ? "测试收益" : "付款方 BeefAPI";
  $("source-description").textContent = fixture
    ? role === "merchant"
      ? ""
      : "划入后用于测试消费，不再参与结算。当前余额 " +
        precise(state.consumed ?? state.partner.consumed) +
        " USDC。"
    : orderDemo
      ? "测试订单的佣金付到绑定钱包。"
      : "收款地址以结算单为准。";
  $("run").disabled = busy || !state.network.configured;
  $("bind").disabled = busy;
  $("create-order").disabled = busy || !orderDemo;
  renderOrders();
}
function statusClass(status) {
  if (status === "completed") return "good";
  if (status === "blocked") return "warn";
  return "";
}
function render() {
  const n = state.network || {},
    fuji = Number(n.chainId) === 43113;
  const warning = [state.sourceError, n.error].filter(Boolean).join("；");
  $("service-warning").hidden = !warning;
  $("service-warning").textContent = warning;
  $("network-name").textContent = fuji ? "Fuji 测试网" : "本地测试网";
  $("network-description").textContent = n.configured
    ? ""
    : "出款网络暂不可用，请检查连接";
  $("network-description").hidden = n.configured;
  for (const key of ["available", "pending", "paid"])
    $(key).textContent = precise(state.partner[key]);
  renderRate();
  $("token-balance").textContent = precise(state.wallet?.token);
  $("gas-balance").textContent = units(state.wallet?.gas, 18, 4);
  $("recipient").textContent = state.partner.wallet || "尚未绑定收款钱包";
  viewCopy();
  const rows = Array.isArray(state.payouts) ? state.payouts : [];
  $("record-count").textContent = rows.length + " 笔";
  const signature = JSON.stringify(rows);
  if (signature !== ledgerSignature) {
    ledgerSignature = signature;
    if (!rows.length)
      $("ledger-content").innerHTML =
        '<div class="empty"><strong>还没有结算记录</strong>出款开始后，进度和回执会显示在这里。</div>';
    else
      $("ledger-content").innerHTML =
        '<table class="table"><thead><tr><th scope="col">结算单</th><th scope="col" class="number">金额 · USDC</th><th scope="col">收款钱包</th><th scope="col" class="status-cell">状态</th></tr></thead><tbody>' +
        rows
          .map(
            (p) =>
              '<tr><td><button class="receipt-button" type="button" data-receipt="' +
              escapeHTML(p.id) +
              '">' +
              escapeHTML(short(p.id)) +
              "<span>" +
              escapeHTML(time(p.createdAt)) +
              ' · 查看回执</span></button></td><td class="number">' +
              escapeHTML(precise(p.amount)) +
              '</td><td title="' +
              escapeHTML(p.recipient) +
              '">' +
              escapeHTML(short(p.recipient)) +
              '</td><td class="status-cell"><span class="badge ' +
              statusClass(p.status) +
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
  if (auth.enabled && !auth.authenticated) return;
  fetching = true;
  try {
    state = await api("/api/state");
    if (state && (state.role === "merchant" || state.role === "promoter")) {
      role = state.role;
      auth.role = state.role;
      applyAuthChrome();
    }
    render();
    if (!busy) lock(false);
  } catch (error) {
    if (auth.enabled && !auth.authenticated) throw error;
    notice("同步失败：" + error.message, true);
    $("sync-time").textContent = state ? "数据未更新，请重试" : "尚未连接";
    if (!state)
      $("ledger-content").innerHTML =
        '<div class="empty"><strong>无法读取结算记录</strong>请刷新后重试。</div>';
    throw error;
  } finally {
    fetching = false;
  }
}
function field(label, value, mono) {
  return (
    "<div><dt>" +
    escapeHTML(label) +
    "</dt><dd" +
    (mono ? ' class="mono"' : "") +
    ">" +
    escapeHTML(value) +
    "</dd></div>"
  );
}
function renderReceipt(id) {
  const p = state.payouts.find((p) => String(p.id) === String(id));
  if (!p) return;
  const n = state.network;
  const fuji = Number(n.chainId) === 43113;
  const confirmed = ["confirmed", "completed"].includes(p.status);
  const networkName = fuji ? "Fuji 测试网" : "本地测试网";
  let fields =
    field("结算单号", p.id, true) +
    field("业务单号", p.sourceId || "暂无单号", true) +
    field("网络", networkName + " · " + n.chainId, true) +
    field("代币", n.token || "暂无代币地址", true) +
    field("收款地址", p.recipient, true) +
    field("链上交易", p.txHash || "尚未发送", true) +
    field("创建时间", time(p.createdAt)) +
    field("到账", confirmed ? "已确认" : "尚未确认") +
    field("记录", p.status === "completed" ? "已完成" : "更新中");
  if (p.error) fields += field("待处理原因", p.error);
  $("receipt-content").innerHTML =
    '<span class="badge ' +
    statusClass(p.status) +
    '">' +
    escapeHTML(statuses[p.status] || p.status) +
    '</span><div class="receipt-amount">' +
    escapeHTML(precise(p.amount)) +
    ' <small>USDC</small></div><dl class="receipt-fields">' +
    fields +
    "</dl>" +
    (fuji && /^0x[0-9a-fA-F]{64}$/.test(p.txHash || "")
      ? '<p class="explorer-link"><a target="_blank" rel="noopener noreferrer" href="https://testnet.snowtrace.io/tx/' +
        encodeURIComponent(p.txHash) +
        '">在 Fuji 浏览器查看交易</a></p>'
      : "");
}
document.querySelectorAll("[data-role]").forEach((button) =>
  button.addEventListener("click", () => {
    if (auth.enabled) return;
    role = button.dataset.role;
    document.querySelectorAll("[data-role]").forEach((b) => {
      b.classList.toggle("selected", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    });
    viewCopy();
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
  action($("run"), () => api("/api/admin/run", {}), "已检查结算，请查看记录。"),
);
$("create-order").addEventListener("click", () =>
  action(
    $("create-order"),
    async () => {
      createOrderRequestId ??= crypto.randomUUID();
      await api("/api/demo/orders", { request_id: createOrderRequestId });
      createOrderRequestId = null;
    },
    "测试订单已创建",
  ),
);
$("order-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-pay-order]");
  if (!button || busy) return;
  const id = button.dataset.payOrder;
  action(
    button,
    () =>
      api("/api/demo/orders/" + encodeURIComponent(id) + "/pay", {}),
    "测试订单已确认，不会向买家扣款。",
  );
});
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
      type === "commission" ? "测试收益已添加" : "已划入测试消费余额",
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
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loginBusy) return;
  const errorBox = $("login-error");
  const username = $("login-username").value.trim();
  const password = $("login-password").value;
  if (!username || !password) {
    errorBox.textContent = "请填写账号和密码。";
    return;
  }
  loginBusy = true;
  $("login-submit").disabled = true;
  errorBox.textContent = "";
  try {
    const result = await api("/api/auth/login", { username, password });
    auth.enabled = true;
    auth.authenticated = true;
    auth.role = result.role;
    role = result.role;
    $("login-password").value = "";
    showApp();
    await refresh();
  } catch (error) {
    errorBox.textContent = error.message || "账号或密码不正确。";
    $("login-password").value = "";
    $("login-password").focus();
  } finally {
    loginBusy = false;
    $("login-submit").disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  if (busy || loginBusy) return;
  loginBusy = true;
  $("logout").disabled = true;
  try {
    await api("/api/auth/logout", {});
    showLogin();
  } catch (error) {
    notice(error.message, true);
  } finally {
    loginBusy = false;
    $("logout").disabled = false;
  }
});
async function bootstrap() {
  try {
    const session = await api("/api/auth/session");
    auth.enabled = !!session.authEnabled;
    auth.authenticated = !!session.authenticated;
    auth.role = session.role;
    if (auth.enabled && !auth.authenticated) {
      showLogin();
      return;
    }
    if (auth.enabled && (session.role === "merchant" || session.role === "promoter")) {
      role = session.role;
    }
    showApp();
    await refresh();
  } catch (error) {
    if (auth.enabled) showLogin(error.message);
    else notice("同步失败：" + error.message, true);
  }
}
bootstrap().catch(() => {});
setInterval(() => {
  if (!busy && !document.hidden && (!auth.enabled || auth.authenticated))
    refresh().catch(() => {});
}, 3000);
