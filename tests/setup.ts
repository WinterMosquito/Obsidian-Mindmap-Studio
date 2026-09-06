/**
 * vitest 全局 setup：Node 环境的 window 桩。
 *
 * concurrency 原语（防抖/节流）经 window.setTimeout 计时——插件运行于
 * Electron 渲染进程，window 恒存在；Node 测试下把 window 指向 globalThis，
 * 让这些调用落到（可被 fake timers 拦截的）全局定时器上。
 * （obsidianmd/no-global-this 对 tests/** 已在 eslint.config.mts 豁免。）
 */
(globalThis as { window?: unknown }).window ??= globalThis;
