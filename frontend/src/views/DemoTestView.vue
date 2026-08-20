<!--
  GPU Instancing 树木实验页：
  1. 1 km 内按区域加载 High GPU Instancing
  2. 1–8 km 按区域加载 Low GPU Instancing
  3. 远处只显示位于屏幕内的聚合树
  4. 验证区域聚合和 Cesium3DTileFeature Picking
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
// ====================
// 1. imports
// ====================

import { onMounted, onUnmounted } from 'vue'
import { useClickCoordinates } from '../composables/useClickCoordinates.js'
import {
    destroyViewer,
    getViewer,
    useCesiumViewer,
} from '../composables/useCesiumViewer.js'

const Cesium = window.Cesium

// ====================
// 2. 配置参数
// ====================

// LOD 距离使用进入/退出两组阈值，形成缓冲区，防止边界处频繁切换。
const LOW_ENTER_DISTANCE = 8000
const LOW_EXIT_DISTANCE = 9000
const HIGH_ENTER_DISTANCE = 1000
const HIGH_EXIT_DISTANCE = 1200

const CAMERA_CHANGE_PERCENTAGE = 0.02
const SCREEN_MARGIN = 80

const CLUSTER_MODEL_URI = '/models/pine-green.glb'
const CLUSTER_MODEL_SCALE = 1000
// 当前实验页加载已写入 DEM 高程的10,205棵数据；原 spatial 基线仍保留不动。
const SPATIAL_MANIFEST_URI = '/tree-tiles/spatial-dem/manifest.json'
const SPATIAL_TILESET_BASE_URI = '/tree-tiles/spatial-dem'

const TILESET_OPTIONS = {
    shadows: Cesium.ShadowMode.DISABLED,
    maximumScreenSpaceError: 32,
    dynamicScreenSpaceError: true,
}

const INITIAL_CAMERA = {
    longitude: 117.75,
    latitude: 36.0,
    height: 50000,
    heading: 0,
    pitch: -60,
    roll: 0,
}

// 由当前 16 个 Low Tile 统计得到，总计 10,205 棵树。
const CLUSTER_REGIONS = [
    { id: '2_0_0', treeCount: 419, longitude: 117.160983, latitude: 35.215176 },
    { id: '2_0_1', treeCount: 636, longitude: 117.154313, latitude: 35.700552 },
    { id: '2_0_2', treeCount: 640, longitude: 117.154800, latitude: 36.316033 },
    { id: '2_0_3', treeCount: 406, longitude: 117.159352, latitude: 36.815650 },
    { id: '2_1_0', treeCount: 626, longitude: 117.532798, latitude: 35.204323 },
    { id: '2_1_1', treeCount: 971, longitude: 117.530622, latitude: 35.702747 },
    { id: '2_1_2', treeCount: 962, longitude: 117.531696, latitude: 36.320256 },
    { id: '2_1_3', treeCount: 548, longitude: 117.541538, latitude: 36.798612 },
    { id: '2_2_0', treeCount: 631, longitude: 117.973737, latitude: 35.206199 },
    { id: '2_2_1', treeCount: 850, longitude: 117.995109, latitude: 35.718367 },
    { id: '2_2_2', treeCount: 972, longitude: 117.983851, latitude: 36.297384 },
    { id: '2_2_3', treeCount: 580, longitude: 117.989826, latitude: 36.807051 },
    { id: '2_3_0', treeCount: 350, longitude: 118.357620, latitude: 35.200566 },
    { id: '2_3_1', treeCount: 585, longitude: 118.352661, latitude: 35.705169 },
    { id: '2_3_2', treeCount: 612, longitude: 118.357991, latitude: 36.314634 },
    { id: '2_3_3', treeCount: 417, longitude: 118.351475, latitude: 36.812161 },
]

// ====================
// 3. Cesium 状态
// ====================

const { init } = useCesiumViewer()
const {
    coords,
    togglePickMode,
    restoreInteractions: restorePickInteractions,
} = useClickCoordinates()

// 页面销毁时统一释放，避免重复进入实验页后残留监听器或图元。
let viewer = null
let inspectHandler = null
let clusterEntities = []
let clusterRuntimes = []
let cellRuntimes = []
let removeCameraChanged = null
let removeCameraMoveEnd = null
let previousPercentageChanged = null
let isPageActive = false

