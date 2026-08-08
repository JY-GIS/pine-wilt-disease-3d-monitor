/**
 * Cesium 全局配置
 * 集中管理所有 Cesium 相关的常量和默认值
 */

export const CESIUM_CONFIG = {
    // ========== Cesium Ion Access Token ==========
    ionToken:
        import.meta.env.VITE_CESIUM_TOKEN || '',

    // ========== 地形服务配置 ==========
    terrain: {
        requestWaterMask: false,
        requestVertexNormals: true,
    },

    // ========== Viewer 默认设置 ==========
    viewer: {
        timeline: false,
        animation: false,
        geocoder: false,
        sceneModePicker: false,
        fullscreenButton: false,
        navigationHelpButton: false,
        homeButton: false,
        baseLayerPicker: true,
        infoBox: false,
    },

    // ========== 默认相机视角 ==========
    defaultCamera: {
        // 初始宏观视角
        initial: {
            longitude: 103.90,
            latitude: 36.05,
            height: 5000000,
            heading: 0,
            pitch: -90.0,
            roll: 0.0,
        },
        // 飞到数据后的视角
        flyToData: {
            duration: 3, // 飞行秒数
            maximumHeight: 1500000,
            delay: 1000, // 延迟毫秒
        },
    },

    // ========== 默认相机视角 ==========
    defaultView: {
        longitude: 103.90,
        latitude: 36.05,
        height: 5000000,
        heading: 0,
        pitch: -90.0,
        roll: 0.0,
    },
}