#!/usr/bin/env bash
# Git 方式部署：让服务器从 Git 仓库拉取最新代码并重启
#
# 用法：
#   SERVER=root@1.2.3.4 ./deploy-git.sh
#   SERVER=root@1.2.3.4 BRANCH=main ./deploy-git.sh
#
# 前置：服务器上已经 git clone 过仓库，并配好 ecosystem.config.js（见 README）
#
# 关键点：用 `git reset --hard origin/<分支>` 把代码强制对齐仓库，
#        但不删除未跟踪文件 —— 所以 users.json、.session_secret、
#        ecosystem.config.js 这些被 gitignore 的数据会原样保留。
set -euo pipefail

SERVER="${SERVER:?请先设置 SERVER，例如：SERVER=root@1.2.3.4 ./deploy-git.sh}"
DIR="${DIR:-/opt/creovision}"
BRANCH="${BRANCH:-main}"

echo "→ 目标：$SERVER:$DIR （分支 $BRANCH）"

ssh "$SERVER" "set -e
  cd '$DIR'
  if [ ! -d .git ]; then
    echo '错误：该目录还不是 git 仓库，请先 git clone（见 README）'
    exit 1
  fi
  # 1. 备份账号数据
  mkdir -p backups
  if [ -f users.json ]; then
    cp users.json backups/users.json.\$(date +%Y%m%d_%H%M%S)
    echo '  已备份 users.json'
    ls -1t backups/users.json.* 2>/dev/null | tail -n +6 | xargs -r rm -f
  fi
  # 2. 拉取代码并强制对齐（不影响被 gitignore 的数据文件）
  git fetch origin '$BRANCH'
  git reset --hard 'origin/$BRANCH'
  # 3. 重启
  pm2 restart creovision || pm2 start ecosystem.config.js
  pm2 save
  # 4. 健康检查
  sleep 1
  curl -s -m 5 http://127.0.0.1:3077/api/health || echo '健康检查失败：pm2 logs creovision'
"

echo "✅ 部署完成"
