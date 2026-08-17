<!--
  MainView.vue
  职责：3D 大屏页面（原 App.vue 的全部内容）
        Cesium 地球 + 左右面板 + Header/Footer + 所有交互
  
  边界情况：
    - 页面切换离开时 Cesium 会销毁（组件卸载），
      返回时重新初始化（本科项目可接受）
    - 如果后端挂了 → 病树数据加载失败 → console.error，
      不影响 Cesium 地球正常显示
-->
<template>
    <div class="dashboard-container">
        <!-- ========== 顶部标题栏 ========== -->
        <AppHeader />

        <!-- ========== 主体三列布局 ========== -->
        <main class="main-content">
            <!-- 左侧面板 -->
            <LeftSidePanel />

            <!-- 中间：Cesium 地球 -->
            <section class="center-map">
                <div id="cesiumContainer"></div>
                <FpsCounter :fps="fps"  />
                <button class="mode-switch-btn mode-switch-btn--left" @click="handleModeSwitch(viewer)">
                    {{ isPrimitiveMode ? '切换到 Entity 模式' : '切换到 Primitive 模式' }}
                </button>
                <button class="mode-switch-btn mode-switch-btn--left" style="top: 48px" @click="handleLoadHK">
                    {{ tilesetState.loaded ? '卸载香港数据' : '加载香港 3D Tiles' }}
                </button>
                <button class="mode-switch-btn mode-switch-btn--right" @click="handleTogglePine">
                    {{ pineState.enabled ? '切换回病树点' : '切换 3D 松树' }}
                </button>
                <div class="measure-result-panel" v-if="(measureState.enabled || measureState.finished) || heightState.finished || (areaState.enabled || areaState.finished)">
                    <div class="measure-result-title">
                        <span>{{ (measureState.enabled || measureState.finished) ? '测距结果' : (heightState.finished ? '测高结果' : '面积结果') }}</span>
                        <button class="measure-result-close" @click="handleClearMeasure" title="关闭">×</button>
                    </div>
                    <div class="measure-result-body">
                        <template v-if="measureState.enabled || measureState.finished">
                            <span>段数：{{ measureState.segmentCount }}</span>
                            <span>水平：{{ formatDistance(measureState.totalHorizontal) }}</span>
                            <span>空间：{{ formatDistance(measureState.totalSpatial) }}</span>
                            <span>高差：{{ formatDistance(measureState.totalVertical) }}</span>
                            <span>坡度：{{ formatAngle(measureState.totalSlopeAngle) }}</span>
                        </template>
                        <template v-else-if="heightState.finished">
                            <span>{{ formatHeightCompare(heightState.heightA, heightState.heightB) }}</span>
                            <span>起点(A)高程：{{ formatHeight(heightState.heightA) }}</span>
                            <span>终点(B)高程：{{ formatHeight(heightState.heightB) }}</span>
                        </template>
                        <template v-else>
                            <span>面积：{{ formatArea(areaState.areaM2) }}</span>
                        </template>
                    </div>
                </div>
                <div class="map-tools-bottom-left">
                    <button class="tool-btn" title="点击取坐标" @click="handleTogglePick">📍</button>
                    <button class="tool-btn" :title="measureState.enabled ? '右键结束测距' : '测距'" @click="handleToggleMeasure">📏</button>
                    <button class="tool-btn" :title="heightState.enabled ? '右键取消测高' : '测高度'" @click="handleToggleHeight">📐</button>
                    <button class="tool-btn" :title="areaState.enabled ? '右键闭合面积' : '测面积'" @click="handleToggleArea">🔲</button>
                    <div class="coords-panel" v-if="coords.lon !== null">
                        <button class="coords-close" @click="closeCoordsPanel" title="关闭">❌</button>
                        <div>经度：{{ coords.lon }}°</div>
                        <div>纬度：{{ coords.lat }}°</div>
                        <div>高程：{{ coords.height }} m</div>
                        <button class="coords-copy" @click="copyCoords">复制</button>
                    </div>
                </div>
            </section>

            <!-- 右侧面板 -->
            <RightSidePanel />
        </main>

        <!-- ========== 底部图例条 ========== -->
        <AppFooter />
    </div>
</template>

