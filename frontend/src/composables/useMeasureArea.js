/**
 * 面积测量 Hook
 *
 * 职责：
 *  1. 进入/退出测面积模式（临时接管 LEFT_CLICK / MOUSE_MOVE / RIGHT_UP）
 *  2. 左键单击添加多边形顶点，右键抬起闭合多边形并结束
 *  3. 鼠标移动时实时预览：预览边界 + 半透明填充面 + 实时面积标签
 *  4. 计算的是「投影面积」（用 turf.area 的球面面积，忽略地形起伏）
 */
import { reactive } from 'vue'
import { getClickPosition } from '../utils/cesiumUtils.js'
import { calcArea, formatArea } from '../utils/measureUtils.js'
import { area } from '@turf/turf'

const Cesium = window.Cesium

const AMBER = Cesium.Color.fromCssColorString('#ff9800')
const AMBER_FILL = Cesium.Color.fromCssColorString('#ff9800').withAlpha(0.35)

export const areaState = reactive({
    enabled: false,
    finished: false,
    areaM2: 0,
})

let positions = []           // 已确认的顶点（Cartesian3 世界坐标）
let vertexEntities = []      // 顶点标记实体
let boundaryEntity = null    // 已确认边界线实体（绘制时是开放折线，闭合后是闭合环）
let fillEntity = null        // 最终填充面实体
let areaLabelEntity = null   // 最终面积标签实体
let previewBoundary = null   // 预览边界线实体
let previewFill = null       // 预览填充面实体
let previewLabel = null      // 预览面积标签实体
let previewCurrent = null    // 当前预览点（Cartesian3 或 null）
let previewAreaM2 = 0        // 预览面积（平方米），鼠标移动时算一次
let previewCentroid = null   // 预览质心 [经度, 纬度]，鼠标移动时算一次
let restoreCallback = null   // 退出测面积时恢复原交互的回调（MainView 注入）

