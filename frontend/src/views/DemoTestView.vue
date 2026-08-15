<!--
  DemoTestView.vue —— 万能 Cesium 实验台（单文件版）
  页面：原始 Cesium 地球，无任何应用 UI（只有右下角 FPS 和顶部实验面板）
  初始相机：青岛市南区（120.385E, 36.065N）
  用法：访问 /#/demo-test，加实验只改 experiments 数组
-->
<template>
    <div class="demo-page">
        <div id="cesiumContainer"></div>
        <button class="coords-btn" @click="togglePickMode(viewer)">
            {{ coords.enabled ? '关闭取坐标' : '开启取坐标' }}
        </button>
        <div class="coords-panel" v-if="coords.lon !== null">
            <div>经度：{{ coords.lon }}°</div>
            <div>纬度：{{ coords.lat }}°</div>
            <div>高程：{{ coords.height }} m</div>
        </div>
    </div>
</template>

<script setup>
    import { onMounted, onUnmounted, ref } from 'vue'
    import { useClickCoordinates } from '../composables/useClickCoordinates.js'
    import { useCesiumViewer, getViewer } from '../composables/useCesiumViewer.js'

    const { init } = useCesiumViewer() 
    const {
        coords,              
        togglePickMode,             
        restoreInteractions: restorePickInteractions,
    } = useClickCoordinates()


    const Cesium = window.Cesium
    let viewer = null

    // ==================== 初始相机：青岛市南区 ====================
    const QINGDAO_SHINAN = {
        destination: Cesium.Cartesian3.fromDegrees(120.385, 36.047, 4000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-60),   
            roll: 0.0,
        },
    }
    
    // ==================== 模型加载函数 ====================
    function loadModel() {
        if (!viewer) return
        const longitude = 120.385;
        const latitude = 36.065;
        const height = 150;
        const modelUri = './models/plane.glb'
        viewer.entities.add({
            id: 'Cesium_Air_Plane',
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
            model: {
                uri: modelUri,
                scale: 40,
                minimumPixelSize: 200,
                maximumScale: 20,
                color: Cesium.Color.WHITE,
                colorBlendMode: Cesium.ColorBlendMode.MIX,
                colorBlendAmount: 0.0,
                shadows: Cesium.ShadowMode.ENABLED,
            },
            // 添加定位点
            point: {
                pixelSize: 8,
                color: Cesium.Color.LIME,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            },
        });
        // 在地面添加标记圈
        viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
            ellipse: {
                semiMajorAxis: 40.0,
                semiMinorAxis: 40.0,
                material: Cesium.Color.RED.withAlpha(0.25),
                outline: true,
                outlineColor: Cesium.Color.GREEN,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        })
        console.log('✅ Entity 模型已加载,ID: demoModel')
    }

    // =================== 模型CZML飞行 ===================
    function loadCzml() { 
        const czmlData = [
            {
                "id": "document",
                "version": "1.0",
                "clock": {
                "interval": "2025-01-01T00:00:00Z/2025-01-01T00:00:10Z",
                "currentTime": "2025-01-01T00:00:00Z",
                "multiplier": 1,
                "range": "LOOP_STOP"
                }
            },
            {
                "id": "movingPoint",
                "availability": "2025-01-01T00:00:00Z/2025-01-01T00:00:10Z",
                "position": {
                "interpolationAlgorithm": "LAGRANGE",
                "interpolationDegree": 1,
                "epoch": "2025-01-01T00:00:00Z",
                "cartographicDegrees": [
                    0,
                    120.391648,
                    36.070303,
                    100,
                    3,
                    120.393423,
                    36.075155,
                    110,
                    7,
                    120.385331,
                    36.077196,
                    100,
                    10,
                    120.377585,
                    36.066314,
                    90
                ]
                },
                "point": {
                "color": {
                    "rgba": [
                    0,
                    255,
                    0,
                    255
                    ]
                },
                "pixelSize": 16
                },
                "label": {
                "text": "飞机定位点",
                "font": "14px sans-serif",
                "fillColor": {
                    "rgba": [
                    255,
                    255,
                    255,
                    255
                    ]
                },
                "pixelOffset": {
                    "cartesian2": [
                    0,
                    20
                    ]
                }
                }
            },
            {
                "id": "movingModelPlane",
                "availability": "2025-01-01T00:00:00Z/2025-01-01T00:00:10Z",
                "position": {
                "interpolationAlgorithm": "LAGRANGE",
                "interpolationDegree": 1,
                "epoch": "2025-01-01T00:00:00Z",
                "cartographicDegrees": [
                    0,
                    120.391648,
                    36.070303,
                    103,
                    3,
                    120.393423,
                    36.075155,
                    113,
                    7,
                    120.385331,
                    36.077196,
                    103,
                    10,
                    120.377585,
                    36.066314,
                    93
                ]
                },
                "model": {
                "gltf": "./models/drone.glb",
                "scale": 40,
                "minimumPixelSize": 32
                },
                "orientation": {
                "epoch": "2025-01-01T00:00:00Z",
                "unitQuaternion": [
                    0,
                    0,
                    0,
                    0,
                    1,
                    5,
                    0,
                    0,
                    0,
                    1,
                    10,
                    0,
                    0,
                    0,
                    1
                ]
                }
            }
        ]
        viewer.dataSources.add(
            Cesium.CzmlDataSource.load(czmlData)
        ).then(ds => {
            viewer.zooTo(ds)
        }).catch(e => console.error(e))
    }

    // ==================== 挂载 / 卸载 ====================
    onMounted(async () => {
        await init()                        // ① 创建 viewer（依赖上面的容器）
        viewer = getViewer()                // ② 拿到实例
        viewer.clock.shouldAnimate = true   // ③ 动画需要时钟
        viewer.camera.setView(QINGDAO_SHINAN)  // ④ 才能设初始视角

        loadModel()
        loadCzml()
    })

    // 组件销毁时清理资源（viewer 由 composable 管理，此处不重复销毁） 
    onUnmounted(() => {
        // 如果需要在组件卸载时移除模型，可以执行：
        if (viewer) {
            viewer.entities.removeById('Cesium_Air_Plane')
        }
        restorePickInteractions(viewer) 
        destroyViewer() 
    })
</script>

<style scoped>
.demo-page { width: 100vw; height: 100vh; position: relative; overflow: hidden; }
#cesiumContainer { width: 100%; height: 100%; }
.coords-panel {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 100;
    background: rgba(10, 40, 60, 0.9);
    border: 1px solid #00d4ff;
    color: #e8f0fe;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.6;
    padding: 6px 10px;
    border-radius: 4px;
}
.coords-btn {
    position: absolute;
    top: 8px;
    left: 8px;
}
</style>