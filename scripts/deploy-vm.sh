#!/usr/bin/env bash
# Deploy Inside Sales em Ubuntu (VM intc02)
set -euo pipefail

APP_DIR="${1:-$HOME/insideSales-main}"
PORT="${PORT:-3000}"

echo "==> Pasta do app: $APP_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "==> Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Node $(node -v) | npm $(npm -v)"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Instalando PM2..."
  sudo npm install -g pm2
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "ERRO: arquivo .env não encontrado em $APP_DIR"
  echo "Copie o .env da sua máquina: scp .env adminteratell@10.172.101.25:~/insideSales-main/.env"
  exit 1
fi

echo "==> Instalando dependências..."
npm ci 2>/dev/null || npm install

echo "==> Build de produção..."
set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a
export NODE_ENV=production
npm run build

echo "==> Subindo com PM2 na porta $PORT..."
pm2 delete insidesales 2>/dev/null || true
PORT=$PORT pm2 start npm --name insidesales -- start
pm2 save

echo ""
echo "Deploy concluído!"
if [ -n "${NEXT_PUBLIC_APP_URL:-}" ]; then
  echo "  App: $NEXT_PUBLIC_APP_URL"
else
  echo "  App: http://$(hostname -I | awk '{print $1}'):$PORT"
fi
echo "  Logs: pm2 logs insidesales"
echo "  Status: pm2 status"
echo ""
echo "Para iniciar no boot: pm2 startup && pm2 save"
