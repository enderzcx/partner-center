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

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Loading from '../components/common/ui/Loading';
import {
  AUTH_AUTHENTICATED,
  AUTH_PENDING,
  usePartner,
} from '../context/Partner';

export function PrivateRoute({ children }) {
  const { authStatus, authEnabled } = usePartner();
  const location = useLocation();
  if (authStatus === AUTH_PENDING) return <Loading />;
  if (authEnabled && authStatus !== AUTH_AUTHENTICATED) {
    return <Navigate to='/login' replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function PublicOnlyRoute({ children }) {
  const { authStatus, authEnabled } = usePartner();
  if (authStatus === AUTH_PENDING) return <Loading />;
  if (authEnabled && authStatus === AUTH_AUTHENTICATED) {
    return <Navigate to='/console' replace />;
  }
  return children;
}

export function RoleRoute({ role, children }) {
  const { authStatus, authEnabled, role: current } = usePartner();
  const location = useLocation();
  if (authStatus === AUTH_PENDING) return <Loading />;
  if (authEnabled && authStatus !== AUTH_AUTHENTICATED) {
    return <Navigate to='/login' replace state={{ from: location.pathname }} />;
  }
  if (authEnabled && current && current !== role) return <Navigate to='/console' replace />;
  return children;
}
