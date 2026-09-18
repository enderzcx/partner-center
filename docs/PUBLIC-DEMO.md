# 伙伴中心 · 对外测试演示

目标地址：`https://partner.bflabs.app`。单商家、单推广者的 Fuji 测试演示，不接入生产支付或主网。

## 运行边界

- Nginx 独立虚拟主机处理 HTTPS，代理到 `127.0.0.1:4316`。应用仅信任配置的规范 Host/Origin，不将转发头当作授权依据。
- 一个受监督的 Bun 入口启动独立 Go 演示来源 `127.0.0.1:18784` 和结算服务。Go 来源不再通过测试二进制运行，不设24小时退出。
- Docker 使用 Linux host network；仅 Nginx 对外监听。应用和来源都只监听回环地址。源数据库、执行数据库在独立 `/data` 卷，绝不使用现有 BeefAPI 数据库。
- merchant / promoter 密码仅存哈希。原本地匿名会话不可取得公网权限；角色必须由服务端会话决定。
- 秘密通过只读文件挂载到 `/run/secrets/partner-demo.json`，不写进镜像、Git、日志或前端。此文件包含测试签名私钥、独立来源令牌、两个密码哈希。明文登录信息只保留在宿主私有交付文件中。

## 构建与启动

```sh
BEEFAPI_SOURCE_DIR=/path/to/reviewed/beefapi PARTNER_IMAGE=partner-demo:release-id bash scripts/build-public-image.sh
PARTNER_IMAGE=partner-demo:release-id docker compose -f deploy/compose.yaml config --quiet
```

服务器独立目录 `/home/ubuntu/partner-demo/` 下放置 compose.yaml、data/、secrets/partner-demo.json。数据与秘密的所有者 UID 1000，目录0700、秘密文件0600；容器非root执行，根文件系统只读。设置精确版本化镜像标签，启动 `docker compose up -d`。不要直接使用 latest 覆盖运行版本。

TLS 使用单独的 `partner.bflabs.app` 证书。首次签发先安装只有80端口与ACME路径的临时站点，证书签发后才安装 `deploy/partner.nginx.conf`。每次变更均执行 `nginx -t`，通过后平滑 reload。

## 数据迁移和回滚

迁移前核对旧来源没有 reserved 结算单，执行器没有在途交易。停止旧 Fuji 执行器及来源，成对备份/迁移 source.sqlite 与 settlement.sqlite，并在关闭连接后检查SQLite完整性。不要同时运行旧、新执行器。禁止用空测试来源搭配旧执行账本。

新服务启动失败时停新容器，保留新旧数据库和日志，回退新增 Nginx 站点到维护响应。确认新实例没有发出交易后，才能恢复旧服务。不得通过重新生成订单、换付款编号或删除账本来恢复未知付款。

## 上线验证

检查有效HTTPS证书、匿名API拒绝、两角色登录/退出、跨角色越权拒绝、精确Origin检查、旧Fuji完成回执与账本一致、容器健康和重启后状态保留。健康端点仅代表服务响应，不代表余额充足或付款完成。

Docker基础采用[官方Bun容器方案](https://bun.sh/guides/ecosystem/docker)，固定1.3.14镜像摘要；镜像中不含开发凭据或本地账本。
