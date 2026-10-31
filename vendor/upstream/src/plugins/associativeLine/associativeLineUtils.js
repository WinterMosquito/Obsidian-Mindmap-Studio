import { getRectRelativePosition } from '../../utils/index'

// 获取目标节点在起始节点的目标数组中的索引
export const getAssociativeLineTargetIndex = (node, toNode) => {
  return node.getData('associativeLineTargets').findIndex(item => {
    return item === toNode.getData('uid')
  })
}

// 计算贝塞尔曲线的控制点
export const computeCubicBezierPathPoints = (x1, y1, x2, y2) => {
  const min = 5
  let cx1 = x1 + (x2 - x1) / 2
  let cy1 = y1
  let cx2 = cx1
  let cy2 = y2
  if (Math.abs(x1 - x2) <= min) {
    cx1 = x1 + (y2 - y1) / 2
    cx2 = cx1
  }
  if (Math.abs(y1 - y2) <= min) {
    cx1 = x1
    cy1 = y1 - (x2 - x1) / 2
    cx2 = x2
    cy2 = cy1
  }
  return [
    {
      x: cx1,
      y: cy1
    },
    {
      x: cx2,
      y: cy2
    }
  ]
}

// 拼接贝塞尔曲线路径
export const joinCubicBezierPath = (startPoint, endPoint, point1, point2) => {
  return `M ${startPoint.x},${startPoint.y} C ${point1.x},${point1.y} ${point2.x},${point2.y} ${endPoint.x},${endPoint.y}`
}

//  获取节点的位置信息
const getNodeRect = node => {
  let { left, top, width, height } = node
  return {
    right: left + width,
    bottom: top + height,
    left,
    top,
    width,
    height
  }
}

// 三次贝塞尔曲线
export const cubicBezierPath = (x1, y1, x2, y2) => {
  let points = computeCubicBezierPathPoints(x1, y1, x2, y2)
  return joinCubicBezierPath(
    { x: x1, y: y1 },
    { x: x2, y: y2 },
    points[0],
    points[1]
  )
}

export const calcPoint = (node, e) => {
  const { left, top, translateLeft, translateTop, width, height } = node
  const clientX = e.clientX
  const clientY = e.clientY
  // 中心点的坐标
  const centerX = translateLeft + width / 2
  const centerY = translateTop + height / 2
  const translateCenterX = left + width / 2
  const translateCenterY = top + height / 2
  const theta = Math.atan(height / width)
  // 矩形左上角坐标
  const deltaX = clientX - centerX
  const deltaY = centerY - clientY
  // 方向值
  const direction = Math.atan2(deltaY, deltaX)
  // 默认坐标
  let x = left + width
  let y = top + height
  if (direction < theta && direction >= -theta) {
    // 右边
    // 正切值 = 对边/邻边，对边 = 正切值*邻边
    const range = direction * (width / 2)
    if (direction < theta && direction >= 0) {
      // 中心点上边
      y = translateCenterY - range
    } else if (direction >= -theta && direction < 0) {
      //  中心点下方
      y = translateCenterY - range
    }
    return {
      x,
      y,
      dir: 'right',
      range
    }
  } else if (direction >= theta && direction < Math.PI - theta) {
    // 上边
    y = top
    let range = 0
    if (direction < Math.PI / 2 - theta && direction >= theta) {
      // 正切值 = 对边/邻边，邻边 = 对边/正切值
      const side = height / 2 / direction
      range = -side
      // 中心点右侧
      x = translateCenterX + side
    } else if (
      direction >= Math.PI / 2 - theta &&
      direction < Math.PI - theta
    ) {
      // 中心点左侧
      const tanValue = (centerX - clientX) / (centerY - clientY)
      const side = (height / 2) * tanValue
      range = side
      x = translateCenterX - side
    }
    return {
      x,
      y,
      dir: 'top',
      range
    }
  } else if (direction < -theta && direction >= theta - Math.PI) {
    // 下边
    let range = 0
    if (direction >= theta - Math.PI / 2 && direction < -theta) {
      // 中心点右侧
      // 正切值 = 对边/邻边，邻边 = 对边/正切值
      const side = height / 2 / direction
      range = side
      x = translateCenterX - side
    } else if (
      direction < theta - Math.PI / 2 &&
      direction >= theta - Math.PI
    ) {
      // 中心点左侧
      const tanValue = (centerX - clientX) / (centerY - clientY)
      const side = (height / 2) * tanValue
      range = -side
      x = translateCenterX + side
    }
    return {
      x,
      y,
      dir: 'bottom',
      range
    }
  }
  // 左边
  x = left
  const tanValue = (centerY - clientY) / (centerX - clientX)
  const range = tanValue * (width / 2)
  if (direction >= -Math.PI && direction < theta - Math.PI) {
    // 中心点右侧
    y = translateCenterY - range
  } else if (direction < Math.PI && direction >= Math.PI - theta) {
    //  中心点左侧
    y = translateCenterY - range
  }
  return {
    x,
    y,
    dir: 'left',
    range
  }
}
// 获取节点的连接点
export const getNodePoint = (node, dir = 'right', range = 0, e = null) => {
  let { left, top, width, height } = node
  if (e) {
    return calcPoint(node, e)
  }
  switch (dir) {
    case 'left':
      return {
        x: left,
        y: top + height / 2 - range,
        dir
      }
    case 'right':
      return {
        x: left + width,
        y: top + height / 2 - range,
        dir
      }
    case 'top':
      return {
        x: left + width / 2 - range,
        y: top,
        dir
      }
    case 'bottom':
      return {
        x: left + width / 2 - range,
        y: top + height,
        dir
      }
    default:
      break
  }
}

