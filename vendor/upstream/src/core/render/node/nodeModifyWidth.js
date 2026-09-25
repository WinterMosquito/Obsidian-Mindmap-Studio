import { Rect } from '@svgdotjs/svg.js'

// 初始化拖拽
function initDragHandle() {
  if (!this.checkEnableDragModifyNodeWidth()) {
    return
  }
  // 拖拽手柄元素
  this._dragHandleNodes = null
  // 手柄元素的宽度
  this.dragHandleWidth = 4
  // 鼠标按下时的x坐标
  this.dragHandleMousedownX = 0
  // 鼠标是否处于按下状态
  this.isDragHandleMousedown = false
  // 当前拖拽的手柄序号
  this.dragHandleIndex = 0
  // 鼠标按下时记录当前的customTextWidth值
  this.dragHandleMousedownCustomTextWidth = 0
  // 鼠标按下时记录当前的手型样式
  this.dragHandleMousedownBodyCursor = ''
  // 鼠标按下时记录当前节点的left值
  this.dragHandleMousedownLeft = 0

  // 自有补丁 7（2026-09-25）：只 bind，不在构造期注册全局监听。原实现在每个
  // 节点构造时往 window 挂 mousemove/mouseup、往 mindMap 挂 node_mouseup——
  // 5000 个自绘节点 = 15000 个监听器（打开期注册成本 30–75ms；此后每次鼠标
  // 移动 10000 个 window 监听器全部被调用后靠 `!isDragHandleMousedown` 早退；
  // 且全库无解绑，节点销毁后实例被 window 监听器永久持有——潜伏内存缺陷）。
  // 改为**惰性注册**：拖拽会话（手柄 mousedown）开始才挂、mouseup 收尾即解，
  // 常态零全局监听，会话内行为与原实现一致（同函数引用重复 addEventListener
  // 被浏览器去重，天然幂等）。
  // 自有补丁 7（2026-09-25）：只 bind，不在构造期注册全局监听。原实现在每个
  // 节点构造时往 window 挂 mousemove/mouseup、往 mindMap 挂 node_mouseup——
  // 5000 个自绘节点 = 15000 个监听器（打开期注册成本 30–75ms；此后每次鼠标
  // 移动 10000 个 window 监听器全部被调用后靠 `!isDragHandleMousedown` 早退；
  // 且全库无解绑，节点销毁后实例被 window 监听器永久持有——潜伏内存缺陷）。
  // 改为**惰性注册**：拖拽会话（手柄 mousedown）开始才挂、mouseup 收尾即解，
  // 常态零全局监听，会话内行为与原实现一致（同函数引用重复 addEventListener
  // 被浏览器去重，天然幂等）。
  this.onDragMousemoveHandle = this.onDragMousemoveHandle.bind(this)
  this.onDragMouseupHandle = this.onDragMouseupHandle.bind(this)
}

// 鼠标移动事件
function onDragMousemoveHandle(e) {
  if (!this.isDragHandleMousedown) return
  e.stopPropagation()
  e.preventDefault()
  let {
    minNodeTextModifyWidth,
    maxNodeTextModifyWidth,
    isUseCustomNodeContent,
    customCreateNodeContent
  } = this.mindMap.opt
  const useCustomContent =
    isUseCustomNodeContent && customCreateNodeContent && this._customNodeContent
  document.body.style.cursor = 'ew-resize'
  this.group.css({
    cursor: 'ew-resize'
  })
  const { scaleX } = this.mindMap.draw.transform()
  const ox = e.clientX - this.dragHandleMousedownX
  let newWidth =
    this.dragHandleMousedownCustomTextWidth +
    (this.dragHandleIndex === 0 ? -ox : ox) / scaleX
  newWidth = Math.max(newWidth, minNodeTextModifyWidth)
  if (maxNodeTextModifyWidth !== -1) {
    newWidth = Math.min(newWidth, maxNodeTextModifyWidth)
  }
  // 如果存在图片，那么最小值需要考虑图片宽度
  if (!useCustomContent && this.getData('image')) {
    const imgSize = this.getImgShowSize()
    if (
      this._rectInfo.textContentWidth - this.customTextWidth + newWidth <=
      imgSize[0]
    ) {
      newWidth =
        imgSize[0] + this.customTextWidth - this._rectInfo.textContentWidth
    }
  }
  this.customTextWidth = newWidth
  if (this.dragHandleIndex === 0) {
    this.left = this.dragHandleMousedownLeft + ox / scaleX
  }
  // 自定义内容不重新渲染，交给开发者
  this.reRender(useCustomContent ? [] : ['text'], {
    ignoreUpdateCustomTextWidth: true
  })
}

