# EazySillyTavern

> **TL;DR**: 下载 → 双击 → 用。  Download → double-click → use.

EazySillyTavern 是 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 的桌面端打包发行版：把 Node runtime、SillyTavern 源码、所有 npm 依赖以及一个 Electron 外壳完整打成一个安装包，让小白用户跳过 Node.js / npm / 终端命令，直接进入角色扮演界面。

EazySillyTavern is a desktop launcher distribution of SillyTavern. The Node runtime, SillyTavern source, all npm dependencies and an Electron shell are pre-bundled into a single installer so non-technical users can skip the Node.js / npm / command-line setup entirely.

完整的产品定位、目标用户、设计取舍请见 [SPEC.md](SPEC.md)。

---

## 下载 Download

请到 [Releases](https://github.com/OWNER_PLACEHOLDER/REPO_PLACEHOLDER/releases/latest) 页面，按系统选择：

| 系统 / OS | 文件 / File |
| --- | --- |
| macOS Apple Silicon (15+) | `EazySillyTavern-{version}-mac-arm64.dmg` |
| Windows 10/11 x64 | `EazySillyTavern-{version}-win-x64.exe` |

> **暂不支持**：macOS Intel、macOS 14 及更早、Windows ARM64、Linux。这些用户请参考 [SillyTavern 官方源码部署](https://github.com/SillyTavern/SillyTavern#-installation)。
>
> Not supported: macOS Intel, macOS 14 and earlier, Windows ARM64, Linux. Use the upstream source-based install for those platforms.

---

## 首次运行 First-time launch

EazySillyTavern **不进行代码签名**（避免对小白用户征收每年 99 美元的 Apple Developer Program / 数百美元的 Windows 代码签名证书费用）。两个平台首次双击都会触发系统安全机制。请按下面的步骤通过：

EazySillyTavern is **not code-signed**. Both platforms will show a security warning the first time you launch it. Follow the steps below to bypass it.

### macOS — Gatekeeper

1. 把 `EazySillyTavern.app` 拖到 `应用程序 / Applications` 文件夹。
2. 在 Finder 中找到它，**右键（或按住 Control 单击）→ 打开**。
3. 弹窗里再点一次「打开」/ "Open"。
4. 后续启动可正常双击。

如果仍被拦截，可在终端执行：

```bash
xattr -cr /Applications/EazySillyTavern.app
```

### Windows — SmartScreen

1. 双击 `EazySillyTavern-{version}-win-x64.exe`。
2. 出现「Windows 已保护你的电脑 / Windows protected your PC」时，点击「**更多信息 / More info**」。
3. 再点击「**仍要运行 / Run anyway**」。
4. 后续启动可正常双击。

> EazySillyTavern 是 Windows 的便携应用（portable exe），**不写注册表、不安装到 Program Files**。删除 exe 即等于卸载。
>
> EazySillyTavern is a Windows portable executable. It does not write the registry or install into Program Files. Delete the exe to uninstall.

---

## 数据存放位置 Data location

| 平台 / OS | 路径 / Path |
| --- | --- |
| macOS | `~/Library/Application Support/EazySillyTavern/` |
| Windows | `%APPDATA%\EazySillyTavern\` |

目录结构 / Directory layout:

```
EazySillyTavern/
├── data/    # 角色卡、对话、密钥、世界书 / characters, chats, secrets, world info
├── logs/    # 启动日志（保留最近 20 个）/ rolling startup logs (last 20)
└── config/  # EazySillyTavern 自身配置 / launcher-side config (currently empty)
```

应用菜单中的「**打开数据目录**」/「**Open data directory**」会用系统文件管理器直接打开 `data/`，方便备份。

The application menu's **Open data directory** entry opens `data/` in the system file manager for backup.

---

## 卸载 / 升级 Uninstall / Upgrade

### 升级 Upgrade

下载新版本安装包，覆盖旧版本即可。用户数据存放在系统标准用户目录，**升级不会丢任何数据**。

### 卸载 Uninstall

- **macOS**：把 `EazySillyTavern.app` 拖入废纸篓。彻底清理用户数据再删 `~/Library/Application Support/EazySillyTavern/`。
- **Windows**：删除 portable `.exe` 即可。彻底清理用户数据再删 `%APPDATA%\EazySillyTavern\`。

---

## 排错 Troubleshooting

### 启动时 splash 窗口报错

点击 splash 窗口里的 **「查看日志」/「View log」** 按钮，复制 `logs/startup-*.log` 的内容到 issue。

> 提示：日志可能含有你输入过的 API key 等敏感内容，提交前请自行检查。
>
> Logs may contain API keys you have entered. Review before sharing.

### 启动后主窗黑屏 / 白屏

应用菜单 → 视图 → 重新加载，或 Cmd+R / F5。如果仍异常，关闭应用 → 重新打开。

### 应用无法启动 / 闪退

可能是 SillyTavern 的 `node_modules` 被防病毒软件误删。**重装 EazySillyTavern 即可**。

### 我用的是企业网络，更新检查总是失败

这是预期行为。EazySillyTavern 的更新检查只是去 `api.github.com`，不会影响主流程。手动检查更新（应用菜单 → 文件 → 检查更新）会显示更友好的失败提示。

---

## 关于 About

- **不收集任何遥测数据 No telemetry**：除了启动 3 秒后向 `api.github.com` 发的更新检查（不带任何用户标识），EazySillyTavern 不联网。
- **强制 127.0.0.1 监听**：SillyTavern 子进程被锁死在本机环回地址，**不允许外部访问**。需要外网访问的用户请用 SillyTavern 官方源码部署版。
- **API key 由 SillyTavern 自己管理**：EazySillyTavern 不读取、不接触你的任何 API key。
- **License**: AGPL-3.0（与 SillyTavern 保持一致）。

---

## 给开发者 For developers

EazySillyTavern 是一层**启动器与发行容器**——SillyTavern 的所有功能、UI、生态扩展都原样保留。本仓库不重新实现任何 SillyTavern 业务逻辑。

EazySillyTavern is a launcher and distribution shell — all SillyTavern features, UI and extensions are preserved as-is. This repository does not reimplement any SillyTavern business logic.

### 本地开发 Local development

```bash
# 一次性：安装 devbox（参考 https://www.jetify.com/devbox）
# Then:
devbox shell                          # 进入隔离环境 / enter isolated env
npm install                           # 装 Electron / install Electron
npm run prep                          # 拉 Node 24 二进制 + SillyTavern 1.18.0 + 装 ST 生产依赖
npm start                             # 启动 / launch
```

### 打包 Build

```bash
devbox run -- npm run release:mac     # macOS arm64 .dmg
devbox run -- npm run release:win     # Windows x64 portable .exe (cross-builds OK on macOS)
```

构建产物在 `dist/` 下。CI（`.github/workflows/release.yml`）在 push tag `v*` 时自动构建并发布到 GitHub Release。

> **本地 mac dmg 出错回退**：在某些 macOS 主机上 electron-builder 内嵌的 dmgbuild 会因为 Spotlight / DiskArbitration 占住 `hdiutil` 卷而以 `couldn't unmount diskN - 资源忙` 失败。这是 dmgbuild Python 那一层的环境问题，与 EazySillyTavern 代码无关。先跑 `npm run build:mac` 出 `.app`，再跑 `npm run build:mac:dmg-fallback` 用裸 `hdiutil` 包成 dmg，可绕过这一层。CI runner 是干净环境，不会触发该问题，正常 `release:mac` 就够。

Build outputs land in `dist/`. The CI workflow at `.github/workflows/release.yml` triggers on `v*` tags and publishes to GitHub Release automatically.

### 升级内嵌的 SillyTavern Bump bundled SillyTavern

1. 修改 `package.json` → `sillytavern.version`
2. `npm run prep:sillytavern -- --force` 重新拉取
3. 本地 smoke test
4. push tag `vX.Y.Z`，CI 自动构建发布

---

## 致谢 Acknowledgements

EazySillyTavern 站在 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 团队的肩膀上。所有有趣的功能都由他们实现，本项目只是把"装它"这件事做得更轻一点。

EazySillyTavern stands on the shoulders of the [SillyTavern](https://github.com/SillyTavern/SillyTavern) team. All the interesting work is theirs; this project just makes "installing it" lighter.
