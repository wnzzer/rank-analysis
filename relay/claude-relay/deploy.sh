#!/usr/bin/env bash
# 部署 / 更新 Claude 中转到 Oracle（ssh host 别名 oracle）
# 首次部署后需手动：写 /etc/claude-relay.env（参考 claude-relay.env.example）、OCI 安全列表放行 PORT
set -euo pipefail
HOST=${HOST:-oracle}
DIR=$(cd "$(dirname "$0")" && pwd)

ssh "$HOST" 'sudo mkdir -p /opt/claude-relay && sudo chown ubuntu:ubuntu /opt/claude-relay'
scp "$DIR/server.py" "$DIR/requirements.txt" "$DIR/claude-relay.service" "$HOST":/opt/claude-relay/
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/claude-relay
dpkg -s python3-venv >/dev/null 2>&1 || sudo apt-get install -y python3-venv
[ -d venv ] || python3 -m venv venv
venv/bin/pip install -q -r requirements.txt
# DB-IP Lite 国家库按月发布；本月的还没出就用上月的
if [ ! -f dbip-country-lite.csv.gz ] || [ -n "$(find dbip-country-lite.csv.gz -mtime +35)" ]; then
  for m in "$(date +%Y-%m)" "$(date -d '-1 month' +%Y-%m)"; do
    curl -fsSL -o dbip.tmp.gz "https://download.db-ip.com/free/dbip-country-lite-$m.csv.gz" && mv dbip.tmp.gz dbip-country-lite.csv.gz && break
  done
fi
# 本机防火墙放行（Oracle Ubuntu 镜像默认 iptables REJECT 非 22 端口）
PORT=$(sudo grep -E '^PORT=' /etc/claude-relay.env 2>/dev/null | cut -d= -f2 || true)
PORT=${PORT:-8787}
sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || {
  sudo iptables -I INPUT 5 -p tcp --dport "$PORT" -j ACCEPT
  sudo netfilter-persistent save >/dev/null 2>&1 || true
}
sudo cp claude-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable claude-relay >/dev/null
sudo systemctl restart claude-relay
sleep 1
systemctl is-active claude-relay
REMOTE
