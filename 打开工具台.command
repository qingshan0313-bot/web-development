#!/bin/zsh
# Finder starts with a minimal PATH; locate common macOS Node installations.
cd -- "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
    nvm use --silent 24 >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1
  fi
fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  print '请先安装 Node.js 24 LTS：https://nodejs.org/'
  print '安装后重新双击本文件，详见「Mac开发说明.md」。'
  read -r '?按回车关闭…'
  exit 1
fi
print 'Frame Mac 开发服务：修改 src 后刷新浏览器即可。'
print '请保持本窗口运行，按 Control+C 停止。'
node server.mjs --dev --open "$@"
result=$?
if (( result != 0 )); then
  print '启动失败。如果端口被占用，可在终端运行：npm run dev:open -- --port 4175'
  read -r '?按回车关闭…'
fi
exit $result
