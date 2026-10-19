#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  print "Install Node.js 24.19 or later, then reopen this launcher."
  read "?Press Enter to close."
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci --cache .npm-cache
fi
npm run build
print "Open http://localhost:8080/ in your browser. Keep this terminal open."
npm start
