/**
 * Typed i18n dictionaries. `zh` is the source of truth; `en` must satisfy the
 * same shape, so missing translations fail at compile time.
 */
export type Locale = "zh" | "en";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
];

const zh = {
  sidebar: {
    apps: "应用列表",
    terminals: "终端",
    newApp: "新建应用",
    language: "语言",
  },
  apps: {
    title: "应用",
    count: "{apps} 个应用 · {running} 个运行中",
    search: "搜索…",
    new: "新建",
    emptyLabel: "暂无应用",
    emptyDesc:
      "为每个服务建立一张卡片：指定 Shell、工作目录与预设指令，例如 cd qa-egg → yarn dev，一键启动。",
    createFirst: "创建第一个应用",
    noMatch: "没有匹配「{q}」的应用",
  },
  card: {
    openTerminal: "打开终端",
    stop: "停止",
    start: "启动",
    restart: "重新启动",
    viewOutput: "查看输出",
    auto: "自启",
    interactive: "交互式 shell",
    more: "+{n} 条",
    edit: "编辑",
    delete: "删除",
    pid: "pid {pid}",
  },
  status: {
    idle: "未运行",
    running: "运行中",
    exited: "已退出",
  },
  dialog: {
    titleNew: "新建应用",
    titleEdit: "编辑应用",
    desc: "为服务指定 Shell、工作目录与启动指令，之后即可一键启动。",
    name: "应用名称",
    namePlaceholder: "例如：QA Egg 服务",
    shell: "Shell",
    cwd: "工作目录（可选）",
    cwdPlaceholder: "E:\\ProjectWork\\…",
    pickDir: "选择工作目录",
    color: "颜色",
    commands: "预设指令",
    commandsHint: "按顺序输入到 Shell，每条可单独设置发送间隔",
    addCommand: "添加指令",
    delay: "等待 Shell 就绪",
    delayHint: "启动后等待该时长再发送第一条预设指令。网络磁盘较慢时可适当调大。",
    autoStart: "随应用启动",
    autoStartHint: "打开 Aemeth Terminal 时自动启动该服务",
    cancel: "取消",
    save: "保存修改",
    create: "创建应用",
    cmdPlaceholder1: "cd E:\\ProjectWork\\qa\\torappu-qa\\qa-egg",
    cmdPlaceholder2: "yarn dev",
  },
  delete: {
    title: "删除「{name}」？",
    desc: "该应用的配置将被永久删除；若其终端正在运行，会一并停止。此操作无法撤销。",
    cancel: "取消",
    confirm: "删除",
  },
  terminals: {
    newTab: "新建终端",
    launch: "启动",
    focus: "聚焦",
    start: "启动",
    allOpen: "所有应用都已打开",
    goCreate: "先去创建一个应用…",
    emptyLabel: "没有打开的终端",
    emptyHint: "从下方启动一个服务，或前往应用列表",
    goApps: "前往应用列表 →",
    bgSessions: "{n} 个会话在后台运行",
  },
  pane: {
    exited: "已退出",
    code: "代码 {code}",
    restart: "重启",
    close: "关闭",
  },
  toasts: {
    saved: "已保存「{name}」",
    created: "已创建「{name}」",
    deleted: "已删除「{name}」",
    startFailed: "启动「{name}」失败",
    restartFailed: "重启「{name}」失败",
  },
  app: {
    loading: "加载中",
  },
  window: {
    minimize: "最小化",
    maximize: "最大化",
    restore: "还原",
    close: "关闭",
  },
};

export type Dict = typeof zh;

const en: Dict = {
  sidebar: {
    apps: "Applications",
    terminals: "Terminals",
    newApp: "New application",
    language: "Language",
  },
  apps: {
    title: "Applications",
    count: "{apps} apps · {running} running",
    search: "Search…",
    new: "New",
    emptyLabel: "no applications",
    emptyDesc:
      "Create a card per service: pick a shell, working directory and preset commands — e.g. cd qa-egg → yarn dev — then launch with one click.",
    createFirst: "Create your first application",
    noMatch: "no match for “{q}”",
  },
  card: {
    openTerminal: "Open terminal",
    stop: "Stop",
    start: "Start",
    restart: "Restart",
    viewOutput: "View output",
    auto: "auto",
    interactive: "interactive shell",
    more: "+{n} more",
    edit: "Edit",
    delete: "Delete",
    pid: "pid {pid}",
  },
  status: {
    idle: "idle",
    running: "running",
    exited: "exited",
  },
  dialog: {
    titleNew: "New application",
    titleEdit: "Edit application",
    desc: "Pick a shell, working directory and startup commands — then launch with one click.",
    name: "Application name",
    namePlaceholder: "e.g. QA Egg service",
    shell: "Shell",
    cwd: "Working directory (optional)",
    cwdPlaceholder: "E:\\ProjectWork\\…",
    pickDir: "Choose working directory",
    color: "Color",
    commands: "Preset commands",
    commandsHint: "typed into the shell in order; each line can set its own delay",
    addCommand: "Add command",
    delay: "Wait for shell",
    delayHint:
      "Delay before the first preset command is sent. Increase it on slow network drives.",
    autoStart: "Launch on startup",
    autoStartHint: "Start this service automatically when Aemeth Terminal opens",
    cancel: "Cancel",
    save: "Save changes",
    create: "Create application",
    cmdPlaceholder1: "cd E:\\ProjectWork\\qa\\torappu-qa\\qa-egg",
    cmdPlaceholder2: "yarn dev",
  },
  delete: {
    title: "Delete “{name}”?",
    desc: "The configuration is removed permanently and any running terminal is stopped. This cannot be undone.",
    cancel: "Cancel",
    confirm: "Delete",
  },
  terminals: {
    newTab: "New terminal",
    launch: "launch",
    focus: "focus",
    start: "start",
    allOpen: "All applications are open",
    goCreate: "Create an application first…",
    emptyLabel: "no open terminals",
    emptyHint: "Start a service below, or go to applications",
    goApps: "go to applications →",
    bgSessions: "{n} session(s) running in background",
  },
  pane: {
    exited: "exited",
    code: "code {code}",
    restart: "restart",
    close: "close",
  },
  toasts: {
    saved: "Saved “{name}”",
    created: "Created “{name}”",
    deleted: "Deleted “{name}”",
    startFailed: "Failed to start “{name}”",
    restartFailed: "Failed to restart “{name}”",
  },
  app: {
    loading: "loading",
  },
  window: {
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",
  },
};

export const dictionaries: Record<Locale, Dict> = { zh, en };

/** Replace `{key}` placeholders. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function detectLocale(): Locale {
  const lang = typeof navigator !== "undefined" ? navigator.language : "en";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}
