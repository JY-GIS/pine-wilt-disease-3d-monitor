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
                <button class="mode-switch-btn" @click="handleModeSwitch(viewer)">
                    {{ isPrimitiveMode ? '切换到 Entity 模式' : '切换到 Primitive 模式' }}
                </button>
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
    import { useSearchTree } from '../composables/useSearchTree.js'
    import { useGradeFilter } from '../composables/useGradeFilter.js' 
    import { useAdminDivision } from '../composables/useAdminDivision.js'
    import { useAdminDivisionStore } from '../stores/adminDivisionStore.js'

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
    })

    // ===== 页面卸载时销毁 Cesium Viewer，防止再次进入时复用旧实例（绿屏） =====
    onUnmounted(() => {
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

    :deep(.cesium-viewer-bottom) {
        display: none !important;
    }
</style>
