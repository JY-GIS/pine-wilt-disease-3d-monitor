/**
 * 多边形圈选 Hook
 *
 * 职责：
 * 1. 进入/退出多边形绘制模式
 * 2. 单击加点、双击完成绘制
 * 3. 调后端 ST_Within 查询圈选范围内的病树
 * 4. 在地图上渲染结果多边形
 * 5. 管理绘制过程中的临时图元
 */
import { useTreeStore } from '../stores/treeStore.js'
import { getClickPosition, cartesianToLngLat } from '../utils/cesiumUtils.js'
import { getViewer } from './useCesiumViewer.js'
import { API } from '../config/api.config.js'

const Cesium = window.Cesium

// ==================== 模块级状态（绘制临时数据） ====================
let drawingPositions = []
let drawingPointEntities = []
let drawingPolylineEntity = null
let drawnPolygonEntity = null
let drawnPolylineEntity = null
let drawClickTimer = null

// 退出绘制后恢复交互的回调（由 App.vue 注入）
let restoreInteractions = null

// ==================== Hook 入口 ====================

export function clearPolygonFromMap(viewer) {
    if (drawnPolygonEntity) {
        viewer.entities.remove(drawnPolygonEntity)
        drawnPolygonEntity = null
    }
    if (drawnPolylineEntity) {
        viewer.entities.remove(drawnPolylineEntity)
        drawnPolylineEntity = null
    }
}