export function useMeasureArea() {
    function setRestoreCallback(fn) {
        restoreCallback = fn
    }

    function resetState() {
        positions = []
        vertexEntities = []
        boundaryEntity = null
        fillEntity = null
        areaLabelEntity = null
        previewBoundary = null
        previewFill = null
        previewLabel = null
        previewCurrent = null
        previewAreaM2 = 0
        previewCentroid = null
        areaState.enabled = false
        areaState.finished = false
        areaState.areaM2 = 0
    }

    function removeVisuals(viewer) {
        if (!viewer) return
        const all = [
            ...vertexEntities,
            boundaryEntity,
            fillEntity,
            areaLabelEntity,
            previewBoundary,
            previewFill,
            previewLabel,
        ].filter(Boolean)
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
        if (previewBoundary) {
            viewer.entities.remove(previewBoundary)
            previewBoundary = null
        }
        if (previewFill) {
            viewer.entities.remove(previewFill)
            previewFill = null
        }
        if (previewLabel) {
            viewer.entities.remove(previewLabel)
            previewLabel = null
        }
    }

    function finish(viewer) {
        removePreview(viewer)
        areaState.enabled = false

        if (positions.length >= 3) {
            const res = calcArea(positions)
            areaState.areaM2 = res.areaM2
            if (boundaryEntity) {
                viewer.entities.remove(boundaryEntity)
                boundaryEntity = null
            }
            boundaryEntity = viewer.entities.add({
                polyline: {
                    positions: [...positions, positions[0]],
                    width: 3,
                    material: AMBER,
                    clampToGround: true,
                },
            })
            fillEntity = viewer.entities.add({
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy([...positions]),
                    material: AMBER_FILL,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
            })
            if (res.centroid) {
                areaLabelEntity = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(res.centroid[0], res.centroid[1]),
                    label: {
                        text: formatArea(res.areaM2),
                        font: '13px sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                })
            }
            areaState.finished = true
        } else {
            areaState.finished = false
        }
        restoreInteraction(viewer)
    }

    function clear(viewer) {
        if (areaState.enabled) restoreInteraction(viewer)
        removeVisuals(viewer)
        resetState()
    }

    // 添加一个已确认的顶点
    function addVertex(viewer, cartesian) {
        positions.push(cartesian)
        previewCurrent = null
        const pt = viewer.entities.add({
            position: cartesian,
            point: {
                pixelSize: 7,
                color: AMBER,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
        vertexEntities.push(pt)
        updateBoundary(viewer)
    }

    function updateBoundary(viewer) {
        if (boundaryEntity) {
            viewer.entities.remove(boundaryEntity)
            boundaryEntity = null
        }
        if (positions.length < 2) return
        boundaryEntity = viewer.entities.add({
            polyline: {
                positions: [...positions],
                width: 3,
                material: AMBER,
                clampToGround: true,
            },
        })
    }

    function onLeftClick(click, viewer) {
        const pos = getClickPosition(click.position, viewer)
        if (!Cesium.defined(pos)) return
        addVertex(viewer, pos)
    }

    function onMouseMove(movement, viewer) {
        if (positions.length === 0) return
        const pos = getClickPosition(movement.endPosition, viewer)
        previewCurrent = Cesium.defined(pos) ? pos : null

        // 为什么在 onMouseMove 里算面积，而不是放进 CallbackProperty 每帧算：
        // turf.area / turf.centroid 相对较贵，每帧算会浪费；
        // 鼠标移动一次算一次已经足够，CallbackProperty 只负责读取已算好的值。
        if (positions.length >= 2 && previewCurrent) {
            // 预览环 = 已确认顶点 + 当前光标点 + 回到首点（临时闭合）
            const res = calcArea([...positions, previewCurrent, positions[0]])
            previewAreaM2 = res.areaM2
            previewCentroid = res.centroid
            areaState.areaM2 = res.areaM2  // 同步到结果面板，实现「实时显示当前面积」
        } else {
            previewAreaM2 = 0
            previewCentroid = null
            areaState.areaM2 = 0
        }
        ensurePreview(viewer)
    }

    function ensurePreview(viewer) {
        if (previewBoundary) return
        previewBoundary = viewer.entities.add({
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    if (positions.length === 0 || !previewCurrent) return []
                    if (positions.length === 1) return [positions[0], previewCurrent]
                    return [...positions, previewCurrent, positions[0]]
                }, false),
                width: 2,
                material: AMBER.withAlpha(0.7),
                clampToGround: true,
            },
        })
        previewFill = viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.CallbackProperty(() => {
                    if (positions.length < 2 || !previewCurrent) return new Cesium.PolygonHierarchy([])
                    return new Cesium.PolygonHierarchy([...positions, previewCurrent, positions[0]])
                }, false),
                material: AMBER_FILL,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                // 条件不满足时用 show=false 隐藏，避免空多边形渲染报错
                show: new Cesium.CallbackProperty(() => positions.length >= 2 && !!previewCurrent, false),
            },
        })
        previewLabel = viewer.entities.add({
            position: new Cesium.CallbackProperty(() => {
                if (!previewCentroid) return Cesium.Cartesian3.fromDegrees(0, 0)
                return Cesium.Cartesian3.fromDegrees(previewCentroid[0], previewCentroid[1])
            }, false),
            label: {
                text: new Cesium.CallbackProperty(() => formatArea(previewAreaM2), false),
                show: new Cesium.CallbackProperty(() => positions.length >= 2 && !!previewCurrent, false),
                font: '12px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
    }

    function toggle(viewer) {
        if (!viewer) return
        if (areaState.enabled) {
            finish(viewer)
            return
        }

        removeVisuals(viewer)
        resetState()

        const handler = viewer.screenSpaceEventHandler
        // Cesium 的 ScreenSpaceEventHandler 同一事件类型只能有一个处理器，
        // 进入前必须移除原有交互（选树、双击飞行、悬停高亮、右键单树缓冲）
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

        areaState.enabled = true
        areaState.finished = false
        viewer.canvas.style.cursor = 'crosshair'
    }

    return {
        setRestoreCallback,
        toggle,
        clear,
    }

}



