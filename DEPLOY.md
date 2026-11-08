# 自有云服务器与公网域名部署

本文给出可运行的单机部署方案。代码已提供完整服务；实际公网发布需要用户自己的云服务器登录权限、域名与 DNS 设置。本地预览不等于已完成公网部署。

## 1. 准备

- 一场赛事、30 位评委、1 个管理台和 1 个投屏，正式使用建议选择 **2 vCPU、4 GB 内存、40 GB SSD、10 Mbps 公网出站带宽** 的专用 Linux 云服务器。这里的“专用”指只运行本系统。这是部署建议，实测环境为本机回环网络。
- 运行一个 Node.js 24 应用实例和 Caddy。SQLite 数据卷放在该主机挂载的 SSD 上，另存异机备份。保留 Caddy 对 SSE 的即时转发，让大屏在收齐评分后及时亮分。
- 已安装 Docker Engine 和 Compose 插件：`docker --version`、`docker compose version` 均正常。
- 一个域名，例如 `score.example.com`，DNS A 记录指向服务器公网 IPv4。只有配置了正确 IPv6 才设置 AAAA。
- 云安全组与系统防火墙开放 TCP 80、443；可选 UDP 443（HTTP/3）。**无需开放 3001 或数据库端口**。
- 确认 80 / 443 没有其他服务占用。若已运行统一网关，参见下方反向代理替代方案。

将项目上传到服务器，例如 `/opt/jingheng`，保留 `package-lock.json`，不要上传 `node_modules`、本地 `.env` 或演示数据库。

### 30 位评委的赛前验收

在“赛事设置”将评委人数设为 30，分别发放席位二维码。用比赛当天的无线网络让 30 位评委同时打开评分页，并在测试评分中集中提交。控制台应显示 30 席已提交，每个评委都应看到自己的提交凭证。自动亮分模式下，大屏应立即开始亮分；启用去分时依次标记、剔除极值，并在约 4.3 秒的演示后显示最终分数。手动亮分模式从主持人公布后开始演示。

开发机可运行 `npm run build` 和 `npm run test:e2e -- thirty-judges` 重现并发用例。用例使用独立测试数据库、30 个浏览器会话、一个管理台和一个大屏，验证连续三队共 90 笔写入、去分结果和 1280×720 投屏布局，并输出评分请求延迟和批量提交到亮分的耗时。

## 2. 配置生产环境

在项目目录创建 `.env`：

```dotenv
DOMAIN=score.example.com
ACME_EMAIL=ops@example.com
ADMIN_PASSWORD=填写至少12位的随机强密码
TOKEN_SECRET=填写至少32位的随机密钥
```

可用以下命令分别生成密码和密钥，然后填入 `.env`（不要使用示例字面值）：

```bash
openssl rand -hex 16
openssl rand -hex 48
chmod 600 .env
```

生产 Compose 会自动设置 `PUBLIC_URL=https://你的域名`、`NODE_ENV=production`、`HOST=0.0.0.0`、`TRUST_PROXY=1`。应用仅在 Docker 网络内暴露 3001。

`TOKEN_SECRET` 和数据库一起决定二维码是否有效，**首次投用后保持不变**，并单独安全备份。改变密钥会使全部旧二维码失效。修改管理员环境密码需重建容器；已有登录会话最长仍有效 12 小时。需立即失效时，停止应用并清空数据库 `sessions` 表（见维护操作）。

## 3. 启动

```bash
cd /opt/jingheng
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
```

Caddy 根据域名自动申请和续期 HTTPS 证书。公网 DNS、80 / 443 可达后，打开：

- `https://score.example.com/`：现场大屏
- `https://score.example.com/admin`：管理员登录
- `https://score.example.com/screen`：现场投屏
- `https://score.example.com/admin/ranking`：成绩排名

健康检查：

```bash
curl -fsS https://score.example.com/api/health
# 预期：{"ok":true}
```

首次生产启动为空赛事。按 README 现场流程添加配置、项目与评委。**不要运行 demo 命令导入正式环境**。

