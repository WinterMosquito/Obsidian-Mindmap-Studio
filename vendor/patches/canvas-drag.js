/**
 * 补丁 19（K216）：起手时决定原生画布手势，直至 mouseup 保持不变。
 * undefined 保留上游行为；节点 mousedown 自身 stopPropagation，不进入此判据。
 * @param {unknown} basedOnHotkey
 * @param {{ which: number, ctrlKey: boolean, metaKey: boolean }} event
 * @returns {'pan' | 'select' | null | undefined}
 */
export function canvasDragAction(basedOnHotkey, event) {
  if (typeof basedOnHotkey !== 'boolean') return undefined
  if (event.which === 2) return 'pan'
  if (event.which === 3) return 'select'
  if (event.which !== 1) return null
  return Boolean(event.ctrlKey || event.metaKey) === basedOnHotkey ? 'pan' : 'select'
}
