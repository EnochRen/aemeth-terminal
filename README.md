# Aemeth Terminal

> 一个面向开发者的**多终端服务启动器**：为每个服务建立一张"应用卡片"，预设好 Shell、工作目录与启动指令，一键启动、集中监控、多终端快速切换。

基于 **Tauri 2 + React 19 + Vite + TypeScript 7 + shadcn/ui** 构建，PTY 层由 [portable-pty](https://crates.io/crates/portable-pty)（Windows 上走 ConPTY）驱动，终端渲染使用 [xterm.js](https://xtermjs.org/)。

---

## ✨ 功能特性

- **应用卡片（App 列表）** — 每个服务一张卡片：名称、颜色、Shell 类型、工作目录、预设指令一览、实时运行状态（运行中 / 已退出·退出码 / 未运行）。
- **预设指令** — 为每个应用配置按序执行的指令（如 `cd E:\ProjectWork\qa\torappu-qa\qa-egg` → `yarn dev`），每条指令可单独设置发送间隔，并可配置"等待 Shell 就绪"的启动延时。
- **多 Shell 支持** — 每个应用可独立选择 **PowerShell / PowerShell 7 (pwsh) / CMD / Git Bash**（自动探测本机可用 Shell）。
- **终端工作台** — Win11 风格标签页，多终端常驻内存、一键切换；支持中键关闭标签、右键复制/粘贴（经典控制台习惯）。
- **随应用启动** — 勾选后打开 Aemeth 即自动拉起对应服务。
- **快捷键** — `Ctrl+Tab` / `Ctrl+Shift+Tab` 切换标签，`Ctrl+1…9` 跳转，`Ctrl+W` 关闭。
- **退出即清理** — 关闭窗口时自动终止所有派生 Shell 进程。
- **Geist / Vercel 风格视觉** — 纯黑画布、发丝级边框、Geist Sans + Geist Mono，颜色只用于状态语义。

## 🖥️ 两个界面

| 界面 | 说明 |
| --- | --- |
| **应用列表** | 总览所有服务的配置与运行状态；启动 / 停止 / 重启 / 编辑 / 删除；搜索过滤。 |
| **终端** | 每个运行中的服务一个标签页，xterm.js 完整渲染（真彩、WebGL 加速、滚动回溯 10,000 行）。 |

## 🚀 快速开始

前置要求：[Node.js ≥ 20](https://nodejs.org/)、[Rust (stable)](https://rustup.rs/)、pnpm，以及 Windows 平台对应的 [Tauri 依赖](https://tauri.app/start/prerequisites/)。

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 开发模式（热更新）
pnpm tauri build    # 生产构建（产物在 src-tauri/target/release/bundle）
```

## ⌨️ 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | 下一个 / 上一个终端标签 |
| `Ctrl + 1…9` | 跳转到第 N 个标签 |
| `Ctrl + W` | 关闭当前标签（并停止其进程） |
| 终端内右键 | 有选中文本 → 复制；否则 → 粘贴 |
| 标签中键单击 | 关闭该标签 |

## 🏗️ 技术架构

```
┌────────────────────────────────────────────────────────┐
│  Webview (React 19 + shadcn/ui + Tailwind v4)          │
│                                                        │
│  zustand store ──► SessionRegistry (xterm.js 实例池)    │
│        │                 │                             │
│        ▼                 ▼                             │
│  plugin-store       invoke / events                    │
│  (aemeth.json)           │                             │
└──────────────────────────┼─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│  Rust core (Tauri 2)                                   │
│                                                        │
│  PtyManager ── portable-pty (ConPTY) ── powershell/    │
│    │                                   cmd/bash/pwsh   │
│    ├─ reader 线程  ──► pty://output (base64 事件)       │
│    ├─ reaper 线程  ──► pty://exit  (退出码)             │
│    └─ scheduler   ──► 按延时逐条写入预设指令             │
└────────────────────────────────────────────────────────┘
```

- **`src-tauri/src/pty.rs`** — 会话生命周期：启动、写入、resize、kill、事件流；输出以 base64 分片避免 UTF-8 边界问题。
- **`src-tauri/src/shells.rs`** — Shell 探测与解析（PATH + 常见安装路径）。
- **`src/lib/session-registry.ts`** — xterm 实例池；终端在会话启动时即创建，切视图不丢输出。
- **`src/store/use-app-store.ts`** — 全局状态 + `tauri-plugin-store` 持久化。

## 📁 目录结构

```
├── src/                    # 前端
│   ├── components/
│   │   ├── apps/           # 应用列表、卡片、编辑/删除对话框
│   │   ├── terminals/      # 标签栏 + 终端窗格
│   │   ├── layout/         # 侧边导航
│   │   └── shared/ ui/     # 状态标识 / shadcn 组件
│   ├── hooks/ lib/ store/  # 快捷键、IPC、会话注册、状态
├── src-tauri/              # Rust 后端
│   └── src/{lib,pty,shells}.rs
```

## 📄 License

MIT
