#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  task_node_dir="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$task_node_dir/node" ]]; then
    export PATH="$task_node_dir:$PATH"
  else
    print '找不到 Node.js。请先准备开发环境。'
    read -k 1
    exit 1
  fi
fi
export NARUTO_DAMO_ASSIST=1
node scripts/build.mjs
node scripts/build-native-prototype.mjs
node scripts/start-native-prototype.mjs --live --direct
