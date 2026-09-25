import Base from './Base'
import { walk, asyncRun, getNodeIndexInNodeList } from '../utils'
import { CONSTANTS } from '../constants/constant'

//  逻辑结构图
class LogicalStructure extends Base {
  //  构造函数
  constructor(opt = {}, layout) {
    super(opt)
    this.isUseLeft = layout === CONSTANTS.LAYOUT.LOGICAL_STRUCTURE_LEFT
  }

  //  布局
  doLayout(callback) {
    let task = [
      () => {
        this.computedBaseValue()
      },
      () => {
        this.computedTopValue()
      },
      () => {
        this.adjustTopValue()
      },
      () => {
        callback(this.root)
      }
    ]
    asyncRun(task)
  }

  //  遍历数据计算节点的left、width、height
  computedBaseValue() {
    let sortIndex = 0
    walk(
      this.renderer.renderTree,
      null,
      (cur, parent, isRoot, layerIndex, index, ancestors) => {
        let newNode = this.createNode(cur, parent, isRoot, layerIndex, index, ancestors)
        newNode.sortIndex = sortIndex
        sortIndex++
        // 根节点定位在画布中心位置
        if (isRoot) {
          this.setNodeCenter(newNode)
        } else {
          // 非根节点
          // 定位到父节点右侧
          if (this.isUseLeft) {
            newNode.left =
              parent._node.left - newNode.width - this.getMarginX(layerIndex)
          } else {
            newNode.left =
              parent._node.left +
              parent._node.width +
              this.getMarginX(layerIndex)
          }
        }
        if (!cur.data.expand) {
          return true
        }
      },
      (cur, parent, isRoot, layerIndex) => {
        // 返回时计算节点的areaHeight，也就是子节点所占的高度之和，包括外边距
        let len = cur.data.expand === false ? 0 : cur._node.children.length
        cur._node.childrenAreaHeight = len
          ? cur._node.children.reduce((h, item) => {
              return h + item.height
            }, 0) +
            (len + 1) * this.getMarginY(layerIndex + 1)
          : 0
        // 如果存在概要，则和概要的高度取最大值
        let generalizationNodeHeight = cur._node.checkHasGeneralization()
          ? cur._node._generalizationNodeHeight +
            this.getMarginY(layerIndex + 1)
          : 0
        cur._node.childrenAreaHeight2 = Math.max(
          cur._node.childrenAreaHeight,
          generalizationNodeHeight
        )
      },
      true,
      0
    )
  }

  //  遍历节点树计算节点的top
  computedTopValue() {
    walk(
      this.root,
      null,
      (node, parent, isRoot, layerIndex) => {
        if (node.getData('expand') && node.children && node.children.length) {
          let marginY = this.getMarginY(layerIndex + 1)
          // 第一个子节点的top值 = 该节点中心的top值 - 子节点的高度之和的一半
          let top = node.top + node.height / 2 - node.childrenAreaHeight / 2
          let totalTop = top + marginY
          node.children.forEach(cur => {
            cur.top = totalTop
            totalTop += cur.height + marginY
          })
        }
      },
      null,
      true
    )
  }

  //  调整节点top
  adjustTopValue() {
    // 自有补丁 9（2026-09-25）：延迟物化。原实现 updateBrothers 逐次对兄弟
    // 子树**立即全量平移**，5000 节点图实测 `updateChildren` 平移 **293 万
    // 节点次**（约节点数的 584 倍：同一子树被多级祖先的 updateBrothers 反复
    // 平移）。因本 task 的 difference 判定只读 childrenAreaHeight2/height/
    // margin（不读 top）、task 内无外部观察者（同步段，物化前置无消费者），
    // 平移可安全延迟：updateBrothers 只做**记账**（子树根 + 累计 offset），
    // task 末尾一次自顶向下物化（O(n)）。位移线性可加、平移不改结构 ⇒ 与
    // 原实现语义等价（几何输出逐字节一致，多布局探针与位置断言兜底）。
    this._topOffsetMap = new Map()
    walk(
      this.root,
      null,
      (node, parent, isRoot, layerIndex) => {
        if (!node.getData('expand')) {
          return
        }
        // 判断子节点所占的高度之和是否大于该节点自身，大于则需要调整位置
        let difference =
          node.childrenAreaHeight2 -
          this.getMarginY(layerIndex + 1) * 2 -
          node.height
        if (difference > 0) {
          this.updateBrothers(node, difference / 2)
        }
      },
      null,
      true
    )
    this.applyTopOffsets()
  }

