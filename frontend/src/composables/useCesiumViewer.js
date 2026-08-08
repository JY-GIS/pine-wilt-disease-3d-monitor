/**
 * Cesium Viewer 初始化 Hook
 *
 * 职责：
 * 1. 创建并配置 Cesium.Viewer 实例（单例）
 * 2. 加载 GeoServer WMS 图层
 * 3. 统计并暴露 FPS 帧率
 *
 * 其他模块通过 getViewer() 获取 viewer 实例
 */
import { ref } from 'vue'
import { CESIUM_CONFIG } from '../config/cesium.config.js'

const Cesium = window.Cesium

// ==================== 模块级单例 ====================
// 整个应用只有一个 viewer，存在函数外面防止重复创建
let viewerInstance = null

// ==================== Hook 入口 ====================
export function useCesiumViewer() {
    // FPS 帧率（响应式，供 FpsCounter 组件使用）
    const fps = ref(null)

    // ========== 初始化 Cesium Viewer ==========
    async function init() {
        // 防止重复初始化
        if (viewerInstance) {
            return viewerInstance
        }

        // 设置 Access Token
        Cesium.Ion.defaultAccessToken = CESIUM_CONFIG.ionToken

        // 创建地形服务（先创建再传入，避免异步问题）
        const terrainProvider = await Cesium.createWorldTerrainAsync(
            CESIUM_CONFIG.terrain
        )

        // 创建 Viewer
        viewerInstance = new Cesium.Viewer('cesiumContainer', {
            terrainProvider,
            ...CESIUM_CONFIG.viewer,
        })

        // GeoJSON 数据贴地
        Cesium.GeoJsonDataSource.clampToGround = true

        return viewerInstance
    }

    // ========== 加载 GeoScene Online 图层 ==========
    async function loadGeoSceneOnlineLayer(viewer) {
        const url = 'https://www.geosceneonline.cn/server/rest/services/Hosted/diseased_trees/FeatureServer/0';
        const res = await fetch(`${url}/query?where=1%3D1&outFields=*&f=geojson`);
        const geojson = await res.json();
        const ds = await Cesium.GeoJsonDataSource.load(geojson, {
            pointSize: 20,
            markerColor: Cesium.Color.RED.withAlpha(0.5),
            clampToGround: true
        });
        viewer.dataSources.add(ds);
        viewer.flyTo(ds);
    }

    // ========== 加载 GeoServer WMS 图层 ==========
    async function loadGeoServerLayer() {
        if (!viewerInstance) {
            console.warn('Viewer 未初始化，跳过 WMS 图层加载')
            return
        }

        const wmsProvider = new Cesium.WebMapServiceImageryProvider({
            url: '/geoserver/wms',
            layers: 'songcai:diseased_trees',
            parameters: {
                transparent: true,
                format: 'image/png',
                styles: 'diseased_trees_grade',
            },
        })
        viewerInstance.imageryLayers.addImageryProvider(wmsProvider)
    }

    // ========== FPS 帧率统计 ==========
    let lastTime = performance.now()
    let frameCount = 0

    function startFpsCounter() {
        if (!viewerInstance) return

        viewerInstance.scene.preRender.addEventListener(() => {
            frameCount++
            const now = performance.now()
            const delta = now - lastTime

            if (delta >= 1000) {
                fps.value = Math.round(frameCount / (delta / 1000))
                frameCount = 0
                lastTime = now
            }
        })
    }

    return {
        init,
        fps,
        loadGeoSceneOnlineLayer,
        loadGeoServerLayer,
        startFpsCounter,
    }
}

// ==================== 全局访问入口 ====================
/**
 * 获取 viewer 实例（任何 .js / .vue 文件都能调用）
 * @returns {Cesium.Viewer | null}
 */
export function getViewer() {
    return viewerInstance
}