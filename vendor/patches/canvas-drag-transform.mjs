/** 补丁 19：仅替换上游手势判据，不复制 Event/View/Select 的监听与移动循环。 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** @param {string} source @param {string} before @param {string} after */
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('canvas-drag patch anchor drift: ' + before);
  return source.replace(before, after);
}

/** @type {import('esbuild').Plugin} */
export const canvasDragPatch = {
  name: 'canvas-drag-policy',
  setup(build) {
    build.onLoad({ filter: /vendor[\\/]upstream[\\/]src[\\/](core[\\/](event[\\/]Event|view[\\/]View)|plugins[\\/](Select|Drag))\.js$/ }, args => {
      let contents = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
      if (args.path.endsWith('Event.js')) {
        const policy = resolve(dirname(args.path), '../../../../patches/canvas-drag.js');
        contents = 'import { canvasDragAction } from ' + JSON.stringify(policy) + '\n' + contents;
        contents = replaceOnce(contents, '  onMousedown(e) {', `  onMousedown(e) {
    // Node gestures and editing controls never become canvas gestures (middle stays navigation).
    if (typeof this.mindMap.opt.dragCanvasWithModifier === 'boolean' && e.which !== 2 &&
      e.target?.closest?.('.smm-node, input, textarea, select, [contenteditable="true"]')) return`);
        contents = replaceOnce(contents, "    this.emit('mousedown', e, this)",
          "    this.canvasDragAction = canvasDragAction(this.mindMap.opt.dragCanvasWithModifier, e)\n    this.emit('mousedown', e, this)");
        contents = replaceOnce(contents, `      this.isMiddleMousedown ||
      (useLeftKeySelectionRightKeyDrag
        ? this.isRightMousedown
        : this.isLeftMousedown)`, `      this.canvasDragAction === undefined
        ? this.isMiddleMousedown || (useLeftKeySelectionRightKeyDrag ? this.isRightMousedown : this.isLeftMousedown)
        : this.canvasDragAction === 'pan'`);
        contents = replaceOnce(contents, '  onNodeMouseup() {', '  onNodeMouseup() {\n    this.canvasDragAction = undefined');
      } else if (args.path.endsWith('View.js')) {
        contents = replaceOnce(contents, 'e.ctrlKey || e.metaKey || this.mindMap.opt.isDisableDrag',
          "this.mindMap.opt.isDisableDrag || (event.canvasDragAction === undefined ? e.ctrlKey || e.metaKey : event.canvasDragAction !== 'pan')");
      } else if (args.path.endsWith('Select.js')) {
        contents = replaceOnce(contents, `      !(e.ctrlKey || e.metaKey) &&
      (useLeftKeySelectionRightKeyDrag ? e.which !== 1 : e.which !== 3)`, `      this.mindMap.event.canvasDragAction === undefined
        ? !(e.ctrlKey || e.metaKey) && (useLeftKeySelectionRightKeyDrag ? e.which !== 1 : e.which !== 3)
        : this.mindMap.event.canvasDragAction !== 'select'`);
      } else {
        contents = replaceOnce(contents, '      this.mindMap.opt.readonly ||',
          '      this.mindMap.opt.readonly ||\n      (this.mindMap.opt.dragCanvasWithModifier === true && (e.ctrlKey || e.metaKey)) ||');
      }
      return { contents, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};