<script setup>
    import { onMounted, onUnmounted, ref, provide, watch } from 'vue'
    import LeftSidePanel from '../components/panels/LeftSidePanel.vue'
    import RightSidePanel from '../components/panels/RightSidePanel.vue'
    import AppHeader from '../components/layout/AppHeader.vue'
    import AppFooter from '../components/layout/AppFooter.vue'
    import FpsCounter from '../components/viewer/FpsCounter.vue'
    import { useCesiumViewer, getViewer, destroyViewer } from '../composables/useCesiumViewer.js'
    import { useDiseasedTrees, treeState } from '../composables/useDiseasedTrees.js'
    import { useTreeInteraction } from '../composables/useTreeInteraction.js'
    import { useBufferAnalysis, bufferConfigList, bufferVisibleAll } from '../composables/useBufferAnalysis.js'
    import { useNearbySearch } from '../composables/useNearbySearch.js'
    import { useTreeStore } from '../stores/treeStore.js'
    import { usePolygonDraw, clearPolygonFromMap } from '../composables/usePolygonDraw.js'
    import { useRoutePlanning } from '../composables/useRoutePlanning.js'
    import { useDroneFlight } from '../composables/useDroneFlight.js'
    import { useSearchTree } from '../composables/useSearchTree.js'
    import { useGradeFilter } from '../composables/useGradeFilter.js' 
    import { useAdminDivision } from '../composables/useAdminDivision.js'
    import { useAdminDivisionStore } from '../stores/adminDivisionStore.js'
    import { useSpatioTemporalStore } from '../stores/spatioTemporalStore.js'
    import { useCentroidMigration } from '../composables/useCentroidMigration.js'
    import { useTileset3D } from '../composables/useTileset3D.js'
    import { useClickCoordinates } from '../composables/useClickCoordinates.js'
    import { usePineTreesModel3D } from '../composables/usePineTreesModel3D.js'
    import { useDroneCameraFollow } from '../composables/useDroneCameraFollow.js'
    import { useMeasureDistance, measureState } from '../composables/useMeasureDistance.js'
    import { useMeasureHeight, heightState } from '../composables/useMeasureHeight.js'
    import { useMeasureArea, areaState } from '../composables/useMeasureArea.js'
    import { formatDistance, formatAngle, formatHeight, formatHeightCompare, formatArea } from '../utils/measureUtils.js'

    //====================== 【全局变量统一管理】 ======================
    const { 
        init, 
        fps,
        loadGeoSceneOnlineLayer,
        startFpsCounter 
    } = useCesiumViewer();
    let viewer
    const { 
        loadDiseasedTreesPoints, 
        loadOutbreakPolygon, 
        switchToMixedMode, 
        isPrimitiveMode 
    } = useDiseasedTrees();
    const { 
        handleLeftClickEvent, 
        setupDoubleClickToFly, 
        generateMergedBuffer, 
        highLightTree, 
        deleteTree, 
        clearSearchResults 
    } = useTreeInteraction();
    const { 
        toggleAllBuffered, 
        toggleSingleBuffer 
    } = useBufferAnalysis();
    const { 
        searchNearbyTrees 
    } = useNearbySearch();
    const treeStore = useTreeStore()
    const {
        setRestoreCallback,
        toggleDrawingMode,
        closePolygonPanel: closePolygonPanelFull,
    } = usePolygonDraw()
    const {
        toggleRoutePlanningMode,
        fetchAndDraw,
        clearRouteFromMap,
        setRestoreCallback: setRouteRestoreCallback,
    } = useRoutePlanning()
    const droneFlight = useDroneFlight()
    const {
        startDrone,
        pauseDrone,
        resumeDrone,
        hideDrone,
        showDrone,
        clearDrone,
    } = droneFlight
    const {
        toggleCameraFollow,
        clearCameraFollow,
    } = useDroneCameraFollow(droneFlight)
    const { searchTreeById } = useSearchTree()
    const {
        loadGradeStats,
        refreshGradeStats,
        applyGradeFilter,
        applyCurrentFilter,
    } = useGradeFilter()
    const adminStore = useAdminDivisionStore()
    const {
        loadProvincesLayer,
        setupProvinceInteraction,
        applyAllFilters,
        backToNational,
        backToProvince,
        toggleAdminVisibility, 
    } = useAdminDivision()
    const spatioStore = useSpatioTemporalStore()
    const { 
        clearAll: clearCentroidLines, 
        render: renderCentroidLines 
        // 解构重命名，防止其他模块也有clearAll
    } = useCentroidMigration()
    const { 
        state: tilesetState,
        loadTileset, 
        unloadTileset 
    } = useTileset3D()
    const {
        coords,
        togglePickMode,
        restoreInteractions: restorePickInteractions,
    } = useClickCoordinates()
    const {
        pineState,
        togglePineMode,
        applyGradeFilter: applyPineGradeFilter,
        unloadPineEntities,
    } = usePineTreesModel3D()
    const {
        setRestoreCallback: setMeasureRestoreCallback,
        toggle: toggleMeasure,
        clear: clearMeasure,
    } = useMeasureDistance()
    const {
        setRestoreCallback: setHeightRestoreCallback,
        toggle: toggleHeight,
        clear: clearHeight,
    } = useMeasureHeight()
    const {
        setRestoreCallback: setAreaRestoreCallback,
        toggle: toggleArea,
        clear: clearArea,
    } = useMeasureArea()

    // ===== 函数（仍需 viewer，保留 provide） =====
    provide('deleteTree', async () => { await deleteTree(viewer);refreshGradeStats() })
    provide('searchNearbyTrees', () => searchNearbyTrees(viewer))
    provide('closePolygonPanel', () => closePolygonPanelFull(viewer))
    provide('toggleAllBuffered', () => toggleAllBuffered(viewer))
    provide('toggleSingleBuffer', (key) => toggleSingleBuffer(viewer, key))
    provide('toggleDrawingMode', () => toggleDrawingMode(viewer))
    provide('toggleRoutePlanningMode', () => toggleRoutePlanningMode(viewer))
    provide('fetchAndDraw', () => fetchAndDraw(viewer))
    provide('clearRouteFromMap', () => clearRouteFromMap(viewer))
    provide('searchTreeById', (treeId) => searchTreeById(treeId))
    provide('backToProvince', () => backToProvince(viewer))
    provide('backToNational', () => backToNational(viewer))
    provide('toggleAdminVisibility', () => toggleAdminVisibility())
    provide('startDrone', () => {clearCameraFollow(viewer);startDrone(viewer)})
    provide('pauseDrone', () => pauseDrone(viewer))
    provide('resumeDrone', () => resumeDrone(viewer))
    provide('hideDrone', () => hideDrone(viewer))
    provide('showDrone', () => showDrone(viewer))
    provide('clearDrone', () => {clearCameraFollow(viewer);clearDrone(viewer)})
    provide('toggleCameraFollow', () => toggleCameraFollow(viewer))

    //==================== 【测试香港3dtiles加载】 ====================
    function handleLoadHK() {
        if(tilesetState.loaded) {
            unloadTileset(viewer)
        } else {
            loadTileset(viewer, '/3dtiles/HongKong/tileset.json')
        }
    }

    // ==================== 【点击取坐标】 ====================
    function handleTogglePick() {
        // 取坐标前先退出测距，避免左键冲突
        if (measureState.enabled) toggleMeasure(viewer)
        if (heightState.enabled) toggleHeight(viewer)
        if (areaState.enabled) toggleArea(viewer)
        togglePickMode(viewer)
    }

    // ====== 测距切换与清空 ======
    function handleToggleMeasure() {
        if (coords.enabled) togglePickMode(viewer)
        if (heightState.enabled) toggleHeight(viewer)
        if (areaState.enabled) toggleArea(viewer)
        toggleMeasure(viewer)
    }
    function handleToggleHeight() {
        if (coords.enabled) togglePickMode(viewer)
        if (measureState.enabled) toggleMeasure(viewer)
        if (areaState.enabled) toggleArea(viewer)
        toggleHeight(viewer)
    }
    function handleToggleArea() {
        if (coords.enabled) togglePickMode(viewer)
        if (measureState.enabled) toggleMeasure(viewer)
        if (heightState.enabled) toggleHeight(viewer)
        toggleArea(viewer)
    }
    function handleClearMeasure() {
        clearMeasure(viewer)
        clearHeight(viewer)
        clearArea(viewer)
    }
    function copyCoords() {
        const text = `${coords.lon}, ${coords.lat}, ${coords.height}`
        navigator.clipboard?.writeText(text)
    }

    // 关闭左下角取坐标面板（清空坐标，隐藏面板）
    function closeCoordsPanel() {
        coords.lon = null
        coords.lat = null
        coords.height = null
    }
    
    // ==================== 【3D 松树切换】 ====================
    function handleTogglePine() {
        togglePineMode(viewer)
    }

    //===================== 【页面挂载执行初始化】 =====================
    // onMounted：组件 DOM 挂载完成后执行，此时 #cesiumContainer 已存在
    onMounted(async () => {
        await init();
        viewer = getViewer();
        startFpsCounter();
        // await loadGeoSceneOnlineLayer(viewer);
        const stats = await loadDiseasedTreesPoints(viewer);
        treeStore.treesCount = stats.treesCount;
        treeStore.monthlyNewCount = stats.monthlyNewCount
        treeStore.recentRecords = stats.recentRecords
        // await loadOutbreakPolygon(viewer)
        await loadGradeStats()
        // ===== 交互事件 =====
        handleLeftClickEvent(viewer)
        setupDoubleClickToFly(viewer)
        generateMergedBuffer(viewer)
        highLightTree(viewer)
        // ===== 行政区划初始化 =====
        await adminStore.fetchProvinces()
        await loadProvincesLayer(viewer)
        setupProvinceInteraction(viewer)
        // ===== 时空趋势分析初始化 =====
        await spatioStore.fetchNationalMonthlyStats()
        // ===== 注册恢复回调 =====
        setRestoreCallback(() => {
            handleLeftClickEvent(viewer)
            setupDoubleClickToFly(viewer)
            highLightTree(viewer)
            setupProvinceInteraction(viewer)
        })
        setRouteRestoreCallback(() => {
            handleLeftClickEvent(viewer)
            setupDoubleClickToFly(viewer)
            generateMergedBuffer(viewer)
            highLightTree(viewer)
            setupProvinceInteraction(viewer)
        })
        setMeasureRestoreCallback(() => {
            handleLeftClickEvent(viewer)
            setupDoubleClickToFly(viewer)
            generateMergedBuffer(viewer)
            highLightTree(viewer)
            setupProvinceInteraction(viewer)
        })
        setHeightRestoreCallback(() => {
            handleLeftClickEvent(viewer)
            setupDoubleClickToFly(viewer)
            generateMergedBuffer(viewer)
            highLightTree(viewer)
            setupProvinceInteraction(viewer)
        })
        setAreaRestoreCallback(() => {
            handleLeftClickEvent(viewer)
            setupDoubleClickToFly(viewer)
            generateMergedBuffer(viewer)
            highLightTree(viewer)
            setupProvinceInteraction(viewer)
        })
    })

    // ===== 时空趋势分析：区域联动 =====
    // 当用户钻取省/市或返回全国时，重新加载该区域的月度数据
    watch( 
        () => ({
            level:adminStore.viewLevel,
            province:adminStore.currentProvince,
            city:adminStore.currentCity,
        }),
        async (current) => {
            // 防御：页面初始化时也会触发一次（值从初始态变成实际态），此时数据已由 onMounted 加载
            // 用标志位跳过首次触发（可选优化，可以删掉）
            if(current.level === 'city' && current.city) {
                // 市级视图 → 加载该市月度数据
                await spatioStore.fetchRegionalMonthlyStats(
                    current.city.gbCode,
                    'city',
                    current.city.name
                )
            } else if (current.level === 'province' && current.province) {
                // 省级视图 → 加载该省月度数据
                await spatioStore.fetchRegionalMonthlyStats(
                    current.province.gbCode,
                    'province',
                    current.province.name
                )
            } else if (current.level === 'national') {
                // 返回全国 → 恢复全国数据（如果之前缓存了就不用重新请求）
                await spatioStore.fetchNationalMonthlyStats()
            }
        },
        { deep: true }
    )

    // ===== 页面卸载时销毁 Cesium Viewer，防止再次进入时复用旧实例（绿屏） =====
    onUnmounted(() => {
        restorePickInteractions(viewer)
        clearCameraFollow(viewer)
        clearDrone(viewer)
        unloadPineEntities(viewer)
        clearMeasure(viewer)
        clearHeight(viewer)
        clearArea(viewer)
        destroyViewer()
    })

    // ===== 监听病害等级筛选变化（watch：响应式值变化时自动执行副作用） =====
    watch( 
        () => treeStore.selectedGrade,
        () => {
            if(!isPrimitiveMode.value) {
                applyAllFilters()
            } else {
                applyGradeFilter(treeStore.selectedGrade)
            }
            // 3D 松树模式下的等级过滤
            applyPineGradeFilter(treeStore.selectedGrade)
        }
    )
    // ===== 时空趋势分析：时间过滤联动 =====
    // 当用户拖拽滑块或点击图表月份时，selectedMonthEnd 变化 → 重新过滤地图上的病树
    watch(
        () => spatioStore.selectedMonthEnd,
        () => {
            if (!isPrimitiveMode.value) {
                applyAllFilters()
            }
        }
    )
    function handleModeSwitch(viewer) {
        switchToMixedMode(viewer)
        applyCurrentFilter()
    }
