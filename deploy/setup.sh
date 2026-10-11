#!/bin/bash
# Puts the Know & Go game on a fresh Ubuntu server (written for a Vultr instance) and keeps it
# running. Run it as root. It is safe to run again: it then fetches the newest code and
# restarts the game.
#
#   curl -fsSL https://raw.githubusercontent.com/kuhrced/Orion-Hackathon/clark-fixes-on-0.05/deploy/setup.sh | bash
#
# The game then answers on port 80: open http://<server address>/host for the big screen.
# The API keys are NOT part of this script. Copy your own .env to /opt/know-and-go/.env
# afterwards (see ReadMe.md, "Put it online").
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export HOME="${HOME:-/root}"
export PATH="/usr/local/bin:$PATH"

REPO=https://github.com/kuhrced/Orion-Hackathon.git
BRANCH="${BRANCH:-clark-fixes-on-0.05}"
DIR=/opt/know-and-go
NODE_LINE=latest-v22.x # the game needs Node.js 20.12 or newer; Ubuntu's own package is older

echo "== 1/5  tools"
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  # A new server may still be updating itself: wait for it instead of failing.
  apt-get -o DPkg::Lock::Timeout=300 update -y
  apt-get -o DPkg::Lock::Timeout=300 install -y git curl ca-certificates
fi

echo "== 2/5  Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) echo "This script does not know the processor type $(uname -m)."; exit 1 ;;
  esac
  cd /tmp
  curl -fsSLO "https://nodejs.org/dist/$NODE_LINE/SHASUMS256.txt"
  FILE=$(grep -m 1 -o "node-v[0-9.]*-linux-$ARCH\.tar\.gz" SHASUMS256.txt)
  curl -fsSLO "https://nodejs.org/dist/$NODE_LINE/$FILE"
  grep " $FILE\$" SHASUMS256.txt | sha256sum -c - # the download is whole
  rm -rf /opt/node
  mkdir -p /opt/node
  tar -xzf "$FILE" -C /opt/node --strip-components=1
  for tool in node npm npx; do ln -sf "/opt/node/bin/$tool" "/usr/local/bin/$tool"; done
  rm -f "$FILE" SHASUMS256.txt
fi
echo "Node.js $(node --version)"

echo "== 3/5  the game"
if [ -d "$DIR/.git" ]; then
  # Already here: take the newest code. Files Git does not track (.env, the player memory) stay.
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR" || git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
npm install --omit=dev --no-audit --no-fund

echo "== 4/5  keep it running"
cat > /etc/systemd/system/know-and-go.service <<UNIT
[Unit]
Description=Know & Go racing quiz game
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
Environment=PORT=80
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable know-and-go.service
systemctl restart know-and-go.service

echo "== 5/5  let phones in"
if command -v ufw >/dev/null; then ufw allow 80/tcp || true; fi

sleep 3
if curl -fsS -o /dev/null --max-time 5 http://localhost/; then
  ADDRESS=$(hostname -I | awk '{print $1}')
  echo
  echo "The game is running."
  echo "  Big screen:  http://$ADDRESS/host"
  echo "  Front page:  http://$ADDRESS/"
  [ -f "$DIR/.env" ] || echo "  No API keys yet: copy your .env to $DIR/.env and run: systemctl restart know-and-go"
  echo "  To watch it: journalctl -u know-and-go -f"
else
  echo "The game did not answer. Its last lines:"
  journalctl -u know-and-go -n 25 --no-pager || true
  exit 1
fi
