/**
 * vitest 全局 setup：Node 环境下的 window 桩。
 *
 * concurrency 原语（防抖 / 节流）经 window.setTimeout 计时——插件运行于
 * Electron 渲染进程，window 恒存在；Node 测试环境没有 window，把 window
 * 指向 globalThis，这些调用即落到可被 vi.useFakeTimers() 拦截的全局定时器上。
 *
 * （obsidianmd/no-global-this 已对 tests/** 豁免，见 eslint.config.mts。）
 */
(globalThis as { window?: unknown }).window ??= globalThis;
