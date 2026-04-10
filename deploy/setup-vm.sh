#!/usr/bin/env bash
# VM bootstrap for claude-playground gitops
# Run from your local machine:
#   ssh -i claude-web root@134.199.151.108 'bash -s' < deploy/setup-vm.sh
set -euo pipefail

REPO_URL="https://github.com/justonepant/claude-playground.git"
REPO_DIR="/srv/app"
INITIAL_BRANCH="claude/init-monorepo-bike-calc-CQWPD"

echo "──────────────────────────────────────────"
echo " Node.js"
echo "──────────────────────────────────────────"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Already installed: $(node --version)"
fi

echo "──────────────────────────────────────────"
echo " PM2"
echo "──────────────────────────────────────────"
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
else
  echo "Already installed: pm2 $(pm2 --version)"
fi

echo "──────────────────────────────────────────"
echo " Clone / update repo"
echo "──────────────────────────────────────────"
if [ -d "$REPO_DIR/.git" ]; then
  echo "Repo exists — fetching latest"
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" checkout "$INITIAL_BRANCH"
  git -C "$REPO_DIR" pull origin "$INITIAL_BRANCH"
else
  git clone "$REPO_URL" "$REPO_DIR"
  git -C "$REPO_DIR" checkout "$INITIAL_BRANCH"
fi

echo "──────────────────────────────────────────"
echo " Webhook secret"
echo "──────────────────────────────────────────"
SECRET_FILE="$REPO_DIR/.webhook-secret"
if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "Generated new secret"
else
  echo "Secret already exists — keeping it"
fi

echo "──────────────────────────────────────────"
echo " App dependencies"
echo "──────────────────────────────────────────"
npm install --omit=dev --prefix "$REPO_DIR/bike-gear-calc"

echo "──────────────────────────────────────────"
echo " PM2 services"
echo "──────────────────────────────────────────"
pm2 delete all 2>/dev/null || true
pm2 start "$REPO_DIR/ecosystem.config.js"
pm2 save

echo "──────────────────────────────────────────"
echo " PM2 startup (survives reboots)"
echo "──────────────────────────────────────────"
pm2 startup systemd -u root --hp /root | tail -1 | bash || \
  echo "(startup hook may already be set — check with: systemctl status pm2-root)"
pm2 save

echo "──────────────────────────────────────────"
echo " Firewall"
echo "──────────────────────────────────────────"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   # keep SSH open!
  ufw allow 80/tcp
  ufw allow 9000/tcp
  ufw --force enable
  ufw status
else
  echo "ufw not found — open ports 80 and 9000 manually in your cloud provider's firewall"
fi

echo ""
echo "════════════════════════════════════════════"
echo " DONE"
echo "════════════════════════════════════════════"
echo ""
echo "Web app:  http://134.199.151.108/"
echo ""
echo "── GitHub webhook settings ─────────────────"
echo "  URL:          http://134.199.151.108:9000/webhook"
echo "  Content type: application/json"
echo "  Events:       Just the push event"
echo "  Secret (copy this exactly):"
echo ""
cat "$SECRET_FILE"
echo ""
echo "─────────────────────────────────────────────"
echo ""
pm2 list
