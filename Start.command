#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '請先到 https://nodejs.org 安裝 Node.js 22 或更新版本，再重新開啟。'
  read -r '?按 Enter 結束。'
  exit 1
fi
if ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; then
  echo 'Node.js 版本太舊。請安裝 22 或更新版本。'
  read -r '?按 Enter 結束。'
  exit 1
fi
if [[ ! -f node_modules/wrangler/bin/wrangler.js ]]; then
  echo '第一次啟動，正在安裝必要套件，請保持網路連線…'
  npm ci || { read -r '?安裝失敗，請確認網路。按 Enter 結束。'; exit 1; }
fi
node scripts/ui.mjs
read -r '?設定工具已關閉。按 Enter 結束。'
