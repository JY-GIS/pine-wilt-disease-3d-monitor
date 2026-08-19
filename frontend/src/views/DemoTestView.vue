<!--
  GPU Instancing 树木实验页：
  1. 加载 Low 3D Tiles
  2. 验证 Cesium3DTileFeature 实例级 Picking
-->
<template>
    <div class="demo-page">
        <div id="cesiumContainer"></div>

        <button class="coords-btn" @click="togglePickMode(viewer)">
            {{ coords.enabled ? '关闭取坐标' : '开启取坐标' }}
        </button>

        <div v-if="coords.lon !== null" class="coords-panel">
            <div>经度：{{ coords.lon }}°</div>
            <div>纬度：{{ coords.lat }}°</div>
            <div>高程：{{ coords.height }} m</div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useClickCoordinates } from '../composables/useClickCoordinates.js'
import {
    destroyViewer,
    getViewer,
    useCesiumViewer,
} from '../composables/useCesiumViewer.js'

const Cesium = window.Cesium

// ==================== Tileset 配置 ====================
// 仅用于当前实验页，不影响正式业务页面的 Cesium 配置。
const TILESET_OPTIONS = {
    shadows: Cesium.ShadowMode.DISABLED,
    maximumScreenSpaceError: 32,
    dynamicScreenSpaceError: true,
}

const { init } = useCesiumViewer()
const {
    coords,
    togglePickMode,
    restoreInteractions: restorePickInteractions,
} = useClickCoordinates()

// ==================== 运行时引用 ====================
// 页面销毁时统一释放，避免重复进入实验页后残留监听器或图元。
let viewer = null
let lowTreeTileset = null
let inspectHandler = null

/**
 * 输出被点击实例的完整 metadata。
 * featureId 是 tile 内部局部编号，不能替代数据库业务主键。
 */
function logPickedFeature(feature) {
    const properties = Object.fromEntries(
        feature.getPropertyIds().map((propertyId) => [
            propertyId,
            feature.getProperty(propertyId),
        ])
    )

    console.group('GPU Instance Picking')
    console.log('feature：', feature)
    console.log('feature properties：', properties)
    console.log(
        'tree_id：',
        feature.hasProperty('tree_id')
            ? feature.getProperty('tree_id')
            : undefined
    )
    console.log(
        'disease_level：',
        feature.hasProperty('disease_level')
            ? feature.getProperty('disease_level')
            : undefined
    )
    console.log('featureId：', feature.featureId)
    console.groupEnd()
}

/** 注册 GPU Instance 左键 Picking。 */
function setupPicking() {
    inspectHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    inspectHandler.setInputAction((event) => {
        const picked = viewer.scene.pick(event.position)

        if (!(picked instanceof Cesium.Cesium3DTileFeature)) {
            console.log('未点击到 Cesium3DTileFeature：', picked)
            return
        }

        logPickedFeature(picked)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

/** 从场景中安全移除指定 tileset。 */
function removeTileset(tileset) {
    if (viewer && tileset) {
        viewer.scene.primitives.remove(tileset)
    }
}

// ==================== 页面初始化 ====================
onMounted(async () => {
    // 创建 Cesium Viewer。
    await init()
    viewer = getViewer()

    // 本阶段只加载 Low，保持万级 GPU Instancing 基线。
    lowTreeTileset = await Cesium.Cesium3DTileset.fromUrl(
        '/tree-tiles/low/tileset.json',
        { ...TILESET_OPTIONS }
    )
    viewer.scene.primitives.add(lowTreeTileset)
    viewer.scene.debugShowFramesPerSecond = true

    // Picking 只在点击时执行，不增加逐帧 metadata 查询。
    setupPicking()

    // 飞到树木测试数据所在区域。
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(117.75, 36.0, 50000),
        orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-60),
            roll: 0,
        },
    })
})

// ==================== 页面销毁 ====================
onUnmounted(() => {
    // 依次释放 Picking handler、tileset 和 Viewer。
    if (inspectHandler && !inspectHandler.isDestroyed()) {
        inspectHandler.destroy()
    }
    inspectHandler = null

    removeTileset(lowTreeTileset)
    lowTreeTileset = null

    restorePickInteractions(viewer)
    destroyViewer()
    viewer = null
})
</script>

<style scoped>
.demo-page {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
}

#cesiumContainer {
    width: 100%;
    height: 100%;
}

.coords-btn {
    position: absolute;
    top: 8px;
    left: 8px;
}

.coords-panel {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 100;
    padding: 6px 10px;
    color: #e8f0fe;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.6;
    background: rgba(10, 40, 60, 0.9);
    border: 1px solid #00d4ff;
    border-radius: 4px;
}
</style>
