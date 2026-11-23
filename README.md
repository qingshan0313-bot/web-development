# Frame 素材工具台

浏览器素材处理工具，使用原生 HTML、CSS、JavaScript 和 Node.js。支持 Mac 与 Windows；素材默认在浏览器内处理。

## 本地开发

安装 Node.js 24（版本见 .nvmrc）与 Git，在项目根目录运行：

```sh
npm run dev:open
```

打开 http://127.0.0.1:4173/ 。修改 src/ 后刷新页面。视频导出建议使用 Chrome 或 Edge。
项目没有 npm 运行依赖，无需 npm install。

- Mac：也可以双击“打开工具台.command”。
- Windows：也可以双击“打开工具台.cmd”。
- 停止服务：在终端按 Ctrl+C。
- 端口占用：npm run dev:open -- --port 4175。

## 构建与预览

```sh
npm run build
npm run preview
```

预览地址为 http://127.0.0.1:4174/ 。编辑 src/，由 build.mjs 生成 dist/；不要手动修改 dist/。
构建时会将视频编码 WASM 拆分为两个静态文件，以符合 Sites 单文件大小限制。
请保留 src/vendor/ 中的媒体库、WASM 及许可证。

## Mac / Windows 协作

两台电脑克隆同一个 GitHub 私有仓库。若使用不同 GitHub 账号，由仓库所有者邀请另一账号为协作者。
每台电脑独立配置 Git 的 user.name 和 user.email，并使用各自账号登录。

开始工作前：

```sh
git pull --ff-only origin main
```

完成修改并验证后：

```sh
npm run build
git add .
git commit -m "说明本次修改"
git push origin main
```

切换电脑前先提交并推送，换电脑后先拉取。遇到冲突时先处理冲突，不要强制推送覆盖另一台电脑的工作。
如果需要同时开发不同功能，分别建立功能分支，再合并到 main。
.gitattributes 统一代码换行符，同时为 Windows 启动器保留 CRLF。

## Sites 发布

线上站点：https://qs-studio.spicyadage32.chatgpt.site/

.openai/hosting.json 保存现有 Site 的项目标识，请保留；更新时复用该项目，不要创建重复站点。
GitHub 用于源码同步，推送 GitHub 不会自动更新线上站点。当前通过 Sites 工作流另行同步源码、保存版本并部署。
不同开发账号能同步 GitHub 源码，但不等于都拥有 Sites 发布权限；发布需使用有权管理原站点的账号。

## 文件与凭据

.env、密钥、访问令牌、本地素材和导出视频不应提交。个人素材放在被忽略的 local-media/，导出文件放在 exports/。
浏览器里的制作记录、收藏和 API 配置不通过 Git 同步。
使用 npm run build:sites 构建 Sites 版本。线上 Worker 与本地 Node 服务使用同一套火山方舟转发校验。浏览器将抽帧和用户填写的 Key 发送到同源接口，转发服务不保存它们。其他服务仍通过浏览器调用，需要支持跨域。
