<div align="center">

# <img src="./src-tauri/icons/128x128.png" alt="Aemeth 图标" width="40" /> Aemeth Terminal

**面向开发者的多终端服务启动器与终端工作台。**

每个服务一张应用卡片——预设好 Shell、工作目录与启动指令，一键拉起整个服务栈，集中监控、快速切换。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](#)

[English](./README.md) · [简体中文](./README.zh-CN.md)

<img src="./assets/screenshot.png" alt="Aemeth Terminal — 截图" width="800" />

</div>

在本地跑一套微服务，往往意味着同时开着十几个控制台窗口，每个都要重复一遍 `cd` + `yarn dev` 的手工仪式。Aemeth 把每个服务变成一张**应用卡片**，预设好完整的启动序列——一键拉起整个服务栈；标签式终端工作台让每个会话都只差一个快捷键。

## 功能特性

- 🗂️ **应用卡片** — 每个服务一张卡片：名称、颜色、Shell 类型、工作目录、启动序列一览，以及实时运行状态（运行中 / 已退出·退出码 / 未运行）。
- ⚡ **启动序列** — 为每个应用配置按序执行的指令（如 `cd E:\project\api` → `yarn dev`），每条指令可单独设置发送间隔，并支持"等待 Shell 就绪"的启动延时。
- 🐚 **多 Shell 支持** — 每个应用可独立选择 **PowerShell / PowerShell 7 (pwsh) / CMD / Git Bash**，自动探测本机可用 Shell。
- 🖥️ **终端工作台** — Win11 风格标签页，会话常驻内存、一键切换；中键关闭标签、右键复制/粘贴（保留经典控制台的操作习惯）。
- 🚀 **随应用启动** — 勾选后打开 Aemeth 即自动拉起对应服务。
- ⌨️ **键盘优先** — `Ctrl+Tab` 循环切换标签，`Ctrl+1…9` 直达跳转，`Ctrl+W` 关闭。
- 🌏 **多语言** — English / 简体中文，自动检测系统语言并持久化，侧边栏可随时切换。
- 🔤 **字体排印** — 西文 Geist Sans / Geist Mono，中文 Noto Sans SC——UI 与终端共用同一字体栈。
- 🧹 **退出即清理** — 关闭窗口时自动终止所有派生 Shell 进程。
- ⚫ **Geist / Vercel 风格视觉** — 纯黑画布、发丝级边框，颜色只用于状态语义。

## 两个界面

| 界面 | 说明 |
| --- | --- |
| **应用列表** | 总览所有服务的配置与运行状态——启动 / 停止 / 重启 / 编辑 / 删除，支持搜索过滤。 |
| **终端** | 每个运行中的服务一个标签页，由 xterm.js 完整渲染（真彩、WebGL 加速、10,000 行滚动回溯）。 |

## 快速开始

### 前置要求

- [Node.js ≥ 20](https://nodejs.org/) 与 [pnpm](https://pnpm.io/)
- [Rust (stable)](https://rustup.rs/)
- 当前操作系统对应的 [Tauri 平台依赖](https://tauri.app/start/prerequisites/)

### 源码运行

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 开发模式（热更新）
pnpm tauri build    # 生产构建 → src-tauri/target/release/bundle
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | 下一个 / 上一个终端标签 |
| `Ctrl + 1…9` | 跳转到第 N 个标签 |
| `Ctrl + W` | 关闭当前标签（并停止其进程） |
| 终端内右键 | 有选中文本 → 复制；否则 → 粘贴 |
| 标签中键单击 | 关闭该标签 |

## 技术架构

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
│  PtyManager ── portable-pty (ConPTY) ── powershell /   │
│    │                                  cmd / bash / pwsh │
│    ├─ reader 线程 ──► pty://output（base64 事件）        │
│    ├─ reaper 线程 ──► pty://exit  （退出码）            │
│    └─ scheduler  ──► 按延时逐条写入启动指令              │
└────────────────────────────────────────────────────────┘
```

- **`src-tauri/src/pty.rs`** — 会话生命周期：启动、写入、resize、kill、事件流。输出以 base64 分片，避免截断 UTF-8 序列。
- **`src-tauri/src/shells.rs`** — Shell 探测与解析（PATH + 常见安装路径）。
- **`src/lib/session-registry.ts`** — xterm 实例池；终端在会话启动时即创建，切换视图不丢输出。
- **`src/store/use-app-store.ts`** — 全局状态 + `tauri-plugin-store` 持久化。

## 目录结构

```
├── src/                    # 前端
│   ├── components/
│   │   ├── apps/           # 应用列表、卡片、编辑/删除对话框
│   │   ├── terminals/      # 标签栏 + 终端窗格
│   │   ├── layout/         # 侧边导航、标题栏
│   │   └── shared/ ui/     # 状态标识 / shadcn 组件
│   ├── hooks/ lib/ store/  # 快捷键、IPC、会话注册、状态
├── src-tauri/              # Rust 后端
│   └── src/{lib,pty,shells}.rs
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | [Tauri 2](https://tauri.app/) |
| UI | React 19 · TypeScript 7 · Vite · Tailwind CSS v4 · shadcn/ui |
| 状态管理 | zustand + `tauri-plugin-store` |
| 终端渲染 | [xterm.js](https://xtermjs.org/)（WebGL、fit、search、unicode11 插件） |
| PTY | [portable-pty](https://crates.io/crates/portable-pty)（Windows 走 ConPTY） |

## License

[MIT](./LICENSE) © EnochRen

## 致谢

站在优秀开源项目的肩膀上：[Tauri](https://tauri.app/)、[xterm.js](https://xtermjs.org/)、[portable-pty](https://github.com/wez/wezterm/tree/main/termwiz)、[shadcn/ui](https://ui.shadcn.com/) 与 [Geist](https://vercel.com/font) 字体。
