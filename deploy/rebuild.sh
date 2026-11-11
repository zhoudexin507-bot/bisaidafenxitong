#!/usr/bin/env bash
# 打分系统 —— 服务器端重建脚本（在服务器 /opt/jingheng 内执行）
# 前置：新代码已上传并覆盖完毕（本项目线上目录不是 git 仓库，不走 git pull）
# 用法：bash deploy/rebuild.sh

set -euo pipefail
cd "${1:-/opt/jingheng}"

echo "== 0. 前置检查 =="
pwd
test -f .env || { echo "缺少 .env，终止"; exit 1; }
test -f compose.yaml || { echo "缺少 compose.yaml，终止"; exit 1; }

echo "== 1. 备份数据库（在线 Backup API，含 WAL 未合并记录）=="
docker compose exec -T app npm run backup </dev/null

echo "== 2. 重建镜像并替换容器 =="
docker compose config --quiet
docker compose up -d --build

echo "== 3. 等待就绪并健康检查 =="
for i in $(seq 1 40); do
  if docker compose exec -T app node --input-type=module \
      -e "const r = await fetch('http://127.0.0.1:3001/api/health'); if (!r.ok) process.exit(1); console.log(await r.text())" \
      </dev/null 2>/dev/null; then
    echo "健康检查通过"
    break
  fi
  [ "$i" -eq 40 ] && { echo "健康检查超时，查看：docker compose logs --tail=100 app"; exit 1; }
  sleep 2
done

echo "== 4. 状态与日志 =="
docker compose ps
docker compose logs --tail=30 app

echo "== 完成：请用手机移动网络打开域名复核 HTTPS 与管理员登录 =="
