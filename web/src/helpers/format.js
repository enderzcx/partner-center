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

export const PAYOUT_STATUSES = {
  reserved: '待付款',
  prepared: '准备发送',
  broadcast: '等待确认',
  confirmed: '已到账，更新中',
  completed: '已完成',
  blocked: '需要处理',
};

export function units(value, digits = 6, places = 2) {
  if (value === undefined || value === null || String(value).trim() === '')
    return '暂无数据';
  try {
    const n = BigInt(value);
    const base = 10n ** BigInt(digits);
    const fraction = (n % base).toString().padStart(digits, '0');
    return (n / base).toLocaleString('en-US') + '.' + fraction.slice(0, places);
  } catch {
    return '暂无数据';
  }
}

export function usdMinor(value) {
  if (value === undefined || value === null || String(value).trim() === '')
    return '暂无数据';
  if (!/^(10000|[1-9][0-9]{0,3})$/.test(String(value))) return '暂无数据';
  const cents = Number(value);
  const whole = Math.trunc(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return whole.toLocaleString('en-US') + '.' + frac;
}

export function precise(value) {
  if (value === undefined || value === null || String(value).trim() === '')
    return '暂无数据';
  try {
    const n = BigInt(value);
    const f = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
    return (n / 1000000n).toLocaleString('en-US') + (f ? '.' + f : '.00');
  } catch {
    return '暂无数据';
  }
}

export function parseCommissionRate(value) {
  return typeof value === 'string' &&
    /^(0(\.[0-9]{1,18})?|1(\.0{1,18})?)$/.test(value)
    ? value
    : null;
}

export function formatCommissionPercent(rate) {
  if (parseCommissionRate(rate) == null) return null;
  const [intPart, frac = ''] = rate.split('.');
  if (intPart === '1') return '100';
  const padded = frac.padEnd(2, '0');
  const whole = padded.slice(0, 2).replace(/^0+(?=\d)/, '') || '0';
  const rest = padded.slice(2).replace(/0+$/, '');
  return rest ? whole + '.' + rest : whole;
}

export function isZeroCommissionRate(rate) {
  return /^0(\.0+)?$/.test(rate);
}

export function micro(input) {
  const s = String(input || '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s))
    throw new Error('请输入大于 0 的金额，最多 6 位小数。');
  const [a, b = ''] = s.split('.');
  const n = BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0'));
  if (n <= 0n) throw new Error('金额需大于 0。');
  return n.toString();
}

export function short(value) {
  const s = String(value || '');
  return s.length > 20 ? s.slice(0, 8) + '…' + s.slice(-6) : s;
}

export function time(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '时间待确认'
    : d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}

export function isTxHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || ''));
}

export function isAddressLike(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ''));
}

export function statusClass(status) {
  if (status === 'completed') return 'good';
  if (status === 'blocked') return 'warn';
  return '';
}

export function fujiExplorerTx(hash) {
  return 'https://testnet.snowtrace.io/tx/' + encodeURIComponent(hash);
}

export function networkLabel(chainId) {
  return Number(chainId) === 43113 ? 'Fuji 测试网' : '本地测试网';
}

export function rateCopy(commission) {
  const rate = commission ? parseCommissionRate(commission.rate) : null;
  const source =
    commission && typeof commission.rateSource === 'string'
      ? commission.rateSource
      : 'unavailable';
  const percent = rate != null ? formatCommissionPercent(rate) : null;
  let badge = '';
  if (rate != null && source === 'demo') badge = '演示规则';
  else if (rate != null && source === 'override') badge = '专属比例';
  else if (rate != null && (source === 'default' || source === 'disabled'))
    badge = '当前比例';
  if (rate == null || percent == null || source === 'unavailable') {
    return {
      value: '无法读取',
      rule: '当前比例暂无法读取。',
      limit: '已有付款金额不变。',
      badge,
      example: '',
    };
  }
  if (isZeroCommissionRate(rate)) {
    return {
      value: percent + '%',
      rule: '当前不产生新返佣。',
      limit: '已生成的付款会继续处理。',
      badge,
      example: '',
    };
  }
  return {
    value: percent + '%',
    rule: '按实际支付金额计算。比例在下单时确定，之后调整不影响已有订单。',
    limit: '赠送、试用与收益转入不计返佣。',
    badge,
    example: percent === '10' ? '示例：实付 100 USD，返佣 10 USD' : '',
  };
}