export function usePolygonDraw() {
    const store = useTreeStore()

    // ========== 获取 viewer ==========
    function _viewer() {
        return getViewer()
    }

    // ========== 设置恢复交互的回调 ==========
    function setRestoreCallback(fn) {
        restoreInteractions = fn
    }

    // ========== 更新绘制预览线 ==========
    function updateDrawingPolyline(viewer) {
        if (drawingPolylineEntity) {
            viewer.entities.remove(drawingPolylineEntity)
            drawingPolylineEntity = null
        }
        if (drawingPositions.length >= 2) {
            drawingPolylineEntity = viewer.entities.add({
                polyline: {
                    positions: [...drawingPositions],
                    width: 2,
                    material: Cesium.Color.CYAN,
                    clampToGround: true,
                },
            })
        }
    }

    // ========== 单击加点 ==========
    function onDrawnClick(click, viewer) {
        const cartesian = getClickPosition(click.position, viewer)
        if (!Cesium.defined(cartesian)) {
            console.log('无法获取点击位置，请重试')
            return
        }

        // 用定时器区分单击和双击（双击前必触发单击，300ms 内双击则取消加点）
        drawClickTimer = setTimeout(() => {
            drawingPositions.push(cartesian)

            const pointEntity = viewer.entities.add({
                position: cartesian,
                point: {
                    pixelSize: 3,
                    color: Cesium.Color.CYAN,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 1,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
            drawingPointEntities.push(pointEntity)
            updateDrawingPolyline(viewer)
            console.log(`已添加第 ${drawingPositions.length} 个顶点`)
            drawClickTimer = null
        }, 300)
    }

    // ========== 双击完成绘制 ==========
    function onDrawnFinish(click, viewer) {
        // 取消最后一次单击（双击前必触发单击）
        if (drawClickTimer) {
            clearTimeout(drawClickTimer)
            drawClickTimer = null
        }

        // 回退最后一次单击添加的点
        if (drawingPositions.length > 0) {
            drawingPositions.pop()
            const lastPoint = drawingPointEntities.pop()
            if (lastPoint) viewer.entities.remove(lastPoint)
            updateDrawingPolyline(viewer)
        }

        if (drawingPositions.length < 3) {
            alert('至少需要3个顶点才能构成多边形')
            return
        }

        // 首尾闭合（距离 ≥ 5 米时自动补一个首点）
        const first = drawingPositions[0]
        const last = drawingPositions[drawingPositions.length - 1]
        const dist = Cesium.Cartesian3.distance(first, last)
        if (dist >= 5) {
            drawingPositions.push(first.clone())
        }

        // 顶点 → 经纬度 → GeoJSON
        const coords = drawingPositions.map((p) => cartesianToLngLat(p))
        const polygonGeoJson = {
            type: 'Polygon',
            coordinates: [coords],
        }

        finishDrawingAndQuery(polygonGeoJson, viewer)
        exitDrawMode(viewer)
    }

    // ========== 调后端查询 + 渲染结果 ==========
    async function finishDrawingAndQuery(polygonGeoJson, viewer) {
        try {
            const response = await fetch(API.within, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: localStorage.getItem('token') || '',
                },
                body: JSON.stringify({ polygon: polygonGeoJson }),
            })
            const result = await response.json()
            if (result.code !== 1 || !result.data) {
                alert('查询失败,请重试')
                return
            }

            store.polygonResults = result.data || []

            // 统计各等级数量
            const stats = {}
            store.polygonResults.forEach((tree) => {
                const g = tree.grade
                stats[g] = (stats[g] || 0) + 1
            })
            store.polygonGradeStats = stats

            // 在地图上画多边形
            renderPolygonOnMap(polygonGeoJson, viewer)

            store.showPolygonPanel = true
            store.showNearbyPanel = false
        } catch (error) {
            console.error('多边形圈选查询失败', error)
            alert('查询失败,请检查网络')
        }
    }

    // ========== 地图上绘制结果多边形 ==========
    function renderPolygonOnMap(polygonGeoJson, viewer) {
        clearDrawnPolygon(viewer)

        const coords = polygonGeoJson.coordinates[0] // 外环
        const cartesianArr = Cesium.Cartesian3.fromDegreesArray(coords.flat())

        // 半透明面
        drawnPolygonEntity = viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(cartesianArr),
                material: Cesium.Color.CYAN.withAlpha(0.3),
                outline: false,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        })

        // 边框线（手动闭合）
        drawnPolylineEntity = viewer.entities.add({
            polyline: {
                positions: [...cartesianArr, cartesianArr[0]],
                width: 2.5,
                material: Cesium.Color.CYAN,
                clampToGround: true,
            },
        })
    }

    // ========== 清除临时绘制元素 ==========
    function clearDrawingTempElements(viewer) {
        if (drawingPolylineEntity) {
            viewer.entities.remove(drawingPolylineEntity)
            drawingPolylineEntity = null
        }
        drawingPointEntities.forEach((pt) => viewer.entities.remove(pt))
        drawingPointEntities = []
    }

    // ========== 清除完成的多边形 ==========
    function clearDrawnPolygon(viewer) {
        if (drawnPolygonEntity) {
            viewer.entities.remove(drawnPolygonEntity)
            drawnPolygonEntity = null
        }
        if (drawnPolylineEntity) {
            viewer.entities.remove(drawnPolylineEntity)
            drawnPolylineEntity = null
        }
    }

    // ========== 进入绘制模式 ==========
    function enterDrawMode(viewer) {
        const handler = viewer.screenSpaceEventHandler

        // 清空旧数据
        drawingPositions = []
        clearDrawingTempElements(viewer)

        // 移除现有的交互事件（单击、双击、鼠标移动）
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)

        // 绑定绘制事件
        handler.setInputAction(
            (click) => onDrawnClick(click, viewer),
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        )
        handler.setInputAction(
            (click) => onDrawnFinish(click, viewer),
            Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
        )

        // 改变鼠标样式
        viewer.canvas.style.cursor = 'crosshair'

        store.isDrawingMode = true
        console.log('进入多边形绘制模式,单击加点,双击完成')
    }

    // ========== 退出绘制模式 ==========
    function exitDrawMode(viewer) {
        const handler = viewer.screenSpaceEventHandler

        clearDrawingTempElements(viewer)

        if (drawClickTimer) {
            clearTimeout(drawClickTimer)
            drawClickTimer = null
        }
        drawingPositions = []

        // 移除绘制事件
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

        // 恢复原始交互事件
        if (restoreInteractions) {
            restoreInteractions()
        }

        // 恢复鼠标样式
        viewer.canvas.style.cursor = 'default'

        store.isDrawingMode = false
        console.log('退出多边形绘制模式')
    }

    // ========== 按钮切换绘制模式 ==========
    function toggleDrawingMode(viewer) {
        if (store.isDrawingMode) {
            exitDrawMode(viewer)
        } else {
            enterDrawMode(viewer)
        }
    }

    // ========== 关闭圈选面板（含清除地图上的多边形） ==========
    function closePolygonPanel(viewer) {
        store.showPolygonPanel = false
        store.polygonResults = []
        store.polygonGradeStats = {}
        clearDrawnPolygon(viewer)
    }

    return {
        setRestoreCallback,
        enterDrawMode,
        exitDrawMode,
        toggleDrawingMode,
        closePolygonPanel,
    }
}