const scratchToRegion = new Cesium.Cartesian3()
const scratchWindowPosition = new Cesium.Cartesian2()
const scratchCellGround = new Cesium.Cartesian3()

// ====================
// 4. LOD 数据结构
// ====================

/** 创建 16 个父级聚合区域的运行时状态。 */
function initializeClusterRuntimes() {
    clusterRuntimes = CLUSTER_REGIONS.map((region) => ({
        ...region,
        position: Cesium.Cartesian3.fromDegrees(
            region.longitude,
            region.latitude
        ),
        clusterEntity: null,
    }))
}

/** 读取 64 个空间小块，每块分别记录 High 和 Low 的加载状态。 */
async function loadSpatialCellManifest() {
    const response = await fetch(SPATIAL_MANIFEST_URI)
    if (!response.ok) {
        throw new Error(`空间小块清单加载失败：HTTP ${response.status}`)
    }
    const manifest = await response.json()
    cellRuntimes = manifest.cells.map((cell) => ({
        ...cell,
        lowTileset: null,
        lowLoadingPromise: null,
        lowReady: false,
        highTileset: null,
        highLoadingPromise: null,
        highReady: false,
        desiredLevel: 'cluster',
        isWithinLowRange: false,
        isWithinHighRange: false,
    }))
}

// ====================
// 5. 初始化函数
// ====================

/** 创建远景聚合病树；每个 Entity 对应一个父级区域。 */
function createClusterEntities() {
    clusterEntities = clusterRuntimes.map((region) => {
        const entity = viewer.entities.add({
            id: `tree-cluster-${region.id}`,
            name: `病树聚合区域 ${region.id}`,
            position: region.position,
            show: false,
            model: {
                // 远景聚合使用 High Green 模型，不代表单棵真实树。
                uri: CLUSTER_MODEL_URI,
                scale: CLUSTER_MODEL_SCALE,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                shadows: Cesium.ShadowMode.DISABLED,
            },
            label: {
                text: `${region.treeCount} 棵`,
                font: '16px Microsoft YaHei',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
                pixelOffset: new Cesium.Cartesian2(0, -42),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
                featureType: 'tree_cluster',
                clusterId: region.id,
                treeCount: region.treeCount,
            },
        })

        region.clusterEntity = entity
        return entity
    })
}

// ====================
// 6. tileset 加载相关函数
// ====================

/** 判断某一级模型是否需要显示，包括切换时保留上一层的无空白兜底。 */
function shouldShowLodTileset(cell, level) {
    if (level === 'high') {
        return (
            cell.desiredLevel === 'high' ||
            (cell.desiredLevel === 'low' &&
                !cell.lowReady &&
                cell.highReady)
        )
    }

    return (
        cell.desiredLevel === 'low' ||
        (cell.desiredLevel === 'high' &&
            !cell.highReady &&
            cell.lowReady)
    )
}

/** 首次进入对应距离范围时，才懒加载指定小块和指定精度。 */
function loadLodTileset(cell, level) {
    const levelName = level === 'high' ? 'High' : 'Low'
    const tilesetKey = `${level}Tileset`
    const loadingKey = `${level}LoadingPromise`
    const readyKey = `${level}Ready`

    if (cell[tilesetKey] || cell[loadingKey]) {
        return
    }

    cell[loadingKey] = Cesium.Cesium3DTileset.fromUrl(
        `${SPATIAL_TILESET_BASE_URI}/${level}/regions/${cell.id}.json`,
        { ...TILESET_OPTIONS }
    )
        .then((tileset) => {
            if (!isPageActive || !viewer || viewer.isDestroyed()) {
                tileset.destroy()
                return
            }

            tileset.show = shouldShowLodTileset(cell, level)
            cell[tilesetKey] = tileset

            // tileLoad 表示区域 GLB 内容已经下载并完成处理。
            // Cesium 不允许在该回调中直接修改场景，因此延迟到下一轮执行。
            tileset.tileLoad.addEventListener(() => {
                if (cell[readyKey]) {
                    return
                }
                cell[readyKey] = true
                setTimeout(() => {
                    if (!isPageActive) {
                        return
                    }
                    updateLodByCamera()
                }, 0)
            })
            tileset.tileFailed.addEventListener((error) => {
                console.error(
                    `小块 ${cell.id} 的 ${levelName} GLB 加载失败：`,
                    error.url,
                    error.message
                )
            })
            viewer.scene.primitives.add(tileset)
        })
        .catch((error) => {
            if (isPageActive) {
                console.error(
                    `小块 ${cell.id} 的 ${levelName} tileset 加载失败：`,
                    error
                )
            }
        })
        .finally(() => {
            cell[loadingKey] = null
        })
}

