# 官网分发

官网版使用 Windows x64 用户级 NSIS 安装程序。安装器会创建桌面和开始菜单快捷方式，不需要管理员权限。应用可以离线运行；检查和下载更新时需要联网。

## 本地构建

```powershell
npm ci
npm run dist:win
```

构建机访问 GitHub 受限时，先设置 electron-builder 工具镜像：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

项目会直接复用 `node_modules/electron/dist`，避免重复下载 Electron 运行时；第一次构建仍会下载 NSIS 和 7-Zip 工具并缓存到本机。

未设置更新地址时，安装包仍可用于本地安装验证，但应用会提示官网更新源尚未配置。
如果当前机器无法下载 NSIS 构建工具，可运行 `npm run pack:win:dir` 先验证解包后的应用目录；它不是可分发的安装器。

## 发布到官网

官网准备一个支持 HTTPS 静态下载的目录，例如 `https://download.example.com/ants/windows/`。它不需要 API 服务或数据库。

在 PowerShell 中配置真实目录并构建：

```powershell
$env:ANT_UPDATE_URL = 'https://download.example.com/ants/windows/'
npm run dist:win
Remove-Item Env:ANT_UPDATE_URL
```

这次构建会额外生成 `latest.yml`。把它和安装程序、`.blockmap` 一起上传到更新目录；示例域名必须替换成官网实际的 HTTPS 下载地址。

将 `dist` 中的 `AntColony-<版本>-Setup.exe`、对应的 `.blockmap` 和 `latest.yml` 上传到该目录。每次发布都提高 `package.json` 的 `version`，重新构建并上传同一目录中的新文件与新 `latest.yml`。旧安装版通过 `latest.yml` 找到新版本。

## GitHub 免安装版

免安装版使用便携式单文件程序，不写入安装目录，也不需要安装权限。构建命令：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist:win:portable
```

生成的 `dist/AntColony-<版本>-Portable.exe` 可以直接作为 GitHub Release 附件。用户从 Release 页面下载后双击运行；便携版升级时重新下载新版本。安装版仍使用 `latest.yml` 检查更新。

应用内的“检查更新”只在已安装、且构建时配置过 `ANT_UPDATE_URL` 的版本中启用。下载完成后由用户点击“重启并更新”；若仍有文件搬运任务，安装会等待任务完成或取消。文件数据存放在用户桌面，不会被升级覆盖。

当前没有官网域名或代码签名证书，因此尚不能生成可连接到真实更新源的正式发行包。公开分发前应使用稳定域名和代码签名证书，降低安装器被篡改及 Windows 来源警告的风险。
签名发布时通过 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 提供证书，并把证书完整发布者名称设为 `ANT_PUBLISHER_NAME`，以便更新器校验新安装包的签名者。
