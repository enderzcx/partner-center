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

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPartnerApi } from '../helpers/api';
import { createStableX402Pay, resetX402Payloads } from '../helpers/x402';

export const AUTH_PENDING = 'pending';
export const AUTH_LOGGED_OUT = 'loggedout';
export const AUTH_AUTHENTICATED = 'authenticated';

const PartnerContext = createContext(null);

export function PartnerProvider({ children }) {
  const [authStatus, setAuthStatus] = useState(AUTH_PENDING);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [role, setRole] = useState(null);
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [syncLabel, setSyncLabel] = useState('尚未连接');

  const generationRef = useRef(0);
  const fetchingRef = useRef(false);
  const fetchingGenerationRef = useRef(-1);
  const authStatusRef = useRef(authStatus);
  const authEnabledRef = useRef(authEnabled);
  const stateRef = useRef(state);
  const busyRef = useRef(busy);
  const loginBusyRef = useRef(loginBusy);
  const x402PayloadsRef = useRef(new Map());
  const ioRef = useRef({});

  authStatusRef.current = authStatus;
  authEnabledRef.current = authEnabled;
  stateRef.current = state;
  busyRef.current = busy;
  loginBusyRef.current = loginBusy;

  const bumpGeneration = useCallback(() => {
    generationRef.current += 1;
    resetX402Payloads(x402PayloadsRef.current);
  }, []);

  const showLoggedOut = useCallback(
    (message) => {
      bumpGeneration();
      authStatusRef.current = AUTH_LOGGED_OUT;
      setRole(null);
      setState(null);
      setAuthStatus(AUTH_LOGGED_OUT);
      setLoginError(message || '');
      setNotice(null);
      setSyncLabel('尚未连接');
    },
    [bumpGeneration],
  );

  const api = useMemo(
    () =>
      createPartnerApi({
        getGeneration: () => generationRef.current,
        onUnauthorized: (message) => showLoggedOut(message),
      }),
    [showLoggedOut],
  );

  ioRef.current = {
    getAuthGeneration: () => generationRef.current,
    getOrigin: () => window.location.origin,
    getX402: () => (stateRef.current && stateRef.current.x402) || null,
    getNetworkChainId: () =>
      Number(stateRef.current && stateRef.current.network && stateRef.current.network.chainId),
    onUnauthorized: (message) => showLoggedOut(message),
  };

  const x402Pay = useMemo(
    () =>
      createStableX402Pay({
        payloads: x402PayloadsRef.current,
        fetch: (input, init) => fetch(input, init),
        getProvider: () => window.ethereum,
        now: () => Date.now(),
        getOrigin: () => ioRef.current.getOrigin(),
        getX402: () => ioRef.current.getX402(),
        getNetworkChainId: () => ioRef.current.getNetworkChainId(),
        getAuthGeneration: () => ioRef.current.getAuthGeneration(),
        onUnauthorized: (message) => ioRef.current.onUnauthorized(message),
      }),
    [],
  );

  const applyState = useCallback((next) => {
    setState(next);
    if (next && (next.role === 'merchant' || next.role === 'promoter')) {
      setRole(next.role);
    }
    setSyncLabel(
      '已同步 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    );
  }, []);

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    if (fetchingRef.current && fetchingGenerationRef.current === generation)
      return;
    if (
      authEnabledRef.current &&
      authStatusRef.current !== AUTH_AUTHENTICATED
    )
      return;
    fetchingRef.current = true;
    fetchingGenerationRef.current = generation;
    try {
      const nextState = await api.request('/api/state');
      if (generation !== generationRef.current) return;
      applyState(nextState);
    } catch (error) {
      if (generation !== generationRef.current) return;
      if (
        authEnabledRef.current &&
        authStatusRef.current !== AUTH_AUTHENTICATED
      )
        throw error;
      setNotice({ text: '同步失败：' + error.message, error: true });
      setSyncLabel(stateRef.current ? '数据未更新，请重试' : '尚未连接');
      throw error;
    } finally {
      if (fetchingGenerationRef.current === generation) {
        fetchingRef.current = false;
      }
    }
  }, [api, applyState]);

  const login = useCallback(
    async (username, password) => {
      if (loginBusyRef.current) return;
      const name = String(username || '').trim();
      const pass = String(password || '');
      if (!name || !pass) {
        setLoginError('请填写账号和密码。');
        return;
      }
      setLoginBusy(true);
      setLoginError('');
      try {
        const result = await api.request('/api/auth/login', {
          username: name,
          password: pass,
        });
        bumpGeneration();
        authEnabledRef.current = true;
        authStatusRef.current = AUTH_AUTHENTICATED;
        setState(null);
        setAuthEnabled(true);
        setAuthStatus(AUTH_AUTHENTICATED);
        setRole(
          result.role === 'merchant' || result.role === 'promoter'
            ? result.role
            : null,
        );
        await refresh();
      } catch (error) {
        setLoginError(error.message || '账号或密码不正确。');
        setAuthStatus(AUTH_LOGGED_OUT);
        setRole(null);
        setState(null);
      } finally {
        setLoginBusy(false);
      }
    },
    [api, bumpGeneration, refresh],
  );

  const logout = useCallback(async () => {
    if (busyRef.current || loginBusyRef.current) return;
    setLoginBusy(true);
    try {
      await api.request('/api/auth/logout', {});
      showLoggedOut('');
    } catch (error) {
      setNotice({ text: error.message, error: true });
    } finally {
      setLoginBusy(false);
    }
  }, [api, showLoggedOut]);

  const runAction = useCallback(
    async (task, message) => {
      if (busyRef.current) return;
      setBusy(true);
      try {
        await task();
        await refresh();
        if (message) setNotice({ text: message, error: false });
      } catch (error) {
        if (authStatusRef.current !== AUTH_AUTHENTICATED && authEnabledRef.current)
          return;
        setNotice({ text: error.message, error: true });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const payX402 = useCallback(
    async (order) => {
      if (busyRef.current) return;
      setBusy(true);
      try {
        const outcome = await x402Pay.pay(order);
        if (authEnabledRef.current && authStatusRef.current !== AUTH_AUTHENTICATED)
          return;
        await refresh();
        if (authEnabledRef.current && authStatusRef.current !== AUTH_AUTHENTICATED)
          return;
        if (outcome.kind === 'completed')
          setNotice({ text: '测试 USDC 付款已完成。', error: false });
        else if (outcome.kind === 'processing')
          setNotice({ text: '付款正在确认。', error: false });
        else setNotice({ text: '付款结果已更新。', error: false });
      } catch (error) {
        if (authEnabledRef.current && authStatusRef.current !== AUTH_AUTHENTICATED)
          return;
        setNotice({ text: error.message, error: true });
      } finally {
        setBusy(false);
      }
    },
    [refresh, x402Pay],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await api.request('/api/auth/session');
        if (cancelled) return;
        const enabled = !!session.authEnabled;
        authEnabledRef.current = enabled;
        setAuthEnabled(enabled);
        if (enabled && !session.authenticated) {
          authStatusRef.current = AUTH_LOGGED_OUT;
          setAuthStatus(AUTH_LOGGED_OUT);
          return;
        }
        if (
          enabled &&
          (session.role === 'merchant' || session.role === 'promoter')
        ) {
          setRole(session.role);
        }
        authStatusRef.current = AUTH_AUTHENTICATED;
        setAuthStatus(AUTH_AUTHENTICATED);
        await refresh();
      } catch (error) {
        if (cancelled) return;
        if (authEnabledRef.current) showLoggedOut(error.message);
        else setNotice({ text: '同步失败：' + error.message, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, refresh, showLoggedOut]);

  useEffect(() => {
    const tick = () => {
      if (
        busyRef.current ||
        loginBusyRef.current ||
        document.hidden ||
        (authEnabledRef.current &&
          authStatusRef.current !== AUTH_AUTHENTICATED)
      )
        return;
      refresh().catch(() => {});
    };
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const value = useMemo(
    () => ({
      authStatus,
      authEnabled,
      role,
      state,
      notice,
      loginError,
      busy,
      loginBusy,
      syncLabel,
      x402Payloads: x402PayloadsRef.current,
      login,
      logout,
      refresh,
      runAction,
      payX402,
      api,
      setNotice,
      setLoginError,
    }),
    [
      api,
      authEnabled,
      authStatus,
      busy,
      login,
      loginBusy,
      loginError,
      logout,
      notice,
      payX402,
      refresh,
      role,
      runAction,
      state,
      syncLabel,
    ],
  );

  return (
    <PartnerContext.Provider value={value}>{children}</PartnerContext.Provider>
  );
}

export function usePartner() {
  const value = useContext(PartnerContext);
  if (!value) throw new Error('Partner context is missing');
  return value;
}
