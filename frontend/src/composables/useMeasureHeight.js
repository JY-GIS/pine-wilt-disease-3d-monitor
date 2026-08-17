/**
 * 两点高差测量 Hook
 *
 * 职责：
 *  1. 进入/退出测高模式（临时接管 LEFT_CLICK / MOUSE_MOVE / RIGHT_UP）
 *  2. 点 A → 点 B 两个点，第二点落下后自动结束
 *  3. 鼠标移动时实时预览高差（虚线 + 标签）
 *  4. 右键 = 取消本次测量
 */
import { reactive } from 'vue'
import { getClickPosition } from '../utils/cesiumUtils.js'
import { formatHeightCompare } from '../utils/measureUtils.js'

const Cesium = window.Cesium

const YELLOW = Cesium.Color.fromCssColorString('#ffe600')

export const heightState = reactive({
    enabled: false,   // 是否正在测高
    finished: false,  // 是否已得到 A、B 两点结果
    heightA: 0,       // 起点(A)高程，单位米
    heightB: 0,       // 终点(B)高程，单位米
})

let points = []           // 已确认点，最多 2 个：{ cartesian, height }
let pointEntities = []    // A/B 点实体
let labelEntities = []    // A/B 标签实体
let lineEntity = null     // 最终连线（A → B）
let previewLine = null    // 预览虚线
let previewLabel = null   // 预览高差标签
let previewCurrent = null // 当前预览点（Cartesian3 或 null）
let restoreCallback = null

export function useMeasureHeight() {
    function setRestoreCallback(fn) {
        // 注入恢复回调：退出测高时把原来的左键选树/双击飞行等装回去
        restoreCallback = fn
    }
    function resetState() {
        points = []
        pointEntities = []
        labelEntities = []
        lineEntity = null
        previewLine = null
        previewLabel = null
        previewCurrent = null
        heightState.enabled = false
        heightState.finished = false
        heightState.heightA = 0
        heightState.heightB = 0
    }

    function removeVisuals(viewer) {
        if (!viewer) return
        const all = [...pointEntities, ...labelEntities]
        if (lineEntity) all.push(lineEntity)
        if (previewLine) all.push(previewLine)
        if (previewLabel) all.push(previewLabel)
        all.forEach((e) => {
            try {
                viewer.entities.remove(e)
            } catch (error) { }
        })
    }

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

    function finish(viewer) {
        removePreview(viewer)
        if (points.length === 2) {
            // 最终连线：贴地显示，仅作视觉连接，不参与高差计算
            lineEntity = viewer.entities.add({
                polyline: {
                    positions: [points[0].cartesian, points[1].cartesian],
                    width: 3,
                    material: YELLOW,
                    clampToGround: true,
                },
            })
            heightState.heightA = points[0].height
            heightState.heightB = points[1].height
            heightState.finished = true
        }
        heightState.enabled = false
        restoreInteraction(viewer)
    }

    function cancel(viewer) {
        removeVisuals(viewer)
        resetState()
        restoreInteraction(viewer)
    }

    function clear(viewer) {
        if (heightState.enabled) restoreInteraction(viewer)
        removeVisuals(viewer)
        resetState()
    }

    function addPoint(viewer, cartesian) {
        if (points.length >= 2) return
        previewCurrent = null
        // Cartographic.fromCartesian：世界坐标 → 经纬度+高程，这里只取 height（椭球高）
        const carto = Cesium.Cartographic.fromCartesian(cartesian)
        const idx = points.length
        points.push({
            cartesian,
            height: carto.height,
        })
        const pt = viewer.entities.add({
            position: cartesian,
            point: {
                pixelSize: 8,
                color: YELLOW,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
        pointEntities.push(pt)

        const label = viewer.entities.add({
            position: cartesian,
            label: {
                text: idx === 0 ? 'A' : 'B',
                font: 'bold 14px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
        })
        labelEntities.push(label)

        if (points.length === 2) {
            finish(viewer)
        }
    }

    function onLeftClick(click, viewer) {
        const pos = getClickPosition(click.position, viewer)
        if (!Cesium.defined(pos)) return
        addPoint(viewer, pos)
    }

    function onMouseMove(movement, viewer) {
        if (points.length !== 1) return
        const pos = getClickPosition(movement.endPosition, viewer)
        previewCurrent = Cesium.defined(pos) ? pos : null
        ensurePreview(viewer)
    }

    function ensurePreview(viewer) {
        if (previewLine) return
        previewLine = viewer.entities.add({
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    const start = points[0]
                    if (!start || !previewCurrent) return []
                    return [start.cartesian, previewCurrent]
                }, false),
                width: 3,
                material: YELLOW.withAlpha(0.7),
                clampToGround: true,
            },
        })
        previewLabel = viewer.entities.add({
            position: new Cesium.CallbackProperty(() => {
                const start = points[0]
                if (!start || !previewCurrent) return Cesium.Cartesian3.fromDegrees(0, 0)
                return Cesium.Cartesian3.midpoint(start.cartesian, previewCurrent, new Cesium.Cartesian3())
            }, false),
            label: {
                text: new Cesium.CallbackProperty(() => {
                    const start = points[0]
                    if (!start || !previewCurrent) return ''
                    const cursorCarto = Cesium.Cartographic.fromCartesian(previewCurrent)
                    return formatHeightCompare(start.height, cursorCarto.height)
                }, false),
                // show 也用 CallbackProperty：没预览点时隐藏标签
                show: new Cesium.CallbackProperty(() => points.length === 1 && !!previewCurrent, false),
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
        if (heightState.enabled) {
            cancel(viewer)
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
            () => cancel(viewer),
            Cesium.ScreenSpaceEventType.RIGHT_UP
        )

        heightState.enabled = true
        heightState.finished = false
        viewer.canvas.style.cursor = 'crosshair'
    }

    return {
        setRestoreCallback,
        toggle,
        clear,
    }
}
