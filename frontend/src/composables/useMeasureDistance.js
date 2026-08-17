import { reactive } from 'vue'
import { getClickPosition } from '../utils/cesiumUtils.js'
import { calcDistanceSegment, formatDistance } from '../utils/measureUtils.js'
import { throttle } from '../utils/debounce.js'

const Cesium = window.Cesium

export const measureState = reactive({
    enabled: false,
    finished: false,
    segmentCount: 0,    // 段数
    totalHorizontal: 0, // 累计水平距离(二维)
    totalSpatial: 0,    // 累计空间直线距离(三维)
    totalVertical: 0,   // 累计高差
    totalSlopeAngle: 0, // 总坡度角
})

let positions = []           // 已确认的世界坐标点
let pointEntities = []       // 点实体
let segmentEntities = []     // 线段实体
let segmentLabels = []       // 每段距离标签
let previewLine = null       // 预览虚线
let previewLabel = null      // 预览距离标签
let restoreCallback = null   // 退出测距时恢复原交互的回调（MainView 注入）
let previewCurrent = null    // 当前预览点（Cartesian3 或 null）

export function useMeasureDistance() {
    function setRestoreCallback(fn) {
        // 注入恢复回调（退出测距时把原来的左键选树/双击飞行等装回去）
        restoreCallback = fn
    }

    function resetState() {
        positions = []
        pointEntities = []
        segmentEntities = []
        segmentLabels = []
        previewLine = null
        previewLabel = null
        previewCurrent = null
        measureState.enabled = false
        measureState.finished = false
        measureState.segmentCount = 0
        measureState.totalHorizontal = 0
        measureState.totalSpatial = 0
        measureState.totalVertical = 0
        measureState.totalSlopeAngle = 0
    }

    function removeVisuals(viewer) {
        if (!viewer) return
        const all = [...pointEntities, ...segmentEntities, ...segmentLabels]
        if (previewLine) all.push(previewLine)
        if (previewLabel) all.push(previewLabel)
        all.forEach((e) => {
            try {
                viewer.entities.remove(e)
            } catch (error) { }
        })
    }

    // 退出测距并恢复原交互
    function restoreInteraction(viewer) {
        if (viewer) viewer.canvas.style.cursor = 'default'
        if (restoreCallback) restoreCallback()
    }

    function removePreview(viewer) {
        if (previewLine) {
            viewer.entities.remove(previewLine)
            previewLine = null
        }
        if (previewLabel) {
            viewer.entities.remove(previewLabel)
            previewLabel = null
        }
    }

    // 结束当前测量
    function finish(viewer) {
        removePreview(viewer)
        measureState.enabled = false
        measureState.finished = positions.length >= 2
        restoreInteraction(viewer)
    }

    function clear(viewer) {
        if (measureState.enabled) restoreInteraction(viewer)
        removeVisuals(viewer)
        resetState()
    }

    function addPoint(viewer, cartesian) {
        positions.push(cartesian)
        previewCurrent = null
        const point = viewer.entities.add({
            position: cartesian,
            point: {
                pixelSize: 7,
                color: Cesium.Color.CYAN,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
        pointEntities.push(point)
        if (positions.length >= 2) {
            const a = positions[positions.length - 2]
            const b = positions[positions.length - 1]
            const seg = calcDistanceSegment(a, b)
            measureState.segmentCount += 1
            measureState.totalHorizontal += seg.horizontal
            measureState.totalSpatial += seg.spatial
            measureState.totalVertical += seg.vertical
            measureState.totalSlopeAngle = Cesium.Math.toDegrees(
                Math.atan2(measureState.totalVertical, measureState.totalHorizontal)
            )
            const line = viewer.entities.add({
                polyline: {
                    positions: [a, b],
                    width: 3,
                    material: Cesium.Color.CYAN,
                    clampToGround: true,
                }
            })
            segmentEntities.push(line)
            const mid = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3())
            const label = viewer.entities.add({
                position: mid,
                label: {
                    text: formatDistance(seg.horizontal),
                    font: '12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -12),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
            segmentLabels.push(label)
        }
    }

    function onLeftClick(click, viewer) {
        const pos = getClickPosition(click.position, viewer)
        if (!Cesium.defined(pos)) return
        addPoint(viewer, pos)
    }

    function onMouseMove(movement, viewer) {
        if (positions.length === 0) return
        const pos = getClickPosition(movement.endPosition, viewer)
        previewCurrent = Cesium.defined(pos) ? pos : null
        ensurePreview(viewer)
    }

    // 用 CallbackProperty 创建预览，只创建一次，每帧自动更新
    function ensurePreview(viewer) {
        if (previewLine) return
        previewLine = viewer.entities.add({
            polyline: {
                // CallbackProperty(回调, false)：false 表示每帧都重新取值
                positions: new Cesium.CallbackProperty(() => {
                    const last = positions[positions.length - 1]
                    if (!last || !previewCurrent) return []
                    return [last, previewCurrent]
                }, false),
                width: 2,
                material: Cesium.Color.CYAN.withAlpha(0.7),
                clampToGround: true,
            },
        })
        previewLabel = viewer.entities.add({
            position: new Cesium.CallbackProperty(() => {
                const last = positions[positions.length - 1]
                if (!last || !previewCurrent) return Cesium.Cartesian3.fromDegrees(0, 0)
                return Cesium.Cartesian3.midpoint(last, previewCurrent, new Cesium.Cartesian3())
            }, false),
            label: {
                text: new Cesium.CallbackProperty(() => {
                    const last = positions[positions.length - 1]
                    if (!last || !previewCurrent) return ''
                    return formatDistance(calcDistanceSegment(last, previewCurrent).horizontal)
                }, false),
                // show 也用 CallbackProperty：没预览点时隐藏标签
                show: new Cesium.CallbackProperty(() => positions.length > 0 && !!previewCurrent, false),
                font: '12px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -12),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
    }

    function toggle(viewer) {
        if (!viewer) return
        if (measureState.enabled) {
            finish(viewer)
            return
        }
        removeVisuals(viewer)
        resetState()

        const handler = viewer.screenSpaceEventHandler
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_UP)

        handler.setInputAction(
            (click) => onLeftClick(click, viewer),
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        )
        handler.setInputAction(
            (movement) => onMouseMove(movement, viewer),
            Cesium.ScreenSpaceEventType.MOUSE_MOVE
        )
        handler.setInputAction(
            () => finish(viewer),
            Cesium.ScreenSpaceEventType.RIGHT_UP
        )

        measureState.enabled = true
        measureState.finished = false
        viewer.canvas.style.cursor = 'crosshair'
    }

    return {
        setRestoreCallback,
        toggle,
        clear,
    }
}






