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

function readError(result, fallback) {
  if (result && typeof result.error === 'string' && result.error)
    return result.error;
  if (result && typeof result.message === 'string' && result.message)
    return result.message;
  return fallback;
}

export async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createPartnerApi({ getGeneration, onUnauthorized }) {
  async function request(path, data) {
    const generation = getGeneration();
    const response = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    let result;
    try {
      result = await readResponseJson(response);
    } catch {
      throw new Error('服务没有返回有效结果，请重试。');
    }
    if (
      response.status === 401 &&
      path !== '/api/auth/login' &&
      generation === getGeneration()
    ) {
      const message = readError(result, '登录已过期，请重新登录。');
      if (typeof onUnauthorized === 'function') onUnauthorized(message);
      throw new Error(message);
    }
    if (!response.ok)
      throw new Error(readError(result, '请求未成功，请重试。'));
    return result;
  }

  return { request };
}
