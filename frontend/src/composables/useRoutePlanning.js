/**
 * 巡查路径规划 Hook
 *
 * 职责：
 * 1. 进入/退出"点击选择"模式（病树选点）
 * 2. 单击病树 → 加入/移出已选列表，高亮反馈
 * 3. 上限 50 个点位，超出提示
 * 4. 调后端贪心算法接口，获取巡查顺序
 * 5. 绘制/清除三维路径（连线 + 起终点标注）
 *
 */
import { useRoutePlanStore } from '../stores/routePlanStore.js'
import { treeState } from './useDiseasedTrees.js'
import { API } from '../config/api.config.js'
const Cesium = window.Cesium
// ========== 模块级常量 ==========
/** 单次最多选点数 */
const MAX_POINTS = 50
// ========== 模块级状态（不对外暴露） ==========
/** 退出选点后恢复交互的回调（由 App.vue 注入） */
let restoreInteractions = null
/** 已选病树的高亮引用（用于还原） */
// Entity 模式
let highlightedEntities = []
// Primitive 模式
let highlightedPrimitives = []
/** 路线相关图元（用于清除） */
let routePolylineEntity = null       // 连线
let routePointEntities = []          // 起终点标注（Point + Label）
/** 悬浮提示 DOM */
let tipDom = null
// ========== Hook 入口 ==========
export function useRoutePlanning() {
    const store = useRoutePlanStore()
    // ============================
    //  内部工具函数
    // ============================
    /**
     * 从 pick 结果中提取统一的病树信息
     * 兼容 Entity 模式和 Primitive 模式
     *
     * @param {Object} picked - viewer.scene.pick() 的返回值
     * @returns {Object|null} { treeId, species, grade, lng, lat }
     */
    function extractTreeInfo(picked) {
        // ---------- Entity 模式 ----------
        if (
            Cesium.defined(picked) &&
            picked.id &&
            picked.id.properties &&
            picked.id.properties.treeId
        ) {
            const p = picked.id.properties
            return {
                treeId: p.treeId.getValue(),
                species: p.species.getValue(),
                grade: p.grade.getValue(),
                lng: p.longitude.getValue(),
                lat: p.latitude.getValue(),
            }
        }
        // ---------- Primitive 模式 ---------
        if (
            Cesium.defined(picked) &&
            picked.id &&
            treeState.treeDataMap.has(picked.id)
        ) {
            const data = treeState.treeDataMap.get(picked.id)
            return {
                treeId: data.treeId,
                species: data.species,
                grade: data.grade,
                lng: data.longitude,
                lat: data.latitude,
            }
        }
        return null
    }
    /**
     * 高亮一个已选病树（选中态样式）
     * 兼容 Entity / Primitive 两套
     *
     * @param {Object} picked - pick 结果
     */
    function highlightPicked(picked) {
        // ----- Entity -----
        if (picked.id && picked.id.point) {
            const entity = picked.id
            if (entity._origPixelSize === undefined) {
                entity._origPixelSize = entity.point.pixelSize.getValue()
            }
            if (entity._origOutlineWidth === undefined) {
                entity._origOutlineWidth = entity.point.outlineWidth.getValue()
            }
            // 选中状态
            entity.point.pixelSize = 7
            entity.point.outlineColor = Cesium.Color.GOLD
            entity.point.outlineWidth = 3
            highlightedEntities.push(entity)
            return
        }
        // ---- Primitive ----
        if (picked.primitive && picked.primitive._origPixelSize !== undefined) {
            const pt = picked.primitive
            if (pt._origPixelSize === undefined) {
                pt._origPixelSize = pt.pixelSize
            }
            if (pt._origOutlineWidth === undefined) {
                pt._origOutlineWidth = pt.outlineWidth
            }
            pt.pixelSize = 7
            pt.outlineColor = Cesium.Color.GOLD
            pt.outlineWidth = 3
            highlightedPrimitives.push(pt)
        }
    }
    /**
     * 还原所有已选点高亮
     */
    function restoreAllHighlights() {
        // Entity
        highlightedEntities.forEach((entity) => {
            if (entity.point && entity._origPixelSize !== undefined) {
                entity.point.pixelSize = entity._origPixelSize
                entity.point.outlineColor = Cesium.Color.WHITE
                entity.point.outlineWidth = entity._origOutlineWidth
            }
        })
        highlightedEntities = []
        // Primitive
        highlightedPrimitives.forEach((pt) => {
            if (pt._origPixelSize !== undefined) {
                pt.pixelSize = pt._origPixelSize
                pt.outlineColor = Cesium.Color.WHITE
                pt.outlineWidth = pt._origOutlineWidth
            }
        })
        highlightedPrimitives = []
    }
    /**
     * 还原单个点的高亮（取消选中时用）
     *
     * @param {String} treeId
     */
    function restoreSingleHighlight(treeId) {
        // Entity
        const entityIdx = highlightedEntities.findIndex(
            (e) => e.properties.treeId.getValue() === treeId
        )
        if (entityIdx !== -1) {
            const entity = highlightedEntities[entityIdx]
            entity.point.pixelSize = entity._origPixelSize
            entity.point.outlineColor = Cesium.Color.WHITE
            entity.point.outlineWidth = entity._origOutlineWidth
            highlightedEntities.splice(entityIdx, 1)
            return
        }
        // Primitive（通过 treeDataMap 反查）
        // Primitive 的 id 是 "tree_xxx"，需要先定位
        // 这里简化处理：遍历 highlightedPrimitives
        const ptIdx = highlightedPrimitives.findIndex(
            (pt) => {
                const data = treeState.treeDataMap.get(pt.id)
                return data && data.treeId === treeId
            }
        )
        if (ptIdx !== -1) {
            const pt = highlightedPrimitives[ptIdx]
            pt.pixelSize = pt._origPixelSize
            pt.outlineColor = Cesium.Color.WHITE
            pt.outlineWidth = pt._origOutlineWidth
            highlightedPrimitives.splice(ptIdx, 1)
        }
    }
    // ============================
    //  悬浮提示
    // ============================
    /** 在 Cesium 容器上显示 1 秒自动消失的提示 */
    function showTip(text, viewer) {
        // 先移除旧提示
        hideTip()
        tipDom = document.createElement('div')
        tipDom.textContent = text
        tipDom.style.cssText = `
            position: absolute;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 200;
            background: rgba(0, 0, 0, 0.75);
            color: #fff;
            padding: 8px 20px;
            border-radius: 4px;
            font-size: 14px;
            pointer-events: none;
            white-space: nowrap;
            border: 1px solid rgba(0, 212, 255, 0.3);
        `
        viewer.container.appendChild(tipDom)
        setTimeout(() => hideTip(), 1000)
    }
    /** 移除悬浮提示 */
    function hideTip() {
        if (tipDom && tipDom.parentNode) {
            tipDom.parentNode.removeChild(tipDom)
        }
        tipDom = null
    }
    // ============================
    //  模式切换
    // ============================
    /**
     * 进入"点击选择"模式
     *
     * 操作：
     * 1. 移除原有交互事件（左键单击、双击、右键）
     * 2. 注册选点专用单击事件
     * 3. 改变鼠标样式为十字准星
     */
    function enterRoutePlanningMode(viewer) {
        if (!viewer) {
            console.warn('viewer未初始化')
            return
        }
        const handler = viewer.screenSpaceEventHandler
        // --- 移除现有交互 ---
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_UP)
        handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
        // --- 注册选点单击事件 ---
        handler.setInputAction(
            (click) => onSelectClick(click, viewer),
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        )
        // --- 鼠标样式 ---
        viewer.canvas.style.cursor = 'crosshair'
        // --- 更新 store ---
        store.isRoutePlanningMode = true
        // --- 悬浮提示 ---
        showTip('请点击地图上的病树点位', viewer)
        console.log('进入路径选点模式')
    }
    /**
     * 退出"点击选择"模式
     *
     * 操作：
     * 1. 移除选点单击事件
     * 2. 恢复原有交互事件（调用 App.vue 注入的回调）
     * 3. 还原鼠标样式
     * 4. 清除所有高亮和路线
     */
    function exitRoutePlanningMode(viewer) {
        if (!viewer) return
        const handler = viewer.screenSpaceEventHandler
        // --- 移除选点事件 ---
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
        // --- 恢复原有交互 ---
        if (restoreInteractions) {
            restoreInteractions()
        }
        // --- 鼠标样式 ---
        viewer.canvas.style.cursor = 'default'
        // --- 清除所有 ---
        restoreAllHighlights()
        clearRouteFromMap(viewer)
        store.clearPoints()
        store.clearPlanResult()
        // --- 更新 store ---
        store.isRoutePlanningMode = false
        // --- 移除提示 ---
        hideTip()
        console.log('退出路径选点模式')
    }
    /**
     * 按钮切换选点模式
     */
    function toggleRoutePlanningMode(viewer) {
        if (store.isRoutePlanningMode) {
            exitRoutePlanningMode(viewer)
        } else {
            enterRoutePlanningMode(viewer)
        }
    }
    // ============================
    //  选点单击事件处理
    // ============================
    /**
     * 选点模式下的左键单击：
     * - 点到病树 → 切换选中/取消
     * - 点到空白 → 忽略
     */
    function onSelectClick(click, viewer) {
        const picked = viewer.scene.pick(click.position)
        const treeInfo = extractTreeInfo(picked)
        if (!treeInfo) return
        const treeId = treeInfo.treeId
        const alreadySelected = store.selectedPoints.find(
            (p) => p.id === treeId
        )
        if (alreadySelected) {
            store.removePoint(treeId)
            restoreSingleHighlight(treeId)
        } else {
            const success = store.addPoint(treeInfo)
            if (!success) {
                showTip(`单次最多选择 ${MAX_POINTS} 个点位`, viewer)
                return
            }
            highlightPicked(picked)
        }
    }
    // ============================
    //  调后端获取调查方案
    // ============================
    /**
     * 将已选 ID 列表发给后端，获取贪心排序结果
     *
     * @returns {Object|null} 规划结果 data，失败返回 null
     */
    async function fetchRoutePlan() {
        const ids = store.selectedPoints.map((p) => p.treeId)
        if (ids.length < 2) {
            alert('请至少选择两个病树')
            return null
        }
        store.isLoading = true
        try {
            const response = await fetch(API.planRoute, {
                method: 'POST',
                headers: API.getHeaders(),
                body: JSON.stringify({
                    pointIds: ids
                })
            })
            const result = await response.json()
            if (result.code === 1 && result.data) {
                store.setPlanResult(result.data)
                return result.data
            } else {
                alert(result.msg || '路径规划失败,请重试')
                return null
            }
        } catch (e) {
            console.error('路径规划请求失败', e)
            alert('请求失败,请检查网络')
            return null
        } finally {
            store.isLoading = false
        }
    }
    // ============================
    //  绘制路线
    // ============================
    /**
     * 根据规划结果在 Cesium 中绘制连线 + 起终点标注
     *
     * @param {Object} planData - planResult（RoutePlanResponse.data）
     * @param {Cesium.Viewer} viewer
     */
    function drawRouteOnMap(planData, viewer) {
        if (!viewer || !planData || !planData.route) return
        // 先清除旧线路
        clearRouteFromMap(viewer)
        const route = planData.route
        // ---------- 构建坐标数组 ----------
        const positions = route.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.lng, p.lat)
        )
        // ---------- 连线 ----------
        routePolylineEntity = viewer.entities.add({
            polyline: {
                positions: positions,
                width: 4,
                material: Cesium.Color.fromCssColorString('#e77f43'),
                clampToGround: true,
            },
        })
        // ---------- 起点标注 ----------
        const start = route[0]
        const startPos = Cesium.Cartesian3.fromDegrees(start.lng, start.lat)
        routePointEntities.push(
            viewer.entities.add({
                position: startPos,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.fromCssColorString('#84eaff'),
                    outlineColor: Cesium.Color.fromCssColorString('#000000'),
                    outlineWidth: 1,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            }),
            viewer.entities.add({
                position: startPos,
                label: {
                    text: '起点',
                    font: 'bold 13px sans-serif',
                    fillColor: Cesium.Color.LIME,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -12),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
        )
        // ---------- 终点标注（如果路线 ≥ 2 个点，且终点不是起点） ----------
        if (route.length >= 2) {
            const end = route[route.length - 1]
            const endPos = Cesium.Cartesian3.fromDegrees(end.lng, end.lat)
            routePointEntities.push(
                viewer.entities.add({
                    position: endPos,
                    point: {
                        pixelSize: 10,
                        color: Cesium.Color.RED,
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 1,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                }),
                viewer.entities.add({
                    position: endPos,
                    label: {
                        text: `终点(${end.seq})`,
                        font: 'bold 13px sans-serif',
                        fillColor: Cesium.Color.RED,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.TOP,
                        pixelOffset: new Cesium.Cartesian2(0, 12),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                })
            )
        }
        // ---------- 相机飞至路径全览 ----------
        viewer.flyTo(routePolylineEntity, {
            duration: 1.25,
            offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(0),
                Cesium.Math.toRadians(-90),
            ),
        })
    }
    /**
     * 清除地图上的路线（连线 + 起终点标注）
     */
    function clearRouteFromMap(viewer) {
        if (!viewer) return
        if (routePolylineEntity) {
            viewer.entities.remove(routePolylineEntity)
            routePolylineEntity = null
        }
        routePointEntities.forEach((e) => viewer.entities.remove(e))
        routePointEntities = []
    }
    // ============================
    //  一键获取方案 + 绘制
    // ============================
    /**
     * "获取调查方案" 按钮的完整流程：
     * 调接口 → 拿到结果 → 画路线
     */
    async function fetchAndDraw(viewer) {
        const data = await fetchRoutePlan()
        if (data) {
            drawRouteOnMap(data, viewer)
        }
    }
    // ============================
    //  恢复回调注册
    // ============================
    /**
     * 注册退出选点模式后恢复交互的回调函数
     * 由 App.vue 在初始化时调用
     *
     * @param {Function} fn - 恢复函数
     */
    function setRestoreCallback(fn) {
        restoreInteractions = fn
    }


    // ============================
    //  公开 API
    // ============================
    return {
        // 模式切换
        enterRoutePlanningMode,
        exitRoutePlanningMode,
        toggleRoutePlanningMode,
        // 规划与绘制
        fetchRoutePlan,
        fetchAndDraw,
        drawRouteOnMap,
        clearRouteFromMap,
        // 恢复回调
        setRestoreCallback,
    }

}