/** 从场景中安全移除指定区域的 tileset。 */
function removeTilesetSafely(tileset) {
    if (viewer && !viewer.isDestroyed() && tileset) {
        viewer.scene.primitives.remove(tileset)
    }
}

// ====================
// 7. LOD 切换核心逻辑
// ====================

/** 判断聚合点是否位于当前屏幕附近，避免显示镜头背后的聚合树。 */
function isPointOnScreen(position) {
    Cesium.Cartesian3.subtract(
        position,
        viewer.camera.positionWC,
        scratchToRegion
    )
    if (Cesium.Cartesian3.dot(viewer.camera.directionWC, scratchToRegion) <= 0) {
        return false
    }

    const windowPosition = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        position,
        scratchWindowPosition
    )
    if (!Cesium.defined(windowPosition)) {
        return false
    }

    const canvas = viewer.scene.canvas
    return (
        windowPosition.x >= -SCREEN_MARGIN &&
        windowPosition.x <= canvas.clientWidth + SCREEN_MARGIN &&
        windowPosition.y >= -SCREEN_MARGIN &&
        windowPosition.y <= canvas.clientHeight + SCREEN_MARGIN
    )
}

/** 计算摄像机到小块地表矩形的最近距离，而不是到小块中心的距离。 */
function getCameraDistanceToCell(camera, cell) {
    const [west, south, east, north] = cell.region
    const cartographic = camera.positionCartographic
    const nearestLongitude = Cesium.Math.clamp(
        cartographic.longitude,
        west,
        east
    )
    const nearestLatitude = Cesium.Math.clamp(
        cartographic.latitude,
        south,
        north
    )
    Cesium.Cartesian3.fromRadians(
        nearestLongitude,
        nearestLatitude,
        0,
        Cesium.Ellipsoid.WGS84,
        scratchCellGround
    )
    return Cesium.Cartesian3.distance(camera.positionWC, scratchCellGround)
}

/**
 * 按摄像机状态更新 64 个空间小块：
 * 小块边界 1 km 内显示 High，1–8 km 显示 Low，其余显示父区域聚合树。
 */
function updateLodByCamera() {
    if (!isPageActive || !viewer || viewer.isDestroyed()) {
        return
    }

    const camera = viewer.camera
    const parentStates = new Map(
        clusterRuntimes.map((region) => [
            region.id,
            { hasActiveCell: false, allActiveCellsReady: true },
        ])
    )

    cellRuntimes.forEach((cell) => {
        const distance = getCameraDistanceToCell(camera, cell)
        // 两级距离都带缓冲，避免摄像机位于边界时反复切换。
        cell.isWithinLowRange = cell.isWithinLowRange
            ? distance < LOW_EXIT_DISTANCE
            : distance <= LOW_ENTER_DISTANCE
        cell.isWithinHighRange = cell.isWithinHighRange
            ? distance < HIGH_EXIT_DISTANCE
            : distance <= HIGH_ENTER_DISTANCE

        cell.desiredLevel = !cell.isWithinLowRange
            ? 'cluster'
            : cell.isWithinHighRange
              ? 'high'
              : 'low'

        if (cell.desiredLevel === 'low') {
            loadLodTileset(cell, 'low')
        } else if (cell.desiredLevel === 'high') {
            loadLodTileset(cell, 'high')
        }

        if (cell.lowTileset) {
            cell.lowTileset.show = shouldShowLodTileset(cell, 'low')
        }
        if (cell.highTileset) {
            cell.highTileset.show = shouldShowLodTileset(cell, 'high')
        }

        const hasFallback =
            cell.desiredLevel === 'low'
                ? cell.lowReady || cell.highReady
                : cell.desiredLevel === 'high'
                  ? cell.highReady || cell.lowReady
                  : true

        if (cell.desiredLevel !== 'cluster') {
            const parentState = parentStates.get(cell.parentId)
            parentState.hasActiveCell = true
            parentState.allActiveCellsReady &&= hasFallback
        }
    })

    clusterRuntimes.forEach((region) => {
        const state = parentStates.get(region.id)
        region.clusterEntity.show =
            isPointOnScreen(region.position) &&
            (!state.hasActiveCell || !state.allActiveCellsReady)
    })

    viewer.scene.requestRender()
}