  //  更新兄弟节点的top（补丁 9：记账，不立即平移）
  updateBrothers(node, addHeight) {
    if (node.parent) {
      let childrenList = node.parent.children
      let index = getNodeIndexInNodeList(node, childrenList)
      const map = this._topOffsetMap
      childrenList.forEach((item, _index) => {
        if (item.uid === node.uid || item.hasCustomPosition()) {
          // 适配自定义位置
          return
        }
        let _offset = 0
        // 上面的节点往上移
        if (_index < index) {
          _offset = -addHeight
        } else if (_index > index) {
          // 下面的节点往下移
          _offset = addHeight
        }
        if (_offset !== 0) {
          // 该兄弟及其整棵子树平移 _offset：记账到子树根（多次记账累加）
          map.set(item, (map.get(item) || 0) + _offset)
        }
      })
      // 更新父节点的位置
      this.updateBrothers(node.parent, addHeight)
    }
  }

  //  物化记账的 top 位移（补丁 9）：自顶向下传播累计值，每节点一次加法
  applyTopOffsets() {
    const map = this._topOffsetMap
    this._topOffsetMap = null
    if (!map || map.size === 0) {
      return
    }
    // 等价性要点（对齐原实现的 updateChildren 递归语义）：
    // ① 节点**自身**的位移无条件应用（原实现 `item[prop] += offset` 无条件）；
    // ② 「祖先记账」的继承在 hasCustomPosition 节点处**截断**（原实现
    //    `!item.hasCustomPosition()` 才递归进其 children），故 nextAcc = 0；
    // ③ 但**遍历不截断**——被截断的只是「继承来的累计」，节点自身作为
    //    记账根的位移仍要生效（原实现中这些节点经 updateBrothers 直接
    //    调用 updateChildren 平移，不经其自定义位置祖先）。
    const apply = (node, acc) => {
      const own = map.get(node)
      const total = own === undefined ? acc : acc + own
      if (total !== 0) {
        // 无 customTop 分量的节点字段直写（补丁 8 口径，避免访问器）
        if (node.customTop === undefined) {
          node._top += total
        } else {
          node.top += total
        }
      }
      if (node.children && node.children.length) {
        const nextAcc = node.hasCustomPosition() ? 0 : total
        node.children.forEach(child => apply(child, nextAcc))
      }
    }
    apply(this.root, 0)
  }

  //  绘制连线，连接该节点到其子节点
  renderLine(node, lines, style, lineStyle) {
    if (lineStyle === 'curve') {
      this.renderLineCurve(node, lines, style)
    } else if (lineStyle === 'direct') {
      this.renderLineDirect(node, lines, style)
    } else {
      this.renderLineStraight(node, lines, style)
    }
  }

  //  直线风格连线
  renderLineStraight(node, lines, style) {
    if (node.children.length <= 0) {
      return []
    }
    let { left, top, width, height, expandBtnSize } = node
    const { alwaysShowExpandBtn, notShowExpandBtn } = this.mindMap.opt
    if (!alwaysShowExpandBtn || notShowExpandBtn) {
      expandBtnSize = 0
    }
    let marginX = this.getMarginX(node.layerIndex + 1)
    let s1 = (marginX - expandBtnSize) * 0.6
    if (this.isUseLeft) {
      s1 *= -1
    }
    let nodeUseLineStyle = this.mindMap.themeConfig.nodeUseLineStyle
    node.children.forEach((item, index) => {
      let x1
      if (this.isUseLeft) {
        x1 = node.layerIndex === 0 ? left : left - expandBtnSize
      } else {
        x1 = node.layerIndex === 0 ? left + width : left + width + expandBtnSize
      }
      let y1 = top + height / 2
      let x2 = this.isUseLeft ? item.left + item.width : item.left
      let y2 = item.top + item.height / 2
      // 节点使用横线风格，需要额外渲染横线
      let nodeUseLineStyleOffset = nodeUseLineStyle
        ? item.width * (this.isUseLeft ? -1 : 1)
        : 0
      y1 = nodeUseLineStyle && !node.isRoot ? y1 + height / 2 : y1
      y2 = nodeUseLineStyle ? y2 + item.height / 2 : y2
      let path = this.createFoldLine([
        [x1, y1],
        [x1 + s1, y1],
        [x1 + s1, y2],
        [x2 + nodeUseLineStyleOffset, y2]
      ])
      this.setLineStyle(style, lines[index], path, item)
    })
  }

  //  直连风格
  renderLineDirect(node, lines, style) {
    if (node.children.length <= 0) {
      return []
    }
    let { left, top, width, height, expandBtnSize } = node
    const { alwaysShowExpandBtn, notShowExpandBtn } = this.mindMap.opt
    if (!alwaysShowExpandBtn || notShowExpandBtn) {
      expandBtnSize = 0
    }
    const { nodeUseLineStyle } = this.mindMap.themeConfig
    node.children.forEach((item, index) => {
      if (node.layerIndex === 0) {
        expandBtnSize = 0
      }
      let x1 = this.isUseLeft
        ? left - expandBtnSize
        : left + width + expandBtnSize
      let y1 = top + height / 2
      let x2 = this.isUseLeft ? item.left + item.width : item.left
      let y2 = item.top + item.height / 2
      y1 = nodeUseLineStyle && !node.isRoot ? y1 + height / 2 : y1
      y2 = nodeUseLineStyle ? y2 + item.height / 2 : y2
      // 节点使用横线风格，需要额外渲染横线
      let nodeUseLineStylePath = nodeUseLineStyle
        ? ` L ${this.isUseLeft ? item.left : item.left + item.width},${y2}`
        : ''
      let path = `M ${x1},${y1} L ${x2},${y2}` + nodeUseLineStylePath
      this.setLineStyle(style, lines[index], path, item)
    })
  }