</script>

<style scoped>
    :root {
        --bg-dark: #73ccf3;
        --panel-bg: rgba(132, 177, 244, 0.85);
        --border-glow: #00d4ff;
        --text-main: #e8f0fe;
        --text-accent: #4dd9ff;
        --header-height: 60px;
        --footer-height: 40px;
    }

    .dashboard-container {
        width: 100vw;
        height: 100vh;
        background: radial-gradient(ellipse at center, #108b5a 0%, #0d8a54 100%);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Microsoft YaHei', sans-serif;
        color: var(--text-main);
    }

    .main-content {
        flex: 1;
        display: flex;
        position: relative;
        overflow: hidden;
    }

    .center-map {
        flex: 1;
        position: relative;
    }

    #cesiumContainer {
        width: 100%;
        height: 100%;
    }

    .mode-switch-btn {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        padding: 6px 18px;
        background: rgba(0, 212, 255, 0.2);
        border: 1px solid #00d4ff;
        color: #4dd9ff;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
    }

    .mode-switch-btn:hover {
        background: rgba(0, 212, 255, 0.4);
    }
    .mode-switch-btn--left { 
        left: 10px; transform: none; 
    }
    .mode-switch-btn--right { 
        left: auto; right: 10px; transform: none; 
    }

    .coords-panel {
        position: relative;
        z-index: 20;
        background: rgba(10, 40, 60, 0.9);
        border: 1px solid #00d4ff;
        color: #e8f0fe;
        font-family: Consolas, 'Courier New', monospace;
        font-size: 12px;
        line-height: 1.6;
        padding: 6px 10px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }

    .coords-copy {
        margin-top: 2px;
        padding: 2px 12px;
        background: rgba(0, 212, 255, 0.2);
        border: 1px solid #00d4ff;
        color: #4dd9ff;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
    }

    .coords-copy:hover {
        background: rgba(0, 212, 255, 0.4);
    }

    .coords-close {
        position: absolute;
        top: 2px;
        right: 2px;
        padding: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 6px;
        line-height: 1;
        opacity: 0.85;
    }
    .coords-close:hover {
        opacity: 1;
    }

    .map-tools-bottom-left {
        position: absolute;
        left: 8px;
        bottom: 8px;
        z-index: 60;
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: flex-start;
    }

    .tool-btn {
        width: 40px;
        height: 40px;
        font-size: 20px;
        line-height: 1;
        background: rgba(0, 212, 255, 0.2);
        border: 1px solid #00d4ff;
        color: #4dd9ff;
        border-radius: 4px;
        cursor: pointer;
    }
    .tool-btn:hover { background: rgba(0, 212, 255, 0.4); }

    .measure-result-panel {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 60;
        background: rgba(10, 40, 60, 0.9);
        border: 1px solid #00d4ff;
        color: #e8f0fe;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        min-width: 320px;
    }
    .measure-result-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        border-bottom: 1px solid rgba(0, 212, 255, 0.3);
        font-size: 13px;
    }
    .measure-result-close {
        background: transparent;
        border: none;
        color: #e8f0fe;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
    }
    .measure-result-body {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        padding: 8px 10px;
        font-size: 12px;
        font-family: Consolas, 'Courier New', monospace;
    }

    :deep(.cesium-viewer-bottom) {
        display: none !important;
    }
</style>
