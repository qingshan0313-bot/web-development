# Frame 素材工具台 · Mac 开发

项目保持原生 HTML / CSS / JavaScript 和 Node.js 结构，支持 Intel 与 Apple Silicon Mac，也保留 Windows 开发命令。

## 快速启动

安装 [Node.js 24 LTS](https://nodejs.org/) 后，双击 `打开工具台.command`。它会启动开发服务并打开默认浏览器，地址为 http://127.0.0.1:4173/ 。视频功能请使用 Chrome 或 Edge；可将终端显示的地址复制到这些浏览器。

终端窗口需要保持运行；停止服务按 **Control+C**。修改 `src/` 后在浏览器按 **Command+R** 刷新。

如果文件失去了执行权限，在项目目录的终端运行 `chmod +x 打开工具台.command`。启动器支持标准 Node 安装、Homebrew、`~/.local/bin` 和 nvm。

## 终端开发

```sh
cd "你的项目目录/frame-material-studio"
node -v
npm run dev:open
```

无需 `npm install`，没有 npm 运行依赖；媒体库及 WASM 已放在 `src/vendor/` 中。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 源码开发服务，端口 4173 |
| `npm run dev:open` | 源码开发服务并打开浏览器 |
| `npm run build` | 将源码构建至 `dist/` |
| `npm run preview` | 预览已构建版本，端口 4174 |
| `npm start` | 构建并启动生产服务，端口由 `PORT` 指定，默认 8080 |

端口占用时运行 `npm run dev:open -- --port 4175`。使用 nvm 时，可先执行 `nvm install` 和 `nvm use`；项目 `.nvmrc` 指定 Node 24。

## 源码与调试

- 修改 `src/`，不要直接修改 `dist/`；预览发布版本前重新执行 `npm run build`。
- 浏览器开发者工具快捷键为 **Option+Command+I**。
- 使用本地 HTTP 地址开发。直接打开 `dist/index.html` 不提供 API 中转服务，且 ProRes MOV 的 Worker 无法在 `file://` 下工作。
- 视频编解码能力取决于浏览器与素材格式；Mac 上使用 Chrome / Edge 验证视频导出，Safari 的导出能力可能不同。
- `开发交接.txt` 中的 Windows 路径是迁移前历史记录。当前以 README.md 和实际克隆目录为准。