## 4. 上线验收

1. 使用手机移动网络打开域名，确认不是仅局域网可达，HTTPS 无证书警告。
2. 登录管理台，配置评委数、项目数、轮次、去分数量和固定名额。评分为单一百分制。
3. 打印前检查 QR 链接域名正确，并由各评委分别扫码。
4. 先在系统的测试评分阶段完成至少一个项目的全部评委提交，检查亮分 → 极值高亮 → 动效剔除 → 巨幅最终分；完成测试后才可开启正式比赛。
5. 断开一台手机网络，填写草稿，再恢复网络重试；确认一次有效记录，不发生重复计分。
6. 验证准备状态不能提交、未齐分数隐藏、单人及批量重评后再次隐藏、旧重试请求被拒绝、换码旧码失效；发布后依次切换排名、团体名单和个人名单。
7. 导出 CSV，用 Excel 检查中文与明细；备份一次，并在隔离环境完成恢复演练。

本地默认配置仅绑定回环地址。若需要局域网手机演练，可将开发 `.env` 的 `HOST` 改为 `0.0.0.0`，`PUBLIC_URL` 改为 `http://电脑局域网IP:3001`，重启服务并开放本机防火墙 3001。仅适用于局域网演练，正式公网使用 HTTPS。

## 5. 持久化与一致性备份

应用数据存于 Compose 命名卷 `score_data`，备份存于 `score_backups`；Caddy 证书存于 `caddy_data`。容器替换或 `docker compose down` 不删除这些卷。**不要运行 `docker compose down -v`，该命令会删除数据卷。**

在线备份使用 SQLite Backup API，包含 WAL 中已提交记录：

```bash
docker compose exec -T app npm run backup
# 输出生成文件的绝对路径
mkdir -p ./offsite-backups
docker compose cp app:/app/backups/. ./offsite-backups/
```

不要在应用运行时只复制 `competition.sqlite` 主文件，因为 WAL 中可能还有未合并记录。不要把 CSV 当作完整备份；CSV 不能恢复评委凭证、权限和会话。

建议每日备份，重要比赛前后各备份一次；将备份和密钥的加密副本保存到另一台机器或受控对象存储。在线备份脚本不会自动删除历史文件，由运维按保留策略清理。备份中包含评分、评委信息与会话哈希，应限制读取权限。

Linux cron 示例（替换路径）：

```cron
0 3 * * * cd /opt/jingheng && /usr/bin/docker compose exec -T app npm run backup >> /var/log/jingheng-backup.log 2>&1
```

上述定时任务只生成本机备份；异地复制需按用户自身存储配置追加。

## 6. 从备份恢复

先停止写入，保留当前库的事故现场，再执行恢复。假设备份已复制到宿主机 `./restore/competition.sqlite`：

```bash
docker compose stop app
mkdir -p ./incident-copy
docker compose cp app:/app/data/. ./incident-copy/

# 单次维护容器使用同一命名卷；删除旧 WAL/SHM，防止与恢复库混用
docker compose run --rm --no-deps --user root \
  -v "$(pwd)/restore:/restore:ro" --entrypoint sh app -c \
  'rm -f /app/data/competition.sqlite-wal /app/data/competition.sqlite-shm && cp /restore/competition.sqlite /app/data/competition.sqlite && chown node:node /app/data/competition.sqlite'

docker compose up -d app
curl -fsS https://score.example.com/api/health
```

恢复后核对项目、分数、个人奖项与审计。为了保留原二维码，必须使用与备份匹配的 `TOKEN_SECRET` 和域名。恢复为备份时点，备份后的提交需按审计 / 现场记录处理，不能假设自动找回。

需要使所有管理员会话立即失效时，在停服维护窗口执行：

```bash
docker compose stop app
docker compose run --rm --no-deps app node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync('/app/data/competition.sqlite'); db.exec('DELETE FROM sessions'); db.close();"
docker compose up -d app
```

## 7. 更新与新一场比赛