// 鼠标松开事件
function onDragMouseupHandle() {
  // 补丁 7：拖拽会话中节点可能已被删除（删除命令/撤销），group 已置 null——
  // 直接收尾解绑，避免触碰已销毁的 group（原实现监听器永挂，同样存在此窗口）。
  if (!this.isDragHandleMousedown || !this.group) {
    this.unbindDragHandleGlobalEvents()
    this.isDragHandleMousedown = false
    return
  }
  document.body.style.cursor = this.dragHandleMousedownBodyCursor
  this.group.css({
    cursor: 'default'
  })
  this.isDragHandleMousedown = false
  this.dragHandleMousedownX = 0
  this.dragHandleIndex = 0
  this.dragHandleMousedownCustomTextWidth = 0
  this.setData({
    customTextWidth: this.customTextWidth
  })
  this.mindMap.render()
  this.mindMap.emit('dragModifyNodeWidthEnd', this)
  // 补丁 7：会话结束即解绑全局监听（常态零监听）
  this.unbindDragHandleGlobalEvents()
}

// 插件拖拽手柄元素
function createDragHandleNode() {
  const list = [new Rect(), new Rect()]
  list.forEach((node, index) => {
    node
      .size(this.dragHandleWidth, this.height)
      .fill({
        color: 'transparent'
      })
      .css({
        cursor: 'ew-resize'
      })
    node.on('mousedown', e => {
      e.stopPropagation()
      e.preventDefault()
      this.dragHandleMousedownX = e.clientX
      this.dragHandleIndex = index
      this.dragHandleMousedownCustomTextWidth =
        this.customTextWidth === undefined
          ? this._textData
            ? this._textData.width
            : this.width
          : this.customTextWidth
      this.dragHandleMousedownBodyCursor = document.body.style.cursor
      this.dragHandleMousedownLeft = this.left
      this.isDragHandleMousedown = true
      // 补丁 7：拖拽会话开始，惰性注册全局监听（同引用重复注册被浏览器去重）
      window.addEventListener('mousemove', this.onDragMousemoveHandle)
      window.addEventListener('mouseup', this.onDragMouseupHandle)
      this.mindMap.on('node_mouseup', this.onDragMouseupHandle)
    })
  })
  return list
}

// 更新拖拽按钮的显隐和位置尺寸
function updateDragHandle() {
  if (!this.checkEnableDragModifyNodeWidth()) return
  if (!this._dragHandleNodes) {
    this._dragHandleNodes = this.createDragHandleNode()
  }
  if (this.getData('isActive')) {
    this._dragHandleNodes.forEach(node => {
      node.height(this.height)
      this.group.add(node)
    })
    this._dragHandleNodes[1].x(this.width - this.dragHandleWidth)
  } else {
    this._dragHandleNodes.forEach(node => {
      node.remove()
    })
  }
}

// 补丁 7：解绑拖拽会话的全局监听（mouseup 收尾调用；幂等，未注册时为无操作）
function unbindDragHandleGlobalEvents() {
  if (!this.onDragMousemoveHandle || !this.onDragMouseupHandle) return
  window.removeEventListener('mousemove', this.onDragMousemoveHandle)
  window.removeEventListener('mouseup', this.onDragMouseupHandle)
  this.mindMap.off('node_mouseup', this.onDragMouseupHandle)
}

export default {
  initDragHandle,
  onDragMousemoveHandle,
  onDragMouseupHandle,
  unbindDragHandleGlobalEvents,
  createDragHandleNode,
  updateDragHandle
}
