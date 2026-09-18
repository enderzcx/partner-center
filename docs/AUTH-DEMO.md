# 认证演示

本机未开启认证时，行为与原来一致：回环访问、页面切换商家/推广者身份。公网稳定演示需要显式打开认证，并由宿主提供密码哈希；仓库不含默认密码。

## 环境变量

| 名称 | 作用 |
| --- | --- |
| `SETTLEMENT_AUTH_ENABLED` | `true` 开启认证。未设置或 `false` 保持本机演示。 |
| `SETTLEMENT_MERCHANT_PASSWORD_HASH` | 商家账号密码哈希。认证开启时必填。 |
| `SETTLEMENT_PROMOTER_PASSWORD_HASH` | 推广者账号密码哈希。认证开启时必填。 |
| `SETTLEMENT_PUBLIC_ORIGIN` | 可选。精确 HTTPS 来源（不含路径、查询、用户名或密码）。 |

哈希只接受 argon2id / argon2i / argon2d 或 bcrypt。两个账号必须使用不同哈希。账号名固定为 `merchant` 与 `promoter`。

`SETTLEMENT_PUBLIC_ORIGIN` 还要求：认证已开启、链 `43113`、来源 `beefapi`、`SETTLEMENT_ORDER_DEMO=true`、固定推广者 `1`。进程仍只绑定回环；对外主机名由反代原样传入 `Host`。服务只信任该来源，不读取转发头。

未设置公开来源时，认证可用于本机测试，来源仍是回环地址。

## 会话

- `GET /api/auth/session` 返回 `{ authenticated, role, authEnabled }`，不要求已登录。
- `POST /api/auth/login` 提交 `{ username, password }`，成功返回 `{ ok: true, role }`。
- `POST /api/auth/logout` 使当前登录失效。
- Cookie：`HttpOnly`、`SameSite=Strict`；公开来源加 `Secure`；有效期 8 小时。
- `GET /healthz` 只表示进程可响应，不表示出款或账本就绪。

## 权限

认证开启后，未登录不能读取 `/api/state` 或执行变更。订单演示接口以外的本机佣金、测试钱包、划转和自动结算开关不可用。

| 操作 | 商家 | 推广者 |
| --- | --- | --- |
| 创建、确认测试订单 | 允许 | 拒绝 |
| 暂停 / 执行结算 | 允许 | 拒绝 |
| 绑定收款钱包 | 拒绝 | 允许 |
| 查看出款资金余额、操作提示、商家订单 | 允许 | 不返回 |
| 查看自身收益与出款记录 | 允许 | 允许 |

页面在认证开启后按已登录身份显示，不再提供身份切换。
