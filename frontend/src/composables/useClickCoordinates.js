/**
 * 点击地图取坐标 Hook
 *
 * 职责：
 * 1. 开启/关闭"取坐标模式"（临时接管左键单击）
 * 2. 点击地图任意位置 → 返回该点的 经度 / 纬度 / 高程
 * 3. 优先拾取渲染表面（地形、3D Tiles 模型表面，带真实高程），失败时退回椭球面
 *
 * 为什么用"临时接管 + 退出恢复"：
 *   Cesium 的 ScreenSpaceEventHandler 同一事件类型只能有一个处理器，
 *   直接 setInputAction 会覆盖原有的点击交互（选树、行政区分级等）。
 *   所以本功能在开启时保存旧处理器、退出时恢复，与画多边形/路径规划模式一致。
 */
import { reactive } from 'vue'

const Cesium = window.Cesium

// ==================== 模块级状态 ====================
const coords = reactive({
    lon: null,
    lat: null,
    height: null,
    enabled: false,
})

let savedClickHandler = null

// ==================== 工具：窗口坐标 → 经纬度 ====================
export function pickLngLat(viewer, windowPosition) {
    if (!viewer) return null

    // 1. 优先用深度缓冲拾取渲染表面（地形 / 3D Tiles 表面，带高程）
    try {
        if (viewer.scene.pickPositionSupported) {
            const cartesian = viewer.scene.pickPosition(windowPosition)
            if (Cesium.defined(cartesian)) {
                const carto = Cesium.Cartographic.fromCartesian(cartesian)
                return {
                    lon: Cesium.Math.toDegrees(carto.longitude),
                    lat: Cesium.Math.toDegrees(carto.latitude),
                    height: carto.height,
                }
            }
        }
    } catch (e) {
        // 某些表面（如 3D Tiles 未命中）会抛异常，忽略并走兜底
    }

    // 2. 兜底：拾取椭球面（高程记 0）
    const ellipsoidPoint = viewer.camera.pickEllipsoid(
        windowPosition,
        viewer.scene.globe.ellipsoid
    )
    if (Cesium.defined(ellipsoidPoint)) {
        const carto = Cesium.Cartographic.fromCartesian(ellipsoidPoint)
        return {
            lon: Cesium.Math.toDegrees(carto.longitude),
            lat: Cesium.Math.toDegrees(carto.latitude),
            height: 0,
        }
    }
    return null
}

// ==================== Hook 入口 ====================
export function useClickCoordinates() {
    // 开启 / 关闭取坐标模式
    function togglePickMode(viewer) {
        if (!viewer) return
        const handler = viewer.screenSpaceEventHandler

        if (coords.enabled) {
            // 退出：恢复原来的左键处理器
            if (savedClickHandler) {
                handler.setInputAction(
                    savedClickHandler,
                    Cesium.ScreenSpaceEventType.LEFT_CLICK
                )
                savedClickHandler = null
            }
            coords.enabled = false
            return
        }

        // 进入：保存旧处理器，注册取坐标处理器
        savedClickHandler = handler.getInputAction(
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        )
        handler.setInputAction(
            (click) => {
                const picked = pickLngLat(viewer, click.position)
                if (picked) {
                    coords.lon = Number(picked.lon.toFixed(6))
                    coords.lat = Number(picked.lat.toFixed(6))
                    coords.height = Number(picked.height.toFixed(1))
                }
            },
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        )
        coords.enabled = true
    }

    // 手动恢复原交互（页面卸载时调用，防止残留）
    function restoreInteractions(viewer) {
        if (!coords.enabled || !viewer) return
        const handler = viewer.screenSpaceEventHandler
        if (savedClickHandler) {
            handler.setInputAction(
                savedClickHandler,
                Cesium.ScreenSpaceEventType.LEFT_CLICK
            )
            savedClickHandler = null
        }
        coords.enabled = false
    }

    return {
        coords,
        togglePickMode,
        restoreInteractions,
    }
}
