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
const X402_NETWORK = "eip155:43113";
const X402_CHAIN_ID = 43113;
const X402_CHAIN_HEX = "0xa869";
const X402_MAX_TIMEOUT = 300;
const X402_VALID_AFTER_SKEW = 60;
const CIRCLE_FUJI_USDC_ASSET = "0x5425890298aed601595a70AB815c96711a31Bc65";
const FUJI_EXPLORER_TX = "https://testnet.avascan.info/blockchain/c/tx/";
let state = null,
  role = "merchant",
  busy = false,
  fetching = false,
  selectedReceipt = null;
let ledgerSignature = null;
let auth = { enabled: true, authenticated: false, role: null };
let loginBusy = false;
let authGeneration = 0;
let fetchingGeneration = -1;
let createOrderRequestId = null;
let orderHtml = "";
const x402Payloads = new Map();
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
function sameAddress(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}
function isTxHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || ""));
}
function isAddressLike(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
}
function x402Enabled(snapshot) {
  return !!(snapshot && snapshot.x402 && snapshot.x402.enabled === true);
}
function orderPayment(order) {
  return order && order.payment && typeof order.payment === "object"
    ? order.payment
    : null;
}
function orderUsesX402(order, enabled) {
  const payment = orderPayment(order);
  if (payment && payment.mode === "x402") return true;
  if (payment && typeof payment.mode === "string" && payment.mode !== "x402")
    return false;
  return !!enabled && !!order && order.status !== "paid";
}
function x402AmountAtomic(paymentAmountMinor) {
  if (!/^(10000|[1-9][0-9]{0,3})$/.test(String(paymentAmountMinor))) return null;
  return (BigInt(paymentAmountMinor) * 10000n).toString();
}
function x402UsdcLabel(paymentAmountMinor) {
  const usd = usdMinor(paymentAmountMinor);
  if (usd === "暂无数据") return "暂无数据";
  return usd.replace(/\.00$/, "") + " 测试 USDC";
}
function checkoutURLFromOrigin(origin, orderId) {
  return new URL(
    "/api/x402/orders/" + encodeURIComponent(orderId) + "/pay",
    origin,
  ).href;
}
function resourceURLOf(resource) {
  if (typeof resource === "string") return resource;
  if (resource && typeof resource.url === "string") return resource.url;
  return "";
}
function canonicalizeURL(value, base) {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
function encodeBase64Json(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function decodeBase64Json(raw) {
  const normalized = String(raw)
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function headerValue(headers, name) {
  if (!headers || typeof headers.get !== "function") return "";
  return headers.get(name) || "";
}
function parsePaymentRequired(headers, body) {
  const header = headerValue(headers, "PAYMENT-REQUIRED");
  if (header) {
    try {
      return decodeBase64Json(header);
    } catch {
      throw new Error("付款信息无法读取，未向钱包发起确认。");
    }
  }
  if (body && body.x402Version === 2) return body;
  throw new Error("付款信息无法读取，未向钱包发起确认。");
}
function verifyPaymentRequired(required, order, x402, checkoutURL) {
  const mismatch = "付款信息与本单不符，未向钱包发起确认。";
  if (!required || required.x402Version !== 2) throw new Error(mismatch);
  if (!x402 || x402.enabled !== true) throw new Error(mismatch);
  if (x402.network !== X402_NETWORK) throw new Error(mismatch);
  if (!sameAddress(x402.asset, CIRCLE_FUJI_USDC_ASSET)) throw new Error(mismatch);
  if (!isAddressLike(x402.payTo))
    throw new Error("收款地址无法核对，未向钱包发起确认。");
  const expectedAmount = x402AmountAtomic(order && order.paymentAmountMinor);
  if (expectedAmount == null)
    throw new Error("订单金额无法核对，未向钱包发起确认。");
  const resourceHref = canonicalizeURL(
    resourceURLOf(required.resource),
    checkoutURL,
  );
  const checkoutHref = canonicalizeURL(checkoutURL, checkoutURL);
  if (!resourceHref || resourceHref !== checkoutHref) throw new Error(mismatch);
  const accepts = Array.isArray(required.accepts) ? required.accepts : [];
  const accepted = accepts.find((item) => {
    if (!item || item.scheme !== "exact") return false;
    if (item.network !== X402_NETWORK) return false;
    if (String(item.amount) !== expectedAmount) return false;
    if (!sameAddress(item.asset, CIRCLE_FUJI_USDC_ASSET)) return false;
    if (!sameAddress(item.asset, x402.asset)) return false;
    if (!sameAddress(item.payTo, x402.payTo)) return false;
    if (Number(item.maxTimeoutSeconds) !== X402_MAX_TIMEOUT) return false;
    const extra = item.extra || {};
    return extra.name === "USD Coin" && String(extra.version) === "2";
  });
  if (!accepted) throw new Error(mismatch);
  return { resource: required.resource, accepted };
}
function validityWindow(nowMs, maxTimeoutSeconds) {
  const nowSec = Math.floor(nowMs / 1000);
  const bound = Math.min(
    X402_MAX_TIMEOUT,
    Math.max(1, Number(maxTimeoutSeconds) || X402_MAX_TIMEOUT),
  );
  return {
    validAfter: String(nowSec - X402_VALID_AFTER_SKEW),
    validBefore: String(nowSec + bound),
  };
}
function randomNonce32(fill) {
  const bytes = new Uint8Array(32);
  const write =
    fill ||
    (typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues.bind(crypto)
      : null);
  if (!write) throw new Error("无法开始付款。");
  write(bytes);
  return (
    "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}
function buildTransferTypedData(authorization, accepted) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    domain: {
      name: accepted.extra.name,
      version: String(accepted.extra.version),
      chainId: X402_CHAIN_ID,
      verifyingContract: accepted.asset,
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
    },
  };
}
function buildPaymentPayload(resource, accepted, signature, authorization) {
  return {
    x402Version: 2,
    resource,
    accepted,
    payload: { signature, authorization },
  };
}
function isUserRejected(err) {
  const code = err && err.code;
  if (code === 4001 || code === "4001") return true;
  const msg = String((err && err.message) || err || "");
  return /user rejected|user denied|rejected the request|denied transaction|request rejected/i.test(
    msg,
  );
}
function isNetworkError(err) {
  if (!err) return false;
  if (err.name === "TypeError") return true;
  const msg = String(err.message || "");
  return /failed to fetch|networkerror|load failed/i.test(msg);
}
function x402PayButtonText(order, opts) {
  const payment = orderPayment(order);
  const status = payment && payment.status;
  const uncertain = !!(opts && opts.uncertain);
  if (status === "settled" || status === "completed") return "继续结算";
  if (status === "submitted" || status === "blocked" || uncertain)
    return "继续确认付款";
  return "支付 " + x402UsdcLabel(order.paymentAmountMinor);
}
function explorerTxLink(hash, label) {
  return (
    '<p class="explorer-link"><a target="_blank" rel="noopener noreferrer" href="' +
    FUJI_EXPLORER_TX +
    encodeURIComponent(hash) +
    '">' +
    escapeHTML(label) +
    "</a></p>"
  );
}
function payErrorMessage(result, fallback) {
  if (result && typeof result.error === "string" && result.error)
    return result.error;
  if (result && typeof result.message === "string" && result.message)
    return result.message;
  return fallback;
}
async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function ensureFujiChain(provider) {
  const current = await provider.request({ method: "eth_chainId" });
  if (Number.parseInt(String(current), 16) === X402_CHAIN_ID) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: X402_CHAIN_HEX }],
    });
  } catch (err) {
    if (isUserRejected(err)) throw new Error("已取消确认，付款未发送。");
    const code = err && err.code;
    if (code !== 4902 && code !== "4902") {
      throw new Error("请在钱包中切换到 Fuji 测试网后再支付。");
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: X402_CHAIN_HEX,
            chainName: "Avalanche Fuji Testnet",
            nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
            rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
            blockExplorerUrls: ["https://testnet.snowtrace.io"],
          },
        ],
      });
    } catch (addErr) {
      if (isUserRejected(addErr)) throw new Error("已取消确认，付款未发送。");
      throw new Error("请在钱包中切换到 Fuji 测试网后再支付。");
    }
  }
  const after = await provider.request({ method: "eth_chainId" });
  if (Number.parseInt(String(after), 16) !== X402_CHAIN_ID) {
    throw new Error("请在钱包中切换到 Fuji 测试网后再支付。");
  }
}
function createX402Pay(io) {
  const payloads = io.payloads || new Map();
  async function postPay(orderId, signatureB64, generation) {
    const path = "/api/x402/orders/" + encodeURIComponent(orderId) + "/pay";
    const headers = { "Content-Type": "application/json" };
    if (signatureB64) headers["PAYMENT-SIGNATURE"] = signatureB64;
    const response = await io.fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: "{}",
    });
    const result = await readResponseJson(response);
    if (response.status === 401 && generation === io.getAuthGeneration()) {
      const message = payErrorMessage(result, "登录已过期，请重新登录。");
      if (typeof io.onUnauthorized === "function") io.onUnauthorized(message);
      throw new Error(message);
    }
    return { response, result };
  }
  function classify(status) {
    if (status === 200) return "completed";
    if (status === 202 || status === 503) return "processing";
    if (status === 402) return "required";
    return "error";
  }
  async function signAuthorization(order, required) {
    const x402 = io.getX402();
    const checkoutURL = checkoutURLFromOrigin(io.getOrigin(), order.requestId);
    const checked = verifyPaymentRequired(required, order, x402, checkoutURL);
    if (Number(io.getNetworkChainId()) !== X402_CHAIN_ID) {
      throw new Error("当前网络不是 Fuji 测试网，无法支付。");
    }
    const provider =
      typeof io.getProvider === "function" ? io.getProvider() : null;
    if (!provider || typeof provider.request !== "function") {
      throw new Error("未检测到钱包，请先安装并解锁。");
    }
    let accounts;
    try {
      accounts = await provider.request({ method: "eth_requestAccounts" });
    } catch (err) {
      if (isUserRejected(err)) throw new Error("已取消确认，付款未发送。");
      throw new Error("无法连接钱包。");
    }
    const from = accounts && accounts[0];
    if (!from) throw new Error("钱包未提供账户。");
    await ensureFujiChain(provider);
    const window = validityWindow(
      io.now(),
      checked.accepted.maxTimeoutSeconds,
    );
    const nonce =
      typeof io.randomNonce === "function"
        ? io.randomNonce()
        : randomNonce32();
    const authorization = {
      from,
      to: checked.accepted.payTo,
      value: String(checked.accepted.amount),
      validAfter: window.validAfter,
      validBefore: window.validBefore,
      nonce,
    };
    const typedData = buildTransferTypedData(authorization, checked.accepted);
    let signature;
    try {
      signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [from, JSON.stringify(typedData)],
      });
    } catch (err) {
      if (isUserRejected(err)) throw new Error("已取消确认，付款未发送。");
      throw new Error("钱包确认失败，付款未发送。");
    }
    if (!signature) throw new Error("钱包未返回确认，付款未发送。");
    return encodeBase64Json(
      buildPaymentPayload(
        checked.resource,
        checked.accepted,
        signature,
        authorization,
      ),
    );
  }
  return {
    payloads,
    async pay(order) {
      const id = order.requestId;
      const generation = io.getAuthGeneration();
      const stale = () => generation !== io.getAuthGeneration();
      const finish = (kind) => {
        if (kind === "completed" || kind === "processing") payloads.delete(id);
        return { kind };
      };
      const send = async (signatureB64) => {
        if (stale()) throw new Error("登录已过期，请重新登录。");
        try {
          const result = await postPay(id, signatureB64, generation);
          if (stale()) throw new Error("登录已过期，请重新登录。");
          return result;
        } catch (err) {
          if (stale()) throw new Error("登录已过期，请重新登录。");
          if (signatureB64 && isNetworkError(err)) {
            throw new Error("网络中断，可再试一次。不会重新扣款。");
          }
          throw err;
        }
      };
      const retained = payloads.get(id);
      if (retained) {
        const retried = await send(retained);
        const kind = classify(retried.response.status);
        if (kind === "completed" || kind === "processing") return finish(kind);
        if (kind === "required") {
          payloads.delete(id);
          throw new Error("付款未完成，请重新确认。");
        }
        throw new Error(payErrorMessage(retried.result, "付款未成功，请重试。"));
      }
      const first = await send(null);
      const firstKind = classify(first.response.status);
      if (firstKind === "completed" || firstKind === "processing")
        return finish(firstKind);
      if (firstKind !== "required") {
        throw new Error(payErrorMessage(first.result, "付款未成功，请重试。"));
      }
      const required = parsePaymentRequired(first.response.headers, first.result);
      let signatureB64;
      try {
        signatureB64 = await signAuthorization(order, required);
      } catch (err) {
        if (isUserRejected(err)) throw new Error("已取消确认，付款未发送。");
        throw err;
      }
      if (stale()) throw new Error("登录已过期，请重新登录。");
      payloads.set(id, signatureB64);
      const second = await send(signatureB64);
      const secondKind = classify(second.response.status);
      if (secondKind === "completed" || secondKind === "processing")
        return finish(secondKind);
      if (secondKind === "required") {
        payloads.delete(id);
        throw new Error("付款未完成，请重新确认。");
      }
      throw new Error(payErrorMessage(second.result, "付款未成功，请重试。"));
    },
  };
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
  authGeneration += 1;
  selectedReceipt = null;
  x402Payloads.clear();
  orderHtml = "";
  if ($("receipt").open) $("receipt").close();
  auth.authenticated = false;
  auth.role = null;
  state = null;
  ledgerSignature = null;
  $("login-shell").hidden = false;
  $("login-submit").disabled = false;
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
  const requestGeneration = authGeneration;
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
  if (response.status === 401 && auth.enabled && path !== "/api/auth/login" && requestGeneration === authGeneration) {
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
const x402Pay = createX402Pay({
  payloads: x402Payloads,
  fetch: (input, init) => fetch(input, init),
  getProvider: () => window.ethereum,
  now: () => Date.now(),
  randomNonce: () => randomNonce32(),
  getOrigin: () => window.location.origin,
  getX402: () => (state && state.x402) || null,
  getNetworkChainId: () => Number(state && state.network && state.network.chainId),
  getAuthGeneration: () => authGeneration,
  onUnauthorized: (message) => {
    showLogin(message);
  },
});
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
      const x402 = orderUsesX402(order, x402Enabled(state));
      const payment = orderPayment(order);
      const payStatus = payment && typeof payment.status === "string" ? payment.status : null;
      const pending = order.status !== "paid";
      const percent = formatCommissionPercent(order.commissionRate);
      const payout = state.payouts.find((p) => p.sourceId.startsWith("beefapi:order-" + order.requestId + ":"));
      const paymentError = payment && typeof payment.error === "string" ? payment.error : null;
      const orderError = payout?.status === "completed" ? null : paymentError || order.error;
      const incomingOpen = pending && payStatus !== "settled" && payStatus !== "completed";
      const canPay = payout?.status !== "completed" && (pending || orderError || payStatus === "required" || payStatus === "submitted" || payStatus === "settled" || payStatus === "blocked" || (order.commissionUsdc !== "0" && !payout));
      const bound = !!(state.partner.wallet || order.recipient);
      const payDisabled = busy || (incomingOpen && payStatus !== "submitted" && !bound);
      const incomingDone = !incomingOpen;
      let statusLabel;
      if (x402) {
        if (payout?.status === "completed") statusLabel = "已到账";
        else if (payStatus === "blocked") statusLabel = "需要处理";
        else if (payout?.status === "blocked") statusLabel = "待处理";
        else if (payStatus === "submitted") statusLabel = "付款确认中";
        else if (incomingDone) {
          statusLabel = order.commissionUsdc === "0" ? "无返佣" : payout ? "结算中" : "已收款";
        } else statusLabel = "待付款";
      } else {
        statusLabel = pending ? "待确认" : payout?.status === "completed" ? "已到账" : payout?.status === "blocked" ? "待处理" : payout ? "结算中" : order.commissionUsdc === "0" ? "无返佣" : "待结算";
      }
      const rateText = percent == null ? "无法读取" : percent + "%";
      const commissionText = incomingDone
        ? precise(order.commissionUsdc) + " USDC"
        : "确认后入账";
      let hint;
      if (x402) {
        if (incomingOpen && payStatus !== "submitted") {
          hint = bound
            ? "从付款钱包支付测试 USDC，到账后按本单比例返佣。"
            : auth.enabled ? "请推广者登录并绑定收款钱包。" : "请先到「我的收益」绑定收款钱包。";
        } else if (payStatus === "submitted") {
          hint = "付款正在确认。";
        } else if (orderError) {
          hint = "付款已到账，结算尚未完成，请重试。";
        } else if (order.commissionUsdc === "0") {
          hint = "当前锁定比例不产生返佣。";
        } else if (payout?.status === "completed") {
          hint = "已到账，可在下方结算记录查看回执。";
        } else {
          hint = "测试 USDC 已到账，佣金将付到本单收款钱包。";
        }
      } else {
        hint = pending
          ? bound
            ? "不会向买家扣款。"
            : auth.enabled ? "请推广者登录并绑定收款钱包。" : "请先到「我的收益」绑定收款钱包。"
          : orderError
            ? "支付已确认，结算尚未完成，请重试。"
            : order.commissionUsdc === "0"
              ? "当前锁定比例不产生返佣。"
              : payout?.status === "completed"
                ? "已到账，可在下方结算记录查看回执。"
                : "佣金已记入，随后付到本单收款钱包。";
      }
      const amountHtml = x402
        ? (incomingDone ? "已付" : "应付") +
          " <strong>" +
          escapeHTML(x402UsdcLabel(order.paymentAmountMinor)) +
          "</strong>"
        : "实付 <strong>" +
          escapeHTML(usdMinor(order.paymentAmountMinor)) +
          " USD</strong>";
      const buttonText = x402
        ? x402PayButtonText(order, { uncertain: x402Payloads.has(order.requestId) })
        : pending
          ? "模拟支付成功"
          : "继续结算";
      const incomingLink =
        x402 && isTxHash(payment && payment.txHash)
          ? explorerTxLink(payment.txHash, "在 Fuji 浏览器查看付款")
          : "";
      return (
        '<article class="order-row" data-order="' +
        escapeHTML(order.requestId) +
        '"><div class="order-row-top"><span class="order-id">' +
        escapeHTML(short(order.tradeNo || order.requestId)) +
        '</span><span class="badge' +
        (incomingDone ? " good" : "") +
        '">' +
        statusLabel +
        "</span></div><div class=\"order-facts\"><span>" +
        amountHtml +
        '</span><span>锁定比例 <strong>' +
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
        incomingLink +
        (canPay
          ? '<div class="actions"><button class="button primary" type="button" data-pay-order="' +
            escapeHTML(order.requestId) +
            '"' +
            (payDisabled ? " disabled" : "") +
            ">" +
            buttonText +
            "</button></div>"
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
    orderDemo = orderDemoOn(),
    x402On = x402Enabled(state);
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
      ? x402On
        ? "测试 USDC 到账后，佣金付到绑定钱包。"
        : "确认测试订单后，佣金付到绑定钱包。"
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
  $("order-intro").textContent = x402On
    ? "默认创建 10 测试 USDC 订单。"
    : "默认创建 10 USD 测试订单。";
  $("create-order").textContent = x402On
    ? "创建 10 测试 USDC 订单"
    : "创建 10 USD 测试订单";
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
  const generation = authGeneration;
  if (fetching && fetchingGeneration === generation) return;
  if (auth.enabled && !auth.authenticated) return;
  fetching = true;
  fetchingGeneration = generation;
  try {
    const nextState = await api("/api/state");
    if (generation !== authGeneration) return;
    state = nextState;
    if (state && (state.role === "merchant" || state.role === "promoter")) {
      role = state.role;
      auth.role = state.role;
      applyAuthChrome();
    }
    render();
    if (!busy) lock(false);
  } catch (error) {
    if (generation !== authGeneration) return;
    if (auth.enabled && !auth.authenticated) throw error;
    notice("同步失败：" + error.message, true);
    $("sync-time").textContent = state ? "数据未更新，请重试" : "尚未连接";
    if (!state)
      $("ledger-content").innerHTML =
        '<div class="empty"><strong>无法读取结算记录</strong>请刷新后重试。</div>';
    throw error;
  } finally {
    if (fetchingGeneration === generation) fetching = false;
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
function orderForPayout(payout) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const sourceId = String(payout && payout.sourceId || "");
  return orders.find((order) =>
    sourceId.startsWith("beefapi:order-" + order.requestId + ":"),
  );
}
function renderReceipt(id) {
  const p = state.payouts.find((p) => String(p.id) === String(id));
  if (!p) return;
  const n = state.network;
  const fuji = Number(n.chainId) === 43113;
  const confirmed = ["confirmed", "completed"].includes(p.status);
  const networkName = fuji ? "Fuji 测试网" : "本地测试网";
  const matched = orderForPayout(p);
  const incomingHash = matched && orderPayment(matched) && orderPayment(matched).txHash;
  const showIncoming =
    matched &&
    (orderUsesX402(matched, x402Enabled(state)) || isTxHash(incomingHash));
  let fields =
    field("结算单号", p.id, true) +
    field("业务单号", p.sourceId || "暂无单号", true) +
    field("网络", networkName + " · " + n.chainId, true) +
    field("代币", n.token || "暂无代币地址", true) +
    field("收款地址", p.recipient, true);
  if (showIncoming)
    fields += field("付款交易", isTxHash(incomingHash) ? incomingHash : "尚未支付", true);
  fields +=
    field(showIncoming ? "出款交易" : "链上交易", p.txHash || "尚未发送", true) +
    field("创建时间", time(p.createdAt)) +
    field("到账", confirmed ? "已确认" : "尚未确认") +
    field("记录", p.status === "completed" ? "已完成" : "更新中");
  if (p.error) fields += field("待处理原因", p.error);
  const incomingLink =
    fuji && isTxHash(incomingHash)
      ? explorerTxLink(incomingHash, "在 Fuji 浏览器查看付款")
      : "";
  const outgoingLabel = showIncoming ? "在 Fuji 浏览器查看出款" : "在 Fuji 浏览器查看交易";
  const outgoingLink =
    fuji && isTxHash(p.txHash) ? explorerTxLink(p.txHash, outgoingLabel) : "";
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
    incomingLink +
    outgoingLink;
}
async function payX402Order(order) {
  if (busy) return;
  lock(true);
  try {
    const outcome = await x402Pay.pay(order);
    if (auth.enabled && !auth.authenticated) return;
    await refresh();
    if (auth.enabled && !auth.authenticated) return;
    if (outcome.kind === "completed") notice("测试 USDC 付款已完成。");
    else if (outcome.kind === "processing") notice("付款正在确认。");
    else notice("付款结果已更新。");
  } catch (error) {
    if (auth.enabled && !auth.authenticated) return;
    notice(error.message, true);
  } finally {
    lock(false);
    if (state) renderControls();
  }
}
function bindUi() {
  $("app-shell").hidden = true;
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
    const order = (Array.isArray(state.orders) ? state.orders : []).find(
      (item) => item.requestId === id,
    );
    if (!order) return;
    if (orderUsesX402(order, x402Enabled(state))) {
      payX402Order(order);
      return;
    }
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
      authGeneration += 1;
      state = null;
      ledgerSignature = null;
      orderHtml = "";
      x402Payloads.clear();
      auth.enabled = true;
      auth.authenticated = true;
      auth.role = result.role;
      role = result.role;
      $("login-password").value = "";
      await refresh();
      if (state) showApp();
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
      await refresh();
      if (state) showApp();
    } catch (error) {
      if (auth.enabled) showLogin(error.message);
      else notice("同步失败：" + error.message, true);
    }
  }
  bootstrap().catch(() => {});
  setInterval(() => {
    if (!busy && !loginBusy && !document.hidden && (!auth.enabled || auth.authenticated))
      refresh().catch(() => {});
  }, 3000);
}
if (typeof document !== "undefined" && document.getElementById("app-shell")) {
  bindUi();
}
export {
  CIRCLE_FUJI_USDC_ASSET,
  X402_CHAIN_ID,
  X402_NETWORK,
  buildPaymentPayload,
  buildTransferTypedData,
  checkoutURLFromOrigin,
  createX402Pay,
  decodeBase64Json,
  encodeBase64Json,
  isNetworkError,
  isUserRejected,
  orderUsesX402,
  parsePaymentRequired,
  randomNonce32,
  validityWindow,
  verifyPaymentRequired,
  x402AmountAtomic,
  x402PayButtonText,
  x402UsdcLabel,
};
