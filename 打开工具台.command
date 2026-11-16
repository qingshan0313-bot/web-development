#!/bin/bash
# macOS Finder launcher; compatible with the system Bash 3.2.

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
frame_pid=""
frame_url="http://127.0.0.1:4173/"

fail() {
  printf '\n%s\n' "$1"
  printf '按回车关闭此窗口。'
  read -r frame_answer
  exit 1
}

cd -- "$(dirname -- "$0")" || fail '无法打开工具台所在文件夹。'
if [ ! -f server.mjs ] || [ ! -f src/index.html ]; then
  fail '项目文件不完整。请解压整个工具台文件夹，不要单独移动启动文件。'
fi

frame_node="$(command -v node)"
if [ -z "$frame_node" ]; then
  fail '未找到 Node.js。请先安装 Node.js 的 LTS 版本，然后重新双击此文件。'
fi
frame_node_major="$("$frame_node" -p 'Number(process.versions.node.split(".")[0])')" || fail 'Node.js 无法运行，请检查安装。'
if [ "$frame_node_major" -lt 18 ]; then
  fail 'Node.js 版本过旧。工具台需要 Node.js 18 或以上，请安装 LTS 版本。'
fi

frame_ready() {
  local frame_page
  frame_page="$(/usr/bin/curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 1 "$frame_url")" || return 1
  [[ "$frame_page" == *'<title>Frame — 素材工具台</title>'* ]]
}

open_frame() {
  printf '\n工具台地址：%s\n' "$frame_url"
  /usr/bin/open "$frame_url" || printf '浏览器未能自动打开，请复制上面的地址到浏览器。\n'
}

if frame_ready; then
  printf '工具台已在运行，正在打开网页。\n'
  open_frame
  exit 0
fi

cleanup() {
  if [ -n "$frame_pid" ] && kill -0 "$frame_pid" 2>/dev/null; then
    kill "$frame_pid" 2>/dev/null
    wait "$frame_pid" 2>/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

printf '正在启动 Frame 素材工具台……\n'
"$frame_node" server.mjs --dev --host 127.0.0.1 --port 4173 &
frame_pid=$!
frame_attempt=0
while [ "$frame_attempt" -lt 40 ]; do
  if ! kill -0 "$frame_pid" 2>/dev/null; then
    wait "$frame_pid" 2>/dev/null
    frame_pid=""
    fail '启动失败，请查看上面的错误。若端口 4173 被其他程序占用，请先关闭对应程序后重试。'
  fi
  if frame_ready; then
    printf '启动成功。使用期间请保留此终端窗口；按 Control+C 可停止服务。\n'
    open_frame
    wait "$frame_pid"
    frame_status=$?
    frame_pid=""
    if [ "$frame_status" -ne 0 ]; then
      fail '工具台服务已退出，请查看上面的错误后重新打开。'
    fi
    exit 0
  fi
  frame_attempt=$((frame_attempt + 1))
  sleep 0.25
done

cleanup
frame_pid=""
fail '工具台未能及时启动，请查看上面的错误后重试。'