/** 注册摄像机监听；每次只检查 64 个空间小块，不遍历 10,205 棵树。 */
function setupLodCameraListeners() {
    previousPercentageChanged = viewer.camera.percentageChanged
    viewer.camera.percentageChanged = CAMERA_CHANGE_PERCENTAGE
    removeCameraChanged = viewer.camera.changed.addEventListener(
        updateLodByCamera
    )
    removeCameraMoveEnd = viewer.camera.moveEnd.addEventListener(
        updateLodByCamera
    )
    updateLodByCamera()
}

// ====================
// 8. Picking 逻辑
// ====================

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

/** 输出被点击聚合区域的真实树木数量。 */
function logPickedCluster(entity) {
    const time = viewer.clock.currentTime
    const clusterId = entity.properties.clusterId.getValue(time)
    const treeCount = entity.properties.treeCount.getValue(time)

    console.group('Tree Cluster Picking')
    console.log('cluster entity：', entity)
    console.log('cluster_id：', clusterId)
    console.log('tree_count：', treeCount)
    console.log(`该区域共有 ${treeCount} 棵病树`)
    console.groupEnd()
}

/** 注册聚合树和 GPU Instance 的左键 Picking。 */
function setupTreePicking() {
    inspectHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    inspectHandler.setInputAction((event) => {
        const picked = viewer.scene.pick(event.position)

        if (
            picked?.id instanceof Cesium.Entity &&
            picked.id.properties?.featureType?.getValue(
                viewer.clock.currentTime
            ) === 'tree_cluster'
        ) {
            logPickedCluster(picked.id)
            return
        }

        if (!(picked instanceof Cesium.Cesium3DTileFeature)) {
            return
        }

        logPickedFeature(picked)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

// ====================
// 9. 生命周期
// ====================

onMounted(async () => {
    // 创建 Cesium Viewer。
    await init()
    viewer = getViewer()
    isPageActive = true

    // 不加载整套 tileset，只按距离懒加载64个小块的Low或High。
    initializeClusterRuntimes()
    await loadSpatialCellManifest()
    createClusterEntities()
    setupLodCameraListeners()
    viewer.scene.debugShowFramesPerSecond = true

    // Picking 只在点击时执行，不增加逐帧 metadata 查询。
    setupTreePicking()

    // 飞到树木测试数据所在区域。
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            INITIAL_CAMERA.longitude,
            INITIAL_CAMERA.latitude,
            INITIAL_CAMERA.height
        ),
        orientation: {
            heading: Cesium.Math.toRadians(INITIAL_CAMERA.heading),
            pitch: Cesium.Math.toRadians(INITIAL_CAMERA.pitch),
            roll: Cesium.Math.toRadians(INITIAL_CAMERA.roll),
        },
    })
})

onUnmounted(() => {
    // 先阻止异步 tileset 在页面销毁后重新加入场景。
    isPageActive = false

    if (removeCameraChanged) {
        removeCameraChanged()
        removeCameraChanged = null
    }
    if (removeCameraMoveEnd) {
        removeCameraMoveEnd()
        removeCameraMoveEnd = null
    }
    if (viewer && previousPercentageChanged !== null) {
        viewer.camera.percentageChanged = previousPercentageChanged
    }
    previousPercentageChanged = null

    // 依次释放 Picking handler、聚合 Entity、区域 tileset 和 Viewer。
    if (inspectHandler && !inspectHandler.isDestroyed()) {
        inspectHandler.destroy()
    }
    inspectHandler = null

    clusterEntities.forEach((entity) => viewer?.entities.remove(entity))
    clusterEntities = []

    cellRuntimes.forEach((cell) => {
        removeTilesetSafely(cell.lowTileset)
        removeTilesetSafely(cell.highTileset)
        cell.lowTileset = null
        cell.highTileset = null
    })
    cellRuntimes = []
    clusterRuntimes.forEach((region) => {
        region.clusterEntity = null
    })
    clusterRuntimes = []

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
