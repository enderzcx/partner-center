/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import {
  formatCommissionPercent,
  precise,
  usdMinor,
} from '../../helpers/format';
import { x402Enabled } from '../../helpers/source-support';
import { orderUsesX402, x402PayButtonText, x402UsdcLabel } from '../../../../public/app.js';

export function orderPayment(order) {
  return order && order.payment && typeof order.payment === 'object'
    ? order.payment
    : null;
}

export function payoutForOrder(state, order) {
  const payouts = Array.isArray(state && state.payouts) ? state.payouts : [];
  return payouts.find((payout) =>
    String(payout.sourceId || '').startsWith(
      'beefapi:order-' + order.requestId + ':',
    ),
  );
}

export function orderView(order, state, payloads, authEnabled) {
  const x402 = orderUsesX402(order, x402Enabled(state));
  const payment = orderPayment(order);
  const payStatus =
    payment && typeof payment.status === 'string' ? payment.status : null;
  const pending = order.status !== 'paid';
  const percent = formatCommissionPercent(order.commissionRate);
  const payout = payoutForOrder(state, order);
  const paymentError =
    payment && typeof payment.error === 'string' ? payment.error : null;
  const orderError =
    payout?.status === 'completed' ? null : paymentError || order.error;
  const incomingOpen =
    pending && payStatus !== 'settled' && payStatus !== 'completed';
  const canPay =
    payout?.status !== 'completed' &&
    (pending ||
      orderError ||
      payStatus === 'required' ||
      payStatus === 'submitted' ||
      payStatus === 'settled' ||
      payStatus === 'blocked' ||
      (order.commissionUsdc !== '0' && !payout));
  const bound = !!(state.partner && (state.partner.wallet || order.recipient));
  const payDisabled = incomingOpen && payStatus !== 'submitted' && !bound;
  const incomingDone = !incomingOpen;
  let statusLabel;
  if (x402) {
    if (payout?.status === 'completed') statusLabel = '已到账';
    else if (payStatus === 'blocked') statusLabel = '需要处理';
    else if (payout?.status === 'blocked') statusLabel = '待处理';
    else if (payStatus === 'submitted') statusLabel = '付款确认中';
    else if (incomingDone) {
      statusLabel =
        order.commissionUsdc === '0' ? '无返佣' : payout ? '结算中' : '已收款';
    } else statusLabel = '待付款';
  } else {
    statusLabel = pending
      ? '待确认'
      : payout?.status === 'completed'
        ? '已到账'
        : payout?.status === 'blocked'
          ? '待处理'
          : payout
            ? '结算中'
            : order.commissionUsdc === '0'
              ? '无返佣'
              : '待结算';
  }
  const rateText = percent == null ? '无法读取' : percent + '%';
  const commissionText = incomingDone
    ? precise(order.commissionUsdc) + ' USDC'
    : '确认后入账';
  let hint;
  if (x402) {
    if (incomingOpen && payStatus !== 'submitted') {
      hint = bound
        ? '从付款钱包支付测试 USDC，到账后按本单比例返佣。'
        : authEnabled
          ? '请推广者登录并绑定收款钱包。'
          : '请先到「我的收益」绑定收款钱包。';
    } else if (payStatus === 'submitted') {
      hint = '付款正在确认。';
    } else if (orderError) {
      hint = '付款已到账，结算尚未完成，请重试。';
    } else if (order.commissionUsdc === '0') {
      hint = '当前锁定比例不产生返佣。';
    } else if (payout?.status === 'completed') {
      hint = '已到账，可到「结算记录」查看回执。';
    } else {
      hint = '测试 USDC 已到账，佣金将付到本单收款钱包。';
    }
  } else {
    hint = pending
      ? bound
        ? '不会向买家扣款。'
        : authEnabled
          ? '请推广者登录并绑定收款钱包。'
          : '请先到「我的收益」绑定收款钱包。'
      : orderError
        ? '支付已确认，结算尚未完成，请重试。'
        : order.commissionUsdc === '0'
          ? '当前锁定比例不产生返佣。'
          : payout?.status === 'completed'
            ? '已到账，可到「结算记录」查看回执。'
            : '佣金已记入，随后付到本单收款钱包。';
  }
  const amountLabel = x402
    ? (incomingDone ? '已付 ' : '应付 ') + x402UsdcLabel(order.paymentAmountMinor)
    : '实付 ' + usdMinor(order.paymentAmountMinor) + ' USD';
  const buttonText = x402
    ? x402PayButtonText(order, {
        uncertain: payloads && payloads.has(order.requestId),
      })
    : pending
      ? '模拟支付成功'
      : '继续结算';
  return {
    x402,
    canPay,
    payDisabled,
    statusLabel,
    rateText,
    commissionText,
    hint,
    amountLabel,
    buttonText,
    orderError,
    incomingHash: payment && payment.txHash,
  };
}
