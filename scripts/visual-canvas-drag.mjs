/** K216：独立 Chrome 页面，执行实际 vendor 事件、框选、平移与节点 Drag。 */
import { join } from 'node:path';

export function buildCanvasDragEntrySource(root) {
  const engine = join(root, 'src/engine/mindmap.ts').replaceAll('\\', '/');
  return `
import { createMindMap, applyCanvasDragMode } from ${JSON.stringify(engine)};
const probe = document.createElement('pre'); probe.id = 'canvas-drag-probe'; document.body.appendChild(probe);
const report = { cases: [], assertions: 0 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, label) => { report.assertions++; if (!value) throw new Error(label); };
const options = { layout: 'logicalStructure', lineStyle: 'straight', themePref: 'light', themeStyle: 'default', palette: 'default', isDark: false, enableDrag: true, lang: 'en' };
const gesture = (map, target, from, to, keys = {}, button = 0) => {
  const bits = button === 0 ? 1 : button === 1 ? 4 : 2;
  target.dispatchEvent(new MouseEvent('mousedown', { ...from, ...keys, button, buttons: bits, bubbles: true, cancelable: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { ...to, ...keys, button, buttons: bits, bubbles: true, cancelable: true }));
};
const end = (to, keys = {}, button = 0) => window.dispatchEvent(new MouseEvent('mouseup', { ...to, ...keys, button, buttons: 0, bubbles: true }));
const view = map => ({ x: map.view.x, y: map.view.y, scale: map.view.scale });
const sameView = (map, old) => map.view.x === old.x && map.view.y === old.y && map.view.scale === old.scale;
const tree = map => JSON.stringify(map.getData(), (key, value) => key === 'isActive' ? undefined : value);
const center = node => { const box = node.group.node.getBoundingClientRect(); return { clientX: (box.left + box.right) / 2, clientY: (box.top + box.bottom) / 2 }; };
async function make(extra = {}) {
  const holder = document.createElement('div'); holder.style.cssText = 'width:1000px;height:500px;position:relative'; document.body.appendChild(holder);
  const map = createMindMap(holder, { data: { text: 'Root', uid: 'root' }, children: [{ data: { text: 'First', uid: 'first' }, children: [] }, { data: { text: 'Second', uid: 'second' }, children: [] }] }, { ...options, ...extra });
  for (let n = 0; n < 150 && (!map.renderer.root || holder.querySelectorAll('.smm-node').length < 3); n++) await pause(10);
  assert(holder.querySelectorAll('.smm-node').length === 3, 'engine ready');
  await pause(120);
  map.opt.selectTranslateStep = 0;
  return { map, holder, dispose: () => { map.destroy(); holder.remove(); } };
}
(async () => {
  try {
    for (const enabled of [true, false]) for (const scale of [0.5, 1, 2.35]) for (const modifier of ['plain', 'ctrlKey', 'metaKey']) {
      const { map, holder, dispose } = await make();
      const identity = map.renderer.root;
      const original = tree(map), history = map.command.history.length;
      let dataChanges = 0; map.on('data_change', () => dataChanges++);
      applyCanvasDragMode(map, enabled);
      assert(identity === map.renderer.root && tree(map) === original, 'runtime toggle preserves tree/engine');
      map.view.setScale(scale); map.renderer.moveNodeToCenter(map.renderer.root);
      const before = view(map), keys = modifier === 'plain' ? {} : { [modifier]: true };
      const pan = (modifier !== 'plain') === enabled;
      const box = map.renderer.root.group.node.getBoundingClientRect();
      const rect = holder.getBoundingClientRect();
      const from = pan ? { clientX: rect.left + 20, clientY: rect.top + 20 } : { clientX: box.left - 15, clientY: box.top - 15 };
      const to = pan ? { clientX: from.clientX + 85, clientY: from.clientY + 55 } : { clientX: box.right + 15, clientY: box.bottom + 15 };
      gesture(map, map.svg.node, from, to, keys); await pause(pan ? 35 : 350);
      if (pan) {
        assert(map.view.x === before.x + 85 && map.view.y === before.y + 55, 'pan follows screen delta at ' + scale);
        assert(!map.select.isMousedown && !map.select.rect, 'pan does not select');
      } else {
        assert(sameView(map, before) && map.select.rect && map.select.isSelecting, 'selection does not pan');
        assert(map.renderer.activeNodeList.length > 0, 'selection activates enclosed node');
      }
      end(to, keys); await pause(30);
      assert(tree(map) === original && map.command.history.length === history && dataChanges === 0, 'canvas gesture does not edit/history/save');
      report.cases.push({ enabled, scale, modifier, pan }); dispose();
    }
    for (const enabled of [true, false]) {
      const { map, holder, dispose } = await make({ dragCanvasWithModifier: enabled });
      const rect = holder.getBoundingClientRect(), from = { clientX: rect.left + 20, clientY: rect.top + 20 }, to = { clientX: from.clientX + 75, clientY: from.clientY + 45 };
      let before = view(map);
      gesture(map, map.svg.node, from, to, {}, 1); assert(map.view.x === before.x + 75 && !map.select.isMousedown, 'middle pans'); end(to, {}, 1);
      before = view(map);
      gesture(map, map.svg.node, from, to, {}, 2); assert(sameView(map, before) && map.select.rect, 'right selection retained'); end(to, {}, 2);
      let menus = 0; map.on('contextmenu', () => menus++);
      map.svg.node.dispatchEvent(new MouseEvent('contextmenu', { ...to, button: 2, bubbles: true, cancelable: true }));
      assert(menus === 1, 'context menu remains');
      for (const modifier of ['ctrlKey', 'metaKey']) {
        before = view(map); const oldScale = before.scale;
        holder.dispatchEvent(new WheelEvent('wheel', { ...from, [modifier]: true, deltaY: -120, bubbles: true, cancelable: true }));
        assert(map.view.scale !== oldScale, modifier + ' wheel zoom');
        const original = tree(map);
        for (const node of [map.renderer.root, map.renderer.root.children[0]]) {
          before = view(map); const start = center(node);
          gesture(map, node.group.node, start, { clientX: start.clientX + 30, clientY: start.clientY + 20 }, { [modifier]: true });
          assert(sameView(map, before), 'node-origin never canvas pan');
          if (enabled) assert(!map.drag.isMousedown && tree(map) === original, 'hotkey node-origin never structure drag');
          end(to, { [modifier]: true }); await pause(30);
        }
      }
      const textarea = document.createElement('textarea'); holder.appendChild(textarea);
      before = view(map);
      gesture(map, textarea, from, to, { metaKey: enabled });
      assert(sameView(map, before) && !map.select.isMousedown, 'editing controls do not start canvas gesture'); end(to); textarea.remove();
      // 原生无修饰键结构拖动仍起手，空白落点保持树；不新增第二条落点循环。
      const source = map.renderer.root.children[0], start = center(source), original = tree(map);
      before = view(map); gesture(map, source.group.node, start, from);
      assert(map.drag.isMousedown && sameView(map, before), 'plain node drag retains original owner');
      end(from); await pause(40); assert(tree(map) === original, 'invalid node drop returns');
      dispose();
    }
    // 模式与热键变化不改变已经开始的手势。
    const { map, holder, dispose } = await make();
    const rect = holder.getBoundingClientRect(), from = { clientX: rect.left + 20, clientY: rect.top + 20 }, to = { clientX: from.clientX + 40, clientY: from.clientY + 30 };
    let before = view(map); gesture(map, map.svg.node, from, to);
    applyCanvasDragMode(map, false);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: to.clientX + 30, clientY: to.clientY + 30, buttons: 1, bubbles: true }));
    assert(sameView(map, before) && map.select.isMousedown, 'toggle midway preserves selection'); end(to);
    applyCanvasDragMode(map, true); before = view(map);
    gesture(map, map.svg.node, from, to, { metaKey: true });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: to.clientX + 30, clientY: to.clientY + 30, buttons: 1, bubbles: true }));
    assert(map.view.x === before.x + 70 && map.view.y === before.y + 60 && !map.select.isMousedown, 'release hotkey preserves pan'); end(to); dispose();
    const read = await make({ readonly: true, enableViewDrag: false });
    before = view(read.map); gesture(read.map, read.map.svg.node, from, to, { metaKey: true }); end(to);
    assert(sameView(read.map, before) && !read.map.select?.isMousedown && !read.map.drag?.isMousedown && typeof read.map.opt.dragCanvasWithModifier !== 'boolean', 'readonly embed has no editing gestures'); read.dispose();
    // 同份 bundle 在另一个 Window 中运行，覆盖 popout 的独立全局/DOM realm。
    if (window.parent === window) {
      const frame = document.createElement('iframe'); frame.style.cssText = 'width:1100px;height:600px'; frame.src = location.href; document.body.appendChild(frame);
      let child;
      for (let n = 0; n < 1100; n++) { await pause(10); try { child = JSON.parse(frame.contentDocument.querySelector('#canvas-drag-probe')?.textContent || '{}'); } catch {} if (child?.ok || child?.error) break; }
      assert(child?.ok && child.cases.length === 18, 'separate Window gestures: ' + (child?.error || 'incomplete'));
      report.childAssertions = child.assertions; frame.remove();
    }
    report.ok = true;
  } catch (error) { report.error = String(error); }
  probe.textContent = JSON.stringify(report);
})();
`;
}
