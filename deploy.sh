#!/usr/bin/env bash
# 一键部署：把本地代码同步到服务器并重启服务
#
# 用法：
#   SERVER=root@1.2.3.4 ./deploy.sh              # 正式部署
#   SERVER=root@1.2.3.4 ./deploy.sh --dry-run    # 演练：只看会改哪些文件，不真正上传
#   SERVER=root@1.2.3.4 DIR=/opt/creovision ./deploy.sh
#
# 设计原则：只更新「代码」，绝不碰服务器上的「数据」
#   不同步：config.json（Key）、users.json（账号）、.session_secret（登录态密钥）、backups/
#   不删除：服务器上任何文件都不会被删（--no-delete）
#   自动备份：每次部署前把 users.json 存一份到 backups/，保留最近 5 份
set -euo pipefail

SERVER="${SERVER:?请先设置 SERVER，例如：SERVER=root@1.2.3.4 ./deploy.sh}"
DIR="${DIR:-/opt/creovision}"
DRY=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY="-n"
  echo "【演练模式】只显示将要变更的文件，不会真正上传或重启"
fi

echo "→ 目标：$SERVER:$DIR"

# 1. 确保目录存在
ssh "$SERVER" "mkdir -p '$DIR'"

# 2. 备份服务器上的账号数据（每次部署前）
if [ -z "$DRY" ]; then
  echo "→ 备份账号数据…"
  ssh "$SERVER" "cd '$DIR' && mkdir -p backups && \
    if [ -f users.json ]; then cp users.json backups/users.json.\$(date +%Y%m%d_%H%M%S); echo '  已备份 users.json'; else echo '  尚无 users.json，跳过'; fi; \
    ls -1t backups/users.json.* 2>/dev/null | tail -n +6 | xargs -r rm -f"
fi

# 3. 同步代码（排除密钥与账号数据）
echo "→ 同步文件…"
# rsync 默认不删除目标端任何文件（不使用 --delete*）
rsync -avz $DRY \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'backups' \
  --exclude 'config.json' \
  --exclude 'ecosystem.config.js' \
  --exclude 'users.json' \
  --exclude '.session_secret' \
  --exclude 'server.log' \
  --exclude '.DS_Store' \
  ./ "$SERVER:$DIR/"

if [ -n "$DRY" ]; then
  echo "✅ 演练结束（未做任何改动）"
  exit 0
fi

# 4. 重启服务
echo "→ 重启服务…"
ssh "$SERVER" "cd '$DIR' && (pm2 restart creovision || pm2 start ecosystem.config.js) && pm2 save"

# 5. 健康检查
echo "→ 健康检查…"
ssh "$SERVER" "sleep 1; curl -s -m 5 http://127.0.0.1:3077/api/health || echo '健康检查失败，请查看：pm2 logs creovision'"

echo "✅ 部署完成"