// 根据两个节点的位置计算节点的连接点
export const computeNodePoints = (fromNode, toNode) => {
  const fromRect = getNodeRect(fromNode)
  const toRect = getNodeRect(toNode)
  let fromDir = ''
  let toDir = ''
  const dir = getRectRelativePosition(
    {
      x: fromRect.left,
      y: fromRect.top,
      width: fromRect.width,
      height: fromRect.height
    },
    {
      x: toRect.left,
      y: toRect.top,
      width: toRect.width,
      height: toRect.height
    }
  )
  // 起始矩形在结束矩形的什么方向
  switch (dir) {
    case 'left-top':
      fromDir = 'right'
      toDir = 'top'
      break
    case 'right-top':
      fromDir = 'left'
      toDir = 'top'
      break
    case 'right-bottom':
      fromDir = 'left'
      toDir = 'bottom'
      break
    case 'left-bottom':
      fromDir = 'right'
      toDir = 'bottom'
      break
    case 'left':
      fromDir = 'right'
      toDir = 'left'
      break
    case 'right':
      fromDir = 'left'
      toDir = 'right'
      break
    case 'top':
      fromDir = 'right'
      toDir = 'right'
      break
    case 'bottom':
      fromDir = 'left'
      toDir = 'left'
      break
    case 'overlap':
      fromDir = 'right'
      toDir = 'right'
      break
    default:
      break
  }
  return [getNodePoint(fromNode, fromDir), getNodePoint(toNode, toDir)]
}

// 获取节点的关联线路径
export const getNodeLinePath = (startPoint, endPoint, node, toNode) => {
  let targetIndex = getAssociativeLineTargetIndex(node, toNode)
  // 控制点
  let controlPoints = []
  let associativeLineTargetControlOffsets = node.getData(
    'associativeLineTargetControlOffsets'
  )
  if (
    associativeLineTargetControlOffsets &&
    associativeLineTargetControlOffsets[targetIndex]
  ) {
    // 节点保存了控制点差值
    let offsets = associativeLineTargetControlOffsets[targetIndex]
    controlPoints = [
      {
        x: startPoint.x + offsets[0].x,
        y: startPoint.y + offsets[0].y
      },
      {
        x: endPoint.x + offsets[1].x,
        y: endPoint.y + offsets[1].y
      }
    ]
  } else {
    // 【自有补丁 15】控制点沿**锚点外法线**伸出。
    //
    // 原实现取"中心连线中点"作控制点：目标在侧后方时（如上下相邻、横向略有错位），
    // 控制点会落进**源节点内部**，曲线于是从节点里绕出来（2026-10-30 实机采样：
    // 一条边 21 个采样点有 11 个落在源节点框内，用户观感「线怎么从节点里出发」）。
    // 改为各自沿所在边向外伸 k 像素——曲线恒先离开节点、再弯向目标，任何方向都成立。
    //
    // 本插件**不做自动选路**（2026-10-30 用户裁决）：线怎么走由用户在画布上依次点放
    // 两个手柄决定，那些边存了 `associativeLineTargetControlOffsets`，走上面的分支。
    // 这里只兜底「文件里没写 `geo=`」的边（例如用户手写的 `%%rel%%`）。
    // 「绕行折点」(`associativeLinePoint[i].waypoint`) 随自动选路一并删除。
    const dirVector = dir => {
      switch (dir) {
        case 'left':
          return { x: -1, y: 0 }
        case 'right':
          return { x: 1, y: 0 }
        case 'top':
          return { x: 0, y: -1 }
        case 'bottom':
          return { x: 0, y: 1 }
        default:
          return { x: 1, y: 0 }
      }
    }
    // 【自有补丁 15－b】控制点伸展取 clamp(d/4, 20, 40)（原 clamp(d/3, 24, 80)）：
    // 跨度越大鼓包越大，同一张图里会同时出现"贴边小半圆"与"甩到天边的弹簧"
    // （170px 跨距甩 57px、>240px 顶到 80px）。收窄后全程 20–40，短边也先探出节点。
    const reachOf = distance => Math.min(40, Math.max(20, distance / 4))
    const startVector = dirVector(startPoint.dir)
    const endVector = dirVector(endPoint.dir)
    const distance = Math.hypot(
      endPoint.x - startPoint.x,
      endPoint.y - startPoint.y
    )
    const reach = reachOf(distance)
    controlPoints = [
      {
        x: startPoint.x + startVector.x * reach,
        y: startPoint.y + startVector.y * reach
      },
      {
        x: endPoint.x + endVector.x * reach,
        y: endPoint.y + endVector.y * reach
      }
    ]
  }
  // 根据控制点拼接贝塞尔曲线路径
  return {
    path: joinCubicBezierPath(
      startPoint,
      endPoint,
      controlPoints[0],
      controlPoints[1]
    ),
    controlPoints
  }
}

// 获取默认的控制点差值
export const getDefaultControlPointOffsets = (startPoint, endPoint) => {
  let controlPoints = computeCubicBezierPathPoints(
    startPoint.x,
    startPoint.y,
    endPoint.x,
    endPoint.y
  )
  return [
    {
      x: controlPoints[0].x - startPoint.x,
      y: controlPoints[0].y - startPoint.y
    },
    {
      x: controlPoints[1].x - endPoint.x,
      y: controlPoints[1].y - endPoint.y
    }
  ]
}