  //  曲线风格连线
  renderLineCurve(node, lines, style) {
    if (node.children.length <= 0) {
      return []
    }
    let { left, top, width, height, expandBtnSize } = node
    const { alwaysShowExpandBtn, notShowExpandBtn } = this.mindMap.opt
    if (!alwaysShowExpandBtn || notShowExpandBtn) {
      expandBtnSize = 0
    }
    const {
      nodeUseLineStyle,
      rootLineStartPositionKeepSameInCurve,
      rootLineKeepSameInCurve
    } = this.mindMap.themeConfig
    node.children.forEach((item, index) => {
      if (node.layerIndex === 0) {
        expandBtnSize = 0
      }
      let x1
      if (this.isUseLeft) {
        x1 =
          node.layerIndex === 0 && !rootLineStartPositionKeepSameInCurve
            ? left + width / 2
            : left - expandBtnSize
      } else {
        x1 =
          node.layerIndex === 0 && !rootLineStartPositionKeepSameInCurve
            ? left + width / 2
            : left + width + expandBtnSize
      }
      let y1 = top + height / 2
      let x2 = this.isUseLeft ? item.left + item.width : item.left
      let y2 = item.top + item.height / 2
      let path = ''
      y1 = nodeUseLineStyle && !node.isRoot ? y1 + height / 2 : y1
      y2 = nodeUseLineStyle ? y2 + item.height / 2 : y2
      // 节点使用横线风格，需要额外渲染横线
      let nodeUseLineStylePath
      if (this.isUseLeft) {
        nodeUseLineStylePath = nodeUseLineStyle ? ` L ${item.left},${y2}` : ''
      } else {
        nodeUseLineStylePath = nodeUseLineStyle
          ? ` L ${item.left + item.width},${y2}`
          : ''
      }
      if (node.isRoot && !rootLineKeepSameInCurve) {
        path = this.quadraticCurvePath(x1, y1, x2, y2) + nodeUseLineStylePath
      } else {
        path = this.cubicBezierPath(x1, y1, x2, y2) + nodeUseLineStylePath
      }
      this.setLineStyle(style, lines[index], path, item)
    })
  }

  //  渲染按钮
  renderExpandBtn(node, btn) {
    let { width, height, expandBtnSize, layerIndex } = node
    if (layerIndex === 0) {
      expandBtnSize = 0
    }
    let { translateX, translateY } = btn.transform()
    // 节点使用横线风格，需要调整展开收起按钮位置
    let nodeUseLineStyleOffset = this.mindMap.themeConfig.nodeUseLineStyle
      ? height / 2
      : 0
    // 位置没有变化则返回
    let _x = this.isUseLeft ? 0 - expandBtnSize : width
    let _y = height / 2 + nodeUseLineStyleOffset
    if (_x === translateX && _y === translateY) {
      return
    }
    btn.translate(_x - translateX, _y - translateY)
  }

  //  创建概要节点
  renderGeneralization(list) {
    list.forEach(item => {
      let {
        left,
        top,
        bottom,
        right,
        generalizationLineMargin,
        generalizationNodeMargin
      } = this.getNodeGeneralizationRenderBoundaries(item, 'h')
      let x = this.isUseLeft
        ? left - generalizationLineMargin
        : right + generalizationLineMargin
      let x1 = x
      let y1 = top
      let x2 = x
      let y2 = bottom
      let cx = x1 + (this.isUseLeft ? -20 : 20)
      let cy = y1 + (y2 - y1) / 2
      let path = `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`
      item.generalizationLine.plot(path)
      item.generalizationNode.left =
        x +
        (this.isUseLeft
          ? -generalizationNodeMargin
          : generalizationNodeMargin) -
        (this.isUseLeft ? item.generalizationNode.width : 0)
      item.generalizationNode.top =
        top + (bottom - top - item.generalizationNode.height) / 2
    })
  }

  // 渲染展开收起按钮的隐藏占位元素
  renderExpandBtnRect(rect, expandBtnSize, width, height) {
    if (this.isUseLeft) {
      rect.size(expandBtnSize, height).x(-expandBtnSize).y(0)
    } else {
      rect.size(expandBtnSize, height).x(width).y(0)
    }
  }
}

export default LogicalStructure
