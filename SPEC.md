# EazySillyTavern

## 一、产品概述

[SillyTavern](https://github.com/SillyTavern/SillyTavern) 是一个流行的 LLM 角色扮演前端，功能强大但部署门槛较高：用户需要装 Node.js、克隆仓库、跑 `npm install`、再用 `start.bat` / `start.sh` 启动并手动开浏览器，整套流程对不熟悉命令行的小白用户极不友好。

EazySillyTavern 是 SillyTavern 的桌面端打包发行版，把 Node runtime、SillyTavern 源码、所有 npm 依赖以及一个 Electron 外壳完整打成一个安装包。**用户唯一要做的事情就是：下载、双击、用**。无需安装 Node、无需开终端、无需配置任何环境变量，关掉应用就完全退出。

EazySillyTavern 不重新实现 SillyTavern 的任何业务逻辑——它是一层**启动器与发行容器**。SillyTavern 的所有功能、UI、生态扩展都原样保留。

---

## 二、产品目标

1. **零依赖启动**：用户在干净的 Windows / macOS 系统上首次双击应用，应能在 15 秒内进入 SillyTavern 主界面，无需安装任何前置软件。
2. **完全离线可用**：除了 LLM API 调用本身，应用启动 / 运行 / 数据读写不依赖网络。即使首次启动也不需要联网拉依赖。
3. **数据安全持久**：用户的角色卡、聊天记录、配置存放在系统标准用户目录，应用本体的覆盖安装、卸载重装、版本升级都不会丢失数据。
4. **单实例 + 单文件分发**：分发产物双平台都是单文件（`.dmg` / `.exe`）。同一时刻同一台机器只允许一个 EazySillyTavern 实例运行，避免数据竞争。
5. **可自助排错**：启动失败、服务崩溃等场景有明确的错误展示与日志入口，用户能复制日志去 issue 求助，而不是面对一片空白。

---

## 三、目标用户

| 用户类型 | 核心诉求 |
| --- | --- |
| **完全的小白用户**（主场景） | 听朋友安利 SillyTavern，想试试角色扮演，但看到 README 里的 npm 命令就劝退。要的是「下载-双击-用」 |
| **不熟悉 Node 生态的进阶玩家** | 已经会用各种 LLM 客户端，但不想为 SillyTavern 单独维护一个 Node 环境 |
| **想在家庭电脑上长期使用 SillyTavern 的用户** | 不想因为 Node 升级、依赖冲突等问题反复修复部署 |

> **明确不在目标用户范围**：需要把 SillyTavern 部署到服务器供多人访问的用户、需要 SillyTavern Extras（Python 扩展后端，如 Stable Diffusion / TTS / RVC）的用户。这些用户应继续使用 SillyTavern 官方的源码部署方式。

---

## 四、平台与技术要求

| 项 | 取值 |
| --- | --- |
| 桌面平台 | Windows 10/11 (x64)、macOS 15+ (arm64) |
| **不支持** | Windows ARM64、macOS Intel、macOS 14 及更早、Linux |
| EazySillyTavern UI 语言 | 中英双语，跟随系统 locale 自动切换（`zh-*` → 中文，其它 → 英文）。SillyTavern 主界面的语言由 SillyTavern 自身设置控制，不受影响 |
| UI 容器 | Electron（原生窗口 + 内嵌 webview） |
| Node runtime 来源 | Electron 自带 |
| SillyTavern 集成方式 | 仓库 + 完整 `node_modules` 全量预打包，作为 Electron `extraResources` |
| SillyTavern 版本基准 | 锁定一个具体的 SillyTavern release tag，每个 EazySillyTavern 版本对应一个 SillyTavern 版本 |
| 服务端口 | 每次启动随机选取一个空闲高位端口（49152-65535） |
| 服务监听地址 | 强制 `127.0.0.1`，不允许外网访问 |
| 内置认证 | basicAuth、userAccounts 默认全部关闭 |
| 多实例策略 | 单实例锁，第二次启动时激活已有窗口 |
| 关闭行为 | 关闭主窗口 = 完全退出应用（杀掉 SillyTavern 子进程） |
| 代码签名 | **不签名**（Mac 不走 Apple Developer Program，Win 不买代码签名证书）。README 提供 Gatekeeper / SmartScreen 绕过指引 |
| 安装包形式 | Mac → `.dmg`（拖拽到 /Applications）；Win → portable `.exe`（双击直接运行，不写注册表） |
| 自动更新 | 不做。仅在启动时静默检查 GitHub Release，发现新版在 UI 上提示并提供下载页跳转 |
| Extensions 生态 | 保留 SillyTavern 原生 Extensions 系统（JS-only），不集成 SillyTavern Extras（Python） |
| 数据迁移 | 不提供从原版 SillyTavern 导入数据的功能 |
| 构建发布 | GitHub Actions 在 `macos-15`（arm64）+ `windows-2022` runner 上自动构建，push tag 触发，产物上传到 GitHub Release |

---

## 五、核心用户流程

### 第一步：下载

用户访问 EazySillyTavern 的 GitHub Release 页面，根据自己的系统选择对应安装包：

- **Windows x64 用户** → 下载 `EazySillyTavern-{version}-win-x64.exe`
- **macOS Apple Silicon 用户** → 下载 `EazySillyTavern-{version}-mac-arm64.dmg`

README 顶部贴出两个直达下载链接，并附简明的"哪个适合我"说明。

#### 首次运行的系统警告处理

由于不签名，两个平台首次运行都会触发系统安全机制，README 必须提供清晰的处理步骤：

| 平台 | 警告内容 | 绕过方法 |
| --- | --- | --- |
| macOS | "无法打开，因为 Apple 无法验证开发者" | 在 Finder 中**右键 → 打开**，弹窗里再点一次"打开"。或终端执行 `xattr -cr /Applications/EazySillyTavern.app` |
| Windows | SmartScreen 蓝屏"已保护你的电脑" | 点击"更多信息" → "仍要运行" |

这部分指引必须配截图，避免小白用户卡在第一步。

### 第二步：双击启动

#### 2.1 单实例检测

应用启动时首先尝试获取单实例锁（Electron `app.requestSingleInstanceLock()`）。

- 锁获取**失败**（已有 EazySillyTavern 在运行）→ 立即退出当前进程，已有实例的主窗口被自动 focus 到前台。
- 锁获取**成功** → 进入正常启动流程。

#### 2.2 Splash 窗口先于主窗

主窗（webview）默认隐藏。先弹出一个独立的 Splash 窗口（无边框 / 居中 / 小尺寸 / 含 logo + "正在启动 SillyTavern…" 文案 + 简单进度指示），用于：

- 让用户立刻看到反馈，避免双击后几秒钟"什么都没发生"的体感。
- 在 SillyTavern 服务尚未就绪时不暴露空白 webview。
- 启动失败时承载错误信息和"查看日志"入口（详见 2.5）。

#### 2.3 启动 SillyTavern 子进程

主进程：

1. 选取一个空闲端口（详见第七章 §2）。
2. 确保用户数据目录存在（详见第八章），不存在则首次创建。
3. Fork 一个子进程运行 SillyTavern 的入口脚本（即仓库内的 `server.js`），并通过命令行参数 / 环境变量传入：
   - 监听端口（步骤 1 选出的端口）
   - 监听地址（强制 `127.0.0.1`）
   - 数据根目录（步骤 2 创建的标准用户目录）
   - 关闭 basicAuth、关闭 userAccounts
4. 同步开始捕获子进程的 stdout / stderr，写入当次启动日志文件。

> **[待确认]** SillyTavern 是否支持通过 CLI 参数 / 环境变量覆盖以上所有配置（端口 / 监听地址 / dataRoot / basicAuth / userAccounts）？设计阶段需通读 SillyTavern 的启动入口和 `config.yaml` 加载逻辑，找到最干净的注入点。若 CLI 参数不够用，回退方案是在用户数据目录里生成一份 `config.yaml` 透传给子进程。

#### 2.4 服务就绪探测

主进程在启动子进程后开始 HTTP 健康检查（详见第七章 §1），探测成功后：

1. Splash 窗口关闭。
2. 主窗口加载 `http://127.0.0.1:{port}`。
3. 主窗口显示。

#### 2.5 启动失败的处理

任意一步失败（端口选取失败、子进程立即崩溃、健康检查超时等）：

1. Splash 窗保持打开，文案切换为错误提示。
2. 提供两个按钮：**「查看日志」**（系统文件管理器打开当次启动日志）、**「退出」**。
3. **不自动重试**——避免循环失败让用户更困惑。

### 第三步：日常使用

#### 3.1 主窗界面

主窗 = SillyTavern 原生 web UI。EazySillyTavern 不在 web 内容上叠加任何自定义层。

#### 3.2 应用菜单

提供以下用户可见入口（macOS 在系统菜单栏，Windows 在窗口顶部菜单栏）：

| 菜单项 | 行为 |
| --- | --- |
| **打开数据目录** | 用系统文件管理器打开用户数据根目录（处理技术问题、备份时的关键出口） |
| **查看 / 导出启动日志** | 用系统文件管理器打开 `logs/` 目录，便于复制粘贴去 issue 求助 |
| **检查更新** | 手动触发一次 GitHub Release 检查；启动时也会静默检一次（详见第六章 §6） |
| **关于** | 弹窗展示：EazySillyTavern 版本号、内嵌的 SillyTavern 版本号、源代码链接、开源许可证 |

> **不提供**：服务重启、端口配置、认证开关、主题切换等。坚持"零配置"。

#### 3.3 关闭行为

用户关闭主窗口（点 ×、Cmd+Q、Alt+F4、Dock 退出）→ 主进程立即：

1. 向 SillyTavern 子进程发送 SIGTERM，等待最多 5 秒优雅退出。
2. 5 秒后仍存活则发 SIGKILL。
3. Electron 主进程退出。

**特别地**：macOS 上不保留"关窗口不退出应用"的传统行为——这是为小白用户优化的明确取舍（详见 SPEC §五-3.3 与决策记录）。

### 第四步：升级

用户从 GitHub Release 下载新版本安装包，覆盖式重装：

- **macOS**：把新版 `.app` 拖到 `/Applications`，Finder 提示"是否替换"，选"替换"。
- **Windows**：把新版 `.exe` 文件覆盖旧的 portable exe 即可。

由于用户数据放在系统标准用户目录（独立于 app 本体），覆盖安装**不会丢任何数据**。

> SillyTavern 自身可能在版本之间有数据迁移逻辑（如新增字段），EazySillyTavern 启动子进程时由 SillyTavern 自己负责迁移，EazySillyTavern 不介入。

### 第五步：卸载

- **macOS**：把 `EazySillyTavern.app` 拖入废纸篓即可。如需彻底清理用户数据，手动删 `~/Library/Application Support/EazySillyTavern/`。
- **Windows**：删除 portable `.exe` 文件即可（不写注册表，无残留）。如需彻底清理，手动删 `%APPDATA%\EazySillyTavern\`。

> 不提供"一键清理用户数据"功能——避免用户误操作清空对话历史。

---

## 六、核心子系统详述

### 1. 进程模型

```
┌─────────────────────────────────────────┐
│ EazySillyTavern Electron Main Process   │
│  ├─ Splash Window (启动期 / 错误期)       │
│  ├─ Main Window (webview, 主交互界面)    │
│  └─ SillyTavern Child Process (forked)   │
│       ├─ Express server on 127.0.0.1:N   │
│       └─ stdout/stderr → logs file       │
└─────────────────────────────────────────┘
```

- **Electron 主进程** 负责：单实例锁、splash 窗口、主窗口、子进程生命周期、应用菜单、更新检查。
- **SillyTavern 子进程** 负责：所有 SillyTavern 原生功能（Express 服务、文件存储、API 代理等）。
- **主窗口** 通过 `loadURL('http://127.0.0.1:{port}')` 加载子进程提供的页面。

子进程使用 Node `child_process.fork()` 启动 SillyTavern 入口脚本（让其复用 Electron 自带的 Node runtime），而非 `child_process.spawn('node', ...)`——后者在 Electron 打包后无独立 node 可执行文件可用。

### 2. 资源打包

| 资源 | 打包形式 | 说明 |
| --- | --- | --- |
| Electron 主 / 渲染进程代码（splash、菜单、主窗 controller） | `app.asar` | 标准 Electron 打包 |
| SillyTavern 仓库源码 | `extraResources/sillytavern/` | **不进 asar**，因为 SillyTavern 运行时要读自身目录下的众多文件，asar 内 fs 行为受限 |
| SillyTavern 的 `node_modules` | `extraResources/sillytavern/node_modules/` | 同上原因放在 extraResources |
| Electron 自带 Node | Electron 框架自身 | 不额外打 |

打包前的清理动作：

- 删除 SillyTavern 仓库内的 `.git`、`.github`、`docs`、测试用例等运行时不需要的文件。
- `npm install --omit=dev --omit=optional` 只装生产依赖。
- 视情况运行 `npm prune` 进一步瘦身。

> 体积预期：Mac dmg ≈ 150–200 MB，Win exe ≈ 130–170 MB。这是 Electron + Node 全套依赖的合理值。

### 3. 数据目录管理

```
~/Library/Application Support/EazySillyTavern/   (macOS)
%APPDATA%\EazySillyTavern\                       (Windows)
├── data/        # SillyTavern 用户数据（角色卡、聊天、密钥等），SillyTavern 直接读写
├── logs/        # EazySillyTavern 启动日志（按时间戳归档，保留最近 N 个）
└── config/      # EazySillyTavern 自身配置（如有，预留扩展位）
```

- 应用首次启动时若目录不存在则创建。
- 启动 SillyTavern 子进程时通过 CLI 参数 / 环境变量把 `data/` 路径透传给 SillyTavern 作为它的 `dataRoot`。
- EazySillyTavern 自身在 `config/` 下不强制写文件——尽量保持"无状态外壳"。

### 4. 端口管理

每次启动随机选取空闲端口（详见第七章 §2）。

主进程把选出的端口传给子进程，并自己保存这个端口用于：

- 主窗口 `loadURL`
- 服务就绪探测的 HTTP 请求
- 用户从「关于」菜单查询时的展示（可选）

### 5. 应用菜单与系统集成

- **菜单**：见 §3.2 表格。
- **图标**：项目自有的独立图标（区别于 SillyTavern 官方图标，避免混淆）。设计阶段确定具体图样。
- **关联**：不注册任何文件类型 / URL scheme（用户没要求，且会增加签名 / 权限复杂度）。
- **托盘 / 后台**：不做托盘、不做开机自启。

### 6. 更新检查

| 触发时机 | 行为 |
| --- | --- |
| 应用启动后 `~3s`（不阻塞主流程） | GET `https://api.github.com/repos/{owner}/{repo}/releases/latest`，对比 `tag_name` 与当前版本。有新版则在主窗顶部插入一个轻量 banner（"发现新版本 vX.Y.Z，点击查看"）。Banner 用 Electron 在主窗注入小段 JS / 通过自定义 BrowserView 叠加，避免污染 SillyTavern 的 DOM |
| 用户点击「检查更新」菜单 | 同上检测；无论有无新版都弹出对话框告知结果 |
| 检查失败（无网络 / 限流） | 静默触发时仅记日志、不打扰用户；手动触发时弹框提示 |

更新发现后**不自动下载、不自动安装**。点击 banner 或对话框按钮跳转浏览器到 GitHub Release 页面，由用户手动下载。

### 7. 日志系统

```
logs/
├── startup-2026-05-07T16-30-12.log   # 当次启动 + 运行期日志
├── startup-2026-05-06T22-08-44.log
└── ...
```

- 每次启动新建一个文件，文件名带 ISO 时间戳。
- 内容：Electron 主进程关键事件（端口选取、子进程 fork、健康检查结果、退出原因）+ SillyTavern 子进程 stdout/stderr。
- 滚动策略：保留最近 **20** 个文件，更老的自动删除。
- 不上传、不脱敏（小白用户在贴 issue 前需自行检查是否含敏感信息——README 中明示）。

### 8. UI 双语策略

EazySillyTavern 自身的所有用户可见文案（splash 标题与提示、应用菜单项、错误对话框、更新 banner、关于窗）维护为 **中 / 英两份资源**：

- 启动时通过 Electron `app.getLocale()` 读取系统语言。
- 命中 `zh-*`（包括 `zh-CN`、`zh-TW`、`zh-HK`）使用中文资源，其它一律使用英文资源。
- 不提供"在应用内手动切换语言"的入口——保持零配置原则。

资源组织：用一份扁平的 key-value 字典（如 `i18n/zh.json` + `i18n/en.json`），约定每条文案的 key，运行时 `t(key)` 取值。该资源仅服务 EazySillyTavern 自己的外壳；SillyTavern 主界面的多语言由 SillyTavern 自身设置控制。

> **维护约定**：SPEC 中提到的所有用户可见英文示例文案（如 "正在启动 SillyTavern…"、"发现新版本"、"SillyTavern 服务已停止"）在实现时同时落两份资源，PR review 时务必检查双语同步。

### 9. SillyTavern 版本 bump 流程

EazySillyTavern 仓库通过一个明确的版本指针（如 `sillytavern.version` 或 git submodule pin）锁定 SillyTavern 版本：

- 由维护者**手动**触发 bump（不引入 dependabot 类机器人，避免自动 PR 干扰）。
- bump 流程：更新版本指针 → 本地跑一遍验证 → push tag → CI 自动 build + release。
- 每次 EazySillyTavern release 的 changelog 必须明确标注内嵌的 SillyTavern 版本变化。

---

## 七、核心算法与逻辑设计

> 本项目核心业务逻辑由 SillyTavern 自身承担，EazySillyTavern 是启动器。但**进程编排**层面有两个决策需要明确：服务就绪探测 与 端口选取。这两块任意发挥都会引入难以复现的 bug，所以单独沉淀。

### 1. 服务就绪探测算法

#### 要解决的问题

SillyTavern 子进程被 fork 后，Express 服务器从 `listen()` 调用到能正常响应 HTTP 请求之间有 1–8 秒不等的延迟（要加载 plugins、初始化 cache、迁移数据等）。如果主窗口在子进程刚 fork 时就 `loadURL`，用户会看到 `ERR_CONNECTION_REFUSED`；如果固定 sleep 一个时间再加载，要么等太久（坏体感），要么等不够（坏体感 + 报错）。

> 简单方案的缺陷：固定 sleep 不能适应不同机器的性能差异；监听 stdout 关键字脆弱（SillyTavern 改了一行 log 就会失效）。

#### 数据结构

主进程在内存维护一个 `ServiceState` 对象：

```
interface ServiceState {
  port: number
  childPid: number
  status: 'starting' | 'ready' | 'failed' | 'exited'
  startedAt: number       // ms timestamp
  readyAt?: number        // ms timestamp，就绪后填充
  failureReason?: string
}
```

#### 运行机制

```
1. fork 子进程，记录 startedAt = now()，status = 'starting'
2. 进入轮询循环：
   每 200ms 发起 GET http://127.0.0.1:{port}/  (timeout 1000ms)
   - 收到任何 HTTP 响应（200 / 302 / 401 都算就绪）→ status = 'ready', readyAt = now(), 退出循环
   - ECONNREFUSED / ETIMEDOUT → 视为还没起好，继续轮询
   - 其他网络错误 → 记日志，继续轮询
3. 同时监听子进程退出事件：
   - 子进程在轮询期间退出（exit 或 error）→ status = 'failed', 退出循环
4. 总超时 30 秒：
   - 30 秒后仍未 ready 也未 failed → status = 'failed', failureReason = 'startup timeout'
5. 根据最终 status 决定下一步：
   - 'ready'  → 关 splash, 主窗 loadURL
   - 'failed' → splash 显示错误 + 「查看日志」按钮
```

> **健康检查端点的选择**：用 `GET /` 而非 `GET /api/ping` 是因为 SillyTavern 不同版本的 API 路径结构会变，但根路径会响应（正常返回 200 或 SillyTavern 主页 HTML）。这个选择减少了对 SillyTavern 内部 API 的耦合。
>
> **[待确认]** SillyTavern 的根路径在 basicAuth 关闭、userAccounts 关闭场景下的最早就绪行为，需要在实现时验证。如果根路径就绪过早（在 plugins 加载完成前就响应），可以改用一个更晚就绪的路径。

#### 边界与约束

- 轮询间隔 200ms：太密会浪费 CPU（启动 8 秒就是 40 次请求），太疏会增加用户感知延迟。200ms 是经验值。
- 总超时 30 秒：覆盖到老旧 HDD + 杀软扫描的极端场景。
- 子进程崩溃要尽快感知：通过 `child.on('exit')` 事件，而非依赖轮询超时。
- 服务就绪后不再持续探测——SillyTavern 自身崩溃由 `child.on('exit')` 兜底处理。

### 2. 随机空闲端口选取算法

#### 要解决的问题

固定端口（如 SillyTavern 默认的 8000）容易和用户已有的 SillyTavern 进程 / 其他应用冲突，给小白用户带来"为什么打不开"的困惑。完全随机也不行——需要确保选出来的端口当下确实空闲。

#### 运行机制

```
1. 端口范围限定在动态端口段 49152–65535（IANA 为临时端口预留）
2. 用 Node 的 net 模块向 OS 申请一个空闲端口：
   const server = net.createServer()
   server.listen(0, '127.0.0.1')  // port=0 让 OS 分配
   const port = server.address().port
   server.close()
3. 立即把 port 传给 SillyTavern 子进程作为监听端口
4. 失败兜底：
   - 极小概率出现 port=0 申请到的端口刚 close 就被别人占用（TOCTOU 竞态）
   - 子进程启动时会因 EADDRINUSE 立即崩溃
   - 主进程感知到子进程崩溃、retry 一次（最多 retry 3 次）
   - 仍失败则报错给用户（"端口分配失败，请稍后重试或重启电脑"）
```

#### 边界与约束

- 不缓存上次端口、每次启动重选——保持简单。
- 不暴露端口配置项给用户，避免把这个内部实现细节抬到产品概念层。
- 端口对用户不可见（主窗内嵌 webview 的地址栏不显示），用户也不需要知道。

---

## 八、数据管理

| 数据类型 | 路径 | 谁写 | 升级保留 |
| --- | --- | --- | --- |
| SillyTavern 用户数据（角色卡、对话、密钥、世界书、preset 等） | `{userDataRoot}/data/` | SillyTavern 子进程 | ✅ |
| 启动 / 运行日志 | `{userDataRoot}/logs/` | EazySillyTavern 主进程 | ✅（保留最近 20 个） |
| EazySillyTavern 自身配置 | `{userDataRoot}/config/` | EazySillyTavern 主进程 | ✅ |
| 内嵌的 SillyTavern 仓库 + node_modules | app 本体内 `extraResources/` | 安装包 | ❌（每次安装包都是全新的） |

`{userDataRoot}` 在 macOS 是 `~/Library/Application Support/EazySillyTavern/`，在 Windows 是 `%APPDATA%\EazySillyTavern\`。

数据备份策略：用户自助。「打开数据目录」菜单提供入口，用户可以把整个 `data/` 拷贝到云盘 / 移动硬盘做备份。

---

## 九、异常处理与稳定性要求

| 异常场景 | 处理策略 |
| --- | --- |
| 单实例锁失败（已有实例） | 当前进程立即退出，已有实例 focus 主窗 |
| 端口选取失败（罕见） | retry 最多 3 次，仍失败 splash 显示错误 |
| 子进程 fork 失败 | splash 显示错误 + 查看日志 |
| 子进程启动后立即崩溃（如 SillyTavern 内部错误） | splash 显示错误 + 查看日志，不自动重启 |
| 服务就绪探测超时（30s） | splash 显示错误 + 查看日志，不自动重启 |
| 服务运行中崩溃（已经 ready 之后子进程退出） | 主窗注入 banner 提示"SillyTavern 服务已停止，请关闭并重新打开应用"，不自动重启子进程 |
| 用户数据目录不可写（如权限错误） | splash 显示错误，提示用户检查目录权限 |
| 更新检查失败（无网络 / GitHub 限流） | 静默触发时只记日志；手动触发时友好提示 |
| `node_modules` 损坏 / 文件被防病毒软件误删 | SillyTavern 子进程会立即崩溃报错，错误日志会指向具体缺失模块；README FAQ 给出"重装应用即可"建议 |

> **设计原则**：自动重启会让小白用户陷入循环错误而不知道发生了什么。明确报错 + 提示重启应用 比 隐式 retry 更有助于排错。

---

## 十、隐私与安全要求

- **网络监听**：SillyTavern 子进程强制监听 `127.0.0.1`，不允许外部网络访问。EazySillyTavern 不提供"开放外网访问"的开关——有此需求的用户应使用源码部署版。
- **代码签名**：明确不签名（双平台），由 README 教用户绕过系统警告。该决策在产品概述中已对用户透明。
- **API key 存储**：用户在 SillyTavern 内填的 OpenAI / Claude 等 API key 由 SillyTavern 自身管理，存在 `data/` 目录的 secrets 文件中（沿用 SillyTavern 原生行为）。EazySillyTavern 不接触、不读取这些 key。
- **遥测**：不收集任何使用数据。唯一的网络行为是更新检查（向 `api.github.com` 发请求），且不附带任何用户标识。
- **更新检查**：仅请求 `api.github.com/repos/{owner}/{repo}/releases/latest`，不发送任何用户数据。

---

## 十一、验收标准

1. ✅ 在干净的 Windows 11 x64 / macOS 14 arm64 系统（未装过 Node.js）上，下载 + 双击启动 + 进入 SillyTavern 主页 ≤ 15 秒。
2. ✅ 拔掉网线 / 关闭 Wi-Fi 后双击应用，仍能正常启动并进入主页（仅更新检查会失败但不影响主流程）。
3. ✅ 关闭应用后，系统进程列表（Activity Monitor / 任务管理器）中无 EazySillyTavern 或 SillyTavern 相关进程残留。
4. ✅ 用应用创建若干角色和对话 → 关闭 → 用新版本（或同版本）覆盖安装 → 重新打开 → 角色和对话完整保留。
5. ✅ 同一时刻无论用户双击多少次，只有一个 EazySillyTavern 实例存在；后续双击会激活已有窗口而不是新开窗口。
6. ✅ 应用菜单的「打开数据目录」点击后，系统文件管理器正确打开用户数据根目录。
7. ✅ 模拟启动失败（如手动让 SillyTavern 子进程立即抛错），splash 必须显示错误信息，且「查看日志」能打开包含错误细节的当次日志文件。
8. ✅ 启动时若服务端口选取与监听之间发生竞态（人为构造），主进程能在 3 次 retry 内恢复。
9. ✅ 在 SillyTavern 内填入 LLM API key 并完成一次正常对话，确认 SillyTavern 原生能力（角色扮演、Extensions JS 部分）未受 EazySillyTavern 包装影响。
10. ✅ GitHub Release 上传后，应用启动 3 秒内出现"发现新版本"提示，点击跳转到 Release 页面。
11. ✅ Mac 端首次双击触发 Gatekeeper，按 README 步骤右键打开后能正常进入主流程；Windows SmartScreen 同样能按 README 步骤通过。
12. ✅ 单一安装包大小 ≤ 250 MB（Mac dmg + Win exe 各自）。

---

## 十二、总结

EazySillyTavern 的**唯一**核心竞争力是「**让小白用户用上 SillyTavern**」。所有的设计决策——单文件分发、零依赖启动、关窗即退、不签名 + README 教学、不做迁移、不集成 Python 扩展——都是这个目标的具体取舍：**优先零门槛和稳定性，不为高级用户做让步**。

需要任何高级能力（外网部署、Extras 后端、自定义端口、多实例、自动更新）的用户，应当继续使用 SillyTavern 官方的源码部署。EazySillyTavern 不与官方版本竞争，是它的**入门入口**。

最大的实现风险集中在两处，需要在动手前重点验证：

1. **SillyTavern 的启动注入接口**：是否能通过 CLI 参数 / 环境变量干净地覆盖端口、监听地址、dataRoot、basicAuth、userAccounts。如果不行，就要在用户数据目录里生成 `config.yaml` 透传——会让数据目录管理变复杂。
2. **服务就绪探测**：根路径作为健康检查端点是否可靠（特别是首次启动数据迁移期间）。如果不可靠，需要找一个更晚就绪的端点。

---

> **本文档约定**：所有标注 `[待确认]` 的部分需在实现前查证 SillyTavern 当前版本的实际行为后再敲定。