更新：先备份，上传新代码，然后 `docker compose up -d --build`。不要覆盖 `.env`、命名卷或密钥。当前会自动创建分阶段、分轮次评分与重评表，将旧评分复制为正式第一轮；保留原记录和签名版本。旧长有效期凭证首次升级会缩短至最多 48 小时。迁移幂等，详见 README 的升级说明。

当前一套部署同时运行一场赛事。管理台“赛事设置 → 归档并新建比赛”会事务归档当前比赛并进入下一场筹备；保留项目和评委名单，旧二维码失效，需重新打印。历史归档可下载 JSON，仍应保留完整数据库备份。需要将旧赛事持续独立展示时，可使用**新目录、新域名 / 子域名、独立 Compose 项目名**部署，从而保留上一场可访问的成绩与二维码记录；每场使用独立密钥：

```bash
docker compose -p jingheng-next up -d --build
```

此命令会新建独立卷，但如果与旧 Compose 的 Caddy 同机运行，会争用 80/443；应使用已有统一网关为新应用配置路由，或停掉旧网关后切换。不要直接同时启动两套占用相同端口的 Caddy。

## 8. 已有 Nginx / Caddy 网关

可去掉本项目 Caddy 服务，给应用增加仅回环暴露：

```yaml
ports:
  - '127.0.0.1:3001:3001'
```

保留 HTTPS `PUBLIC_URL` 与 `TRUST_PROXY=1`。确保只有一层受控代理，并覆盖客户端转发头；不要把应用端口直接暴露公网。

Nginx HTTPS server 块中的代理示例（证书由已有网关配置）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

SSE 需持续连接；禁用代理缓存与缓冲。如果外层还存在 CDN，应为 `/api/*` 禁用缓存，允许长连接。实时推送中断时客户端会重连并以 15 秒轮询补偿。

## 9. 常见问题

现场投屏请在登录后使用 `/admin/present`，按 F 全屏；页面不显示操作按钮。单击 / 空格 / → / PageDown 推进，← / PageUp 回看赛后名单，R 重评，H 查看快捷键。所有比赛和颁奖步骤均在当前页完成；`/screen` 是同步只读画面。部署更新后须重启应用服务，使新增演示 API 生效；无需修改服务器配置或数据库。

| 现象 | 检查与处理 |
|---|---|
| HTTPS 申请失败 | DNS A/AAAA、80/443、安全组、端口占用；查看 Caddy 日志 |
| 手机二维码打不开 | 检查二维码是否指向 localhost；正确设置公网域名后重新打印 |
| 管理员登录后仍提示登录 | 域名与 PUBLIC_URL 一致；生产须 HTTPS；代理传递协议正确 |
| 请求来源不可信 | 页面来源须与 PUBLIC_URL 完全一致（协议、域名、端口），不要从另一域名访问 |
| 评委链接失效 | 检查启用状态、过期时间、是否换码、TOKEN_SECRET 是否变动 |
| 有人缺席无法出分 | 开赛后人数锁定；恢复该评委权限或在核实后发放新码，不能静默删除应评记录 |
| 大屏延迟 | 检查 SSE、代理缓存与缓冲；网络恢复后自动拉取完整状态 |
| 演示点击无反应 | 确认使用 `/admin/present`，并等待全部评委提交及亮分动效结束；最终个人名单最后一页已无下一步 |
| 无法发布成绩 | 所有轮次、项目必须收齐并封存；精确同分需先确认顺序 |
| 容器写入失败 | 检查卷权限，运行用户 UID 1000；勿把只读路径映射到 `/app/data` |
| 登录失败过多 | 15 分钟失败限速窗口后重试；不要关闭公网限速来解决输错密码 |
| 排名看似同分却不同名次 | 显示四舍五入两位小数，排名比较未舍入均分 |

## 10. 技术依据

- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)：数据库与在线备份接口。
- [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)：证书自动签发与续期。
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)：SSE 代理与 flush 配置。

尚未连接用户实际云服务器，公网 DNS、证书签发与目标机器容量需在部署时验收。
