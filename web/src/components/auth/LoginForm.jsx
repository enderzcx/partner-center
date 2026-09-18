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
import { Button, Card, Form } from '@douyinfe/semi-ui';
import Title from '@douyinfe/semi-ui/lib/es/typography/title';
import { IconLock, IconUser } from '@douyinfe/semi-icons';
import GlobalAuthFrame from './GlobalAuthFrame';
import GlobalBrandMark from '../common/logo/GlobalBrandMark';
import { usePartner } from '../../context/Partner';

const LoginForm = () => {
  const { login, loginBusy, loginError, setLoginError } = usePartner();

  return (
    <GlobalAuthFrame mode='login'>
      <div className='global-auth-render'>
        <div className='global-auth-form-inner'>
          <div className='global-auth-inline-brand'>
            <GlobalBrandMark />
            <Title heading={3}>伙伴中心</Title>
          </div>
          <Card className='global-auth-card'>
            <div className='global-auth-card-title'>
              <Title heading={3}>登录</Title>
            </div>
            <Form
              className='partner-login-form'
              onSubmit={(values) =>
                login(values.username, values.password)
              }
            >
              <Form.Input
                field='username'
                label='账号'
                placeholder='请输入账号'
                autoComplete='username'
                maxLength={64}
                onChange={() => {
                  if (loginError) setLoginError('');
                }}
                prefix={<IconUser />}
              />
              <Form.Input
                field='password'
                label='密码'
                placeholder='请输入密码'
                autoComplete='current-password'
                mode='password'
                maxLength={256}
                onChange={() => {
                  if (loginError) setLoginError('');
                }}
                prefix={<IconLock />}
              />
              {loginError ? (
                <p className='partner-login-error' role='alert'>
                  {loginError}
                </p>
              ) : (
                <p className='partner-login-hint'>资金无实际价值</p>
              )}
              <Button
                htmlType='submit'
                theme='solid'
                type='primary'
                className='global-auth-submit'
                loading={loginBusy}
                disabled={loginBusy}
                block
              >
                登录
              </Button>
            </Form>
          </Card>
        </div>
      </div>
    </GlobalAuthFrame>
  );
};

export default LoginForm;
