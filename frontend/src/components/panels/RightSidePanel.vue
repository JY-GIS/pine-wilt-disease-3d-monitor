<template>
  <aside class="panel panel-right" :class="{ collapsed: collapsed }">
    <!-- 折叠按钮 -->
    <button class="collapse-btn right-toggle" @click="toggleCollapse">
      {{ collapsed ? '«' : '»' }}
    </button>

    <!-- 面板内容 -->
    <div v-show="!collapsed" class="panel-inner">
      <div class="panel-header-deco"></div>
      <h3 class="panel-title">疫区态势分析</h3>

      <!-- ===== 单树定位 ===== -->
      <div class="search-tree-area">
        <div class="search-tree-row">
          <input
            class="search-tree-input"
            v-model="searchTreeId"
            placeholder="输入病树编号，如 SC-20260630-1"
            @keyup.enter="handleSearchTree"
          />
          <button class="tech-btn search-tree-btn" @click="handleSearchTree">
            定位
          </button>
        </div>
      </div>

      <!-- 缓冲区控制按钮组 -->
      <div class="buffer-controls">
        <button class="tech-btn primary-btn full-width" 
                @click="toggleAllBuffered">
          {{bufferVisibleAll ? '隐藏三级病树缓冲区' : '显示三级病树缓冲区'}}
        </button>
        <div class="buffer-toggles">
          <button
            v-for="cfg in bufferConfigList"
            :key="cfg.key"
            class="tech-btn buffer-btn"
            :style="{ borderColor: cfg.btnColor,
                color: cfg.visibleRef.value ? '#fff' : cfg.btnColor }"
            :class="{ active: cfg.visibleRef.value }"
            @click="toggleSingleBuffer(cfg.key)"
          >
            {{ cfg.label.substring(0, 2) }}
          </button>
        </div>
      </div>

      <!-- ===== ★ 时空趋势分析 ===== -->
      <MonthlyTrendChart />
      <TimeSlider />

      <!-- ===== 重心图层显隐开关（飞线 / 扩散圆） ===== -->
      <div class="layer-toggle-row">
        <button class="tech-btn" @click="toggleFlyLines">
          {{ flyLinesVisible ? '不显示飞线' : '显示飞线' }}
        </button>
        <button class="tech-btn" @click="toggleRippleRing">
          {{ rippleRingVisible ? '不显示扩散圆' : '显示扩散圆' }}
        </button>
      </div>

      <div class="buffer-controls">
        <button class="tech-btn primary-btn full-width"
                :style="isDrawingMode ? 
                  'border-color:#ff4d4f;color:#ff4d4f;background:rgba(225,77,79,0.1)' :
                  'border-color:#4dd9ff;color:#4dd9ff;background:rgba(0,212,255,0.1)'"
                @click="toggleDrawingMode">
          {{ isDrawingMode ? '取消绘制' : '多边形圈选' }}
        </button>
      </div>
      <!-- ========== ★ 巡查路径规划（新增） ========== -->
      <div class="route-plan-area">
        <!-- 主按钮：规划调查路径（折叠/展开） -->
        <button class="tech-btn primary-btn full-width"
                @click="toggleRoutePanel">
          📍 规划调查路径
        </button>
        <!-- 展开后的选点与方案区域 -->
        <div v-if="showRoutePanel" class="route-plan-inner">
          <!-- ===== 选点方式切换 ===== -->
          <div class="route-mode-row">
            <button class="tech-btn route-mode-btn"
                    :class="{ active: isRoutePlanningMode }"
                    @click="handleToggleSelectMode">
              点击选择
            </button>
            <button class="tech-btn route-mode-btn disabled-btn" disabled>
              多边形框选
            </button>
          </div>
          <!-- ===== 已选点位列表 ===== -->
          <div class="route-selected-list">
            <div class="route-list-header">
              <span>已选点位</span>
              <span class="route-count">{{ selectedPoints.length }} / 50</span>
            </div>
            <!-- 列表内容 -->
            <div class="route-list-body" v-if="selectedPoints.length > 0">
              <div v-for="(pt, index) in selectedPoints"
                   :key="pt.treeId"
                   class="route-list-item">
                <span class="route-seq">{{ index + 1 }}</span>
                <span class="route-tree-id">{{ pt.treeId }}</span>
                <span class="route-tree-species">{{ pt.species }}</span>
                <button class="route-remove-btn"
                        @click="handleRemovePoint(pt.treeId)">✕</button>
              </div>
            </div>
            <div v-else class="route-list-empty">
              请在地图上点击病树点位
            </div>
            <!-- 清空按钮 -->
            <button v-if="selectedPoints.length > 0"
                    class="tech-btn route-clear-btn"
                    @click="handleClearPoints">
              清空选择
            </button>
          </div>
          <!-- ===== 方案结果（有结果时才显示） ===== -->
          <div v-if="planResult" class="route-result-area">
            <div class="route-result-row">
              <span>总距离：</span>
              <span class="route-result-value">
                {{ formatDistance(planResult.totalDistance) }}
              </span>
            </div>
            <div class="route-result-row">
              <span>途经点：</span>
              <span class="route-result-value">{{ planResult.pointCount }} 个</span>
            </div>
            <div class="route-result-row">
              <span>巡查顺序：</span>
              <span class="route-result-value route-order-text">
                {{ planResult.route.map(r => r.treeId.replace('SC-', '')).join(' → ') }}
              </span>
            </div>
            <button class="tech-btn danger-btn route-clear-btn"
                    @click="handleClearRoute">
              清除路线
            </button>
          </div>
          <!-- ===== 无人机动画控制 ===== -->
          <div v-if="planResult" class="drone-control-area">
            <div class="drone-status-row">
              无人机状态：{{ droneStatusText }}
            </div>

            <div class="drone-control-row">
              <button v-if="droneStatus === 'idle'"
                      class="tech-btn drone-btn"
                      @click="handleStartDrone">启动无人机</button>

              <button v-else-if="droneStatus === 'playing'"
                      class="tech-btn drone-btn"
                      @click="handlePauseDrone">暂停飞行</button>

              <button v-else-if="droneStatus === 'paused'"
                      class="tech-btn drone-btn"
                      @click="handleResumeDrone">继续飞行</button>

              <button v-if="droneStatus === 'hidden'"
                      class="tech-btn drone-btn"
                      @click="handleShowDrone">显示无人机</button>

              <button v-else-if="droneStatus !== 'idle'"
                      class="tech-btn drone-btn"
                      @click="handleHideDrone">隐藏无人机</button>
            </div>

            <div v-if="droneFlightResult" class="drone-meta">
              <span>航线距离：{{ formatDistance(droneFlightResult.totalDistance) }}</span>
              <span>飞行时长：{{ (droneFlightResult.droneFlight?.totalDurationSeconds || 0).toFixed(1) }} s</span>
            </div>
          </div>
          <!-- ===== 获取调查方案按钮（无结果时显示） ===== -->
          <button v-if="!planResult"
                  class="tech-btn primary-btn full-width"
                  :disabled="selectedPoints.length < 2 || isLoading"
                  @click="handleFetchPlan">
            {{ isLoading ? '计算中...' : '获取调查方案' }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
  import { ref, inject, computed } from 'vue'
  import { useTreeStore } from '../../stores/treeStore.js'
  import { storeToRefs } from 'pinia'
  import { bufferConfigList, bufferVisibleAll } from '../../composables/useBufferAnalysis.js'
  import {
    flyLinesVisible,
    rippleRingVisible,
    toggleFlyLines,
    toggleRippleRing,
  } from '../../composables/useCentroidMigration.js'
  import { useRoutePlanStore } from '../../stores/routePlanStore.js'
  import { useSpatioTemporalStore } from '../../stores/spatioTemporalStore.js'
  import MonthlyTrendChart from '../charts/MonthlyTrendChart.vue'
  import TimeSlider from '../charts/TimeSlider.vue'

  const routePlanStore = useRoutePlanStore()
  const store = useTreeStore()
  const { isDrawingMode } = storeToRefs(store)
  const { 
    isRoutePlanningMode,
    selectedPoints,
    planResult,
    isLoading,
  } = storeToRefs(routePlanStore)
  const {
    droneFlightResult,
    droneStatus,
  } = storeToRefs(routePlanStore)
  const spatioStore = useSpatioTemporalStore()

  // ===== 局部状态 =====
  const showRoutePanel = ref(false)
  const collapsed = ref(false)
  // ===== 单树查询 =====
  const searchTreeId = ref('')
  const searchTreeById = inject('searchTreeById')
  const handleSearchTree = () => {
      searchTreeById(searchTreeId.value)
  }

  // ===== 从 inject 获取函数（仍需 viewer） =====
  const toggleAllBuffered = inject('toggleAllBuffered')
  const toggleSingleBuffer = inject('toggleSingleBuffer')
  const toggleDrawingMode = inject('toggleDrawingMode')
  const toggleRoutePlanningMode = inject('toggleRoutePlanningMode')
  const fetchAndDraw = inject('fetchAndDraw')
  const clearRouteFromMap = inject('clearRouteFromMap')
  const startDrone = inject('startDrone')
  const pauseDrone = inject('pauseDrone')
  const resumeDrone = inject('resumeDrone')
  const hideDrone = inject('hideDrone')
  const showDrone = inject('showDrone')
  const clearDrone = inject('clearDrone')

  const toggleCollapse = () => {
    collapsed.value = !collapsed.value
  }

  // ===== 路径规划：折叠面板 =====
  const toggleRoutePanel = () => {
    showRoutePanel.value = !showRoutePanel.value
    // 折叠时退出选点模式并清空
    if (!showRoutePanel.value) {
      if (isRoutePlanningMode.value) {
        toggleRoutePlanningMode()
      }
    }
  }
  // ===== 路径规划：切换选点模式 =====
  const handleToggleSelectMode = () => {
    toggleRoutePlanningMode()
  }
  // ===== 路径规划：移除单个点 =====
  const handleRemovePoint = (treeId) => {
    routePlanStore.removePoint(treeId)
  }
  // ===== 路径规划：清空所有选点 =====
  const handleClearPoints = () => {
    routePlanStore.clearPoints()
    // 如果正在选点模式中，退出（清空后应该重新选）
    if (isRoutePlanningMode.value) {
      toggleRoutePlanningMode()
    }
  }
  // ===== 路径规划：获取调查方案 =====
  const handleFetchPlan = () => {
    fetchAndDraw()
  }
  // ===== 无人机状态文案 =====
  const droneStatusText = computed(() => {
    const textMap = {
      idle: '未启动',
      loading: '加载中',
      playing: '飞行中',
      paused: '已暂停',
      hidden: '已隐藏',
    }
    return textMap[droneStatus.value] || '未知'
  })
  // ===== 【新增】无人机按钮事件 =====
  const handleStartDrone = () => {
    startDrone()
  }
  const handlePauseDrone = () => {
    pauseDrone()
  }
  const handleResumeDrone = () => {
    resumeDrone()
  }
  const handleHideDrone = () => {
    hideDrone()
  }
  const handleShowDrone = () => {
    showDrone()
  }

  // ===== 清除路线时，同时清除无人机 =====
  const handleClearRoute = () => {
    routePlanStore.clearPlanResult()
    clearRouteFromMap()
    clearDrone()
  }

  // ===== 距离格式化（米） =====
  const formatDistance = (meters) => {
    if (!meters && meters !== 0) return '--'
    if (meters < 1000) {
      return Math.round(meters) + ' m'
    }
    return (meters / 1000).toFixed(2) + ' km'
  }

</script>

<style scoped>
/* ===== 全局 CSS 变量（深蓝科技风） ===== */
:root {
  --bg-dark: #0a1628;
  --panel-bg: rgba(10, 25, 47, 0.85);
  --border-glow: #00d4ff;
  --text-main: #e8f0fe;
  --text-accent: #4dd9ff;
  --header-height: 60px;
  --footer-height: 40px;
}

/* ===== 面板基础容器 ===== */
.panel {
  position: relative;
  background: var(--panel-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(0, 212, 255, 0.2);
  border-bottom: 1px solid rgba(0, 212, 255, 0.2);
  transition: width 0.35s ease, padding 0.35s ease;
  display: flex;
  flex-shrink: 0;
  width: 340px;
  height: calc(100vh - var(--header-height) - var(--footer-height));
  overflow: hidden;
}

.panel-right {
  border-left: 1px solid rgba(0, 212, 255, 0.3);
}

.panel.collapsed {
  width: 0;
  padding: 0;
  border: none;
  overflow: hidden;
}

.panel-inner {
  width: 100%;
  padding: 20px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 面板顶部装饰条 ===== */
.panel-header-deco {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--border-glow), transparent);
}

/* ===== 面板标题 ===== */
.panel-title {
  font-size: 18px;
  color: var(--text-accent);
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.15);
  margin-bottom: 4px;
  letter-spacing: 2px;
}

/* ===== 科技风按钮通用样式 ===== */
.tech-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-glow);
  background: rgba(0, 212, 255, 0.1);
  color: var(--text-accent);
  font-size: 13px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.25s cubic-bezier(0.17, 0.67, 0.88, 1.01);
  letter-spacing: 1px;
  outline: none;
}

/* ===== 重心图层显隐开关（飞线 / 扩散圆） ===== */
.layer-toggle-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.layer-toggle-row .tech-btn {
  flex: 1;
  font-size: 12px;
  padding: 7px 0;
}
.tech-btn:hover {
  background: rgba(0, 212, 255, 0.3);
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.4);
}
.tech-btn:active {
  transform: scale(0.98);
}

/* ===== 主按钮（蓝色） ===== */
.primary-btn {
  width: 100%;
  margin-bottom: 10px;
}
.full-width {
  width: 100%;
}

/* ===== 缓冲区专用按钮 ===== */
.buffer-btn {
  flex: 1;
  padding: 6px 4px;
  font-size: 12px;
  text-align: center;
  border-radius: 3px;
  border-width: 1px;
  min-width: 0;
}
.buffer-btn.active {
  background: rgba(0, 212, 255, 0.25);
  color: #fff !important;
  font-weight: bold;
}

/* ===== 图表占位区域 ===== */
.chart-placeholder {
  padding: 16px;
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.1);
  border-radius: 4px;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}
.chart-placeholder p {
  font-size: 13px;
  color: rgba(232, 240, 254, 0.6);
  margin-bottom: 12px;
}
.mock-chart-bar {
  flex: 1;
  background: repeating-linear-gradient(
    90deg,
    rgba(0, 212, 255, 0.2) 0px,
    rgba(0, 212, 255, 0.2) 18px,
    transparent 18px,
    transparent 28px
  );
  border-bottom: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 2px;
}
.mock-chart-line {
  flex: 1;
  background: linear-gradient(135deg, transparent 40%, rgba(0, 212, 255, 0.15) 40%, rgba(0, 212, 255, 0.15) 42%, transparent 42%);
  border-bottom: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 2px;
}

/* ===== 折叠按钮 ===== */
.collapse-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 60px;
  background: rgba(0, 212, 255, 0.15);
  border: 1px solid var(--border-glow);
  color: var(--text-accent);
  cursor: pointer;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.17, 0.67, 0.88, 1.01);
  font-weight: bold;
  user-select: none;
}
.collapse-btn:hover {
  background: rgba(0, 212, 255, 0.35);
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.5);
}
.right-toggle {
  left: -24px;
  border-right: none;
  border-radius: 4px 0 0 4px;
}

/* ===== 滚动条美化（仅面板内） ===== */
.panel-inner::-webkit-scrollbar {
  width: 6px;
}
.panel-inner::-webkit-scrollbar-track {
  background: transparent;
}
.panel-inner::-webkit-scrollbar-thumb {
  background: rgba(0, 212, 255, 0.3);
  border-radius: 3px;
}
.panel-inner::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 212, 255, 0.5);
}
/* ===== ★ 路径规划区域 ===== */
.route-plan-area {
  margin-top: 6px;
}
.route-plan-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  padding: 12px;
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.12);
  border-radius: 4px;
}
/* 选点方式行 */
.route-mode-row {
  display: flex;
  gap: 8px;
}
.route-mode-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  text-align: center;
}
.route-mode-btn.active {
  background: rgba(0, 212, 255, 0.3);
  color: #fff;
  font-weight: bold;
  border-color: #4dd9ff;
}
.disabled-btn {
  opacity: 0.4;
  cursor: not-allowed;
}
/* 已选列表 */
.route-selected-list {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(0, 212, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}
.route-list-header {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 12px;
  color: rgba(232, 240, 254, 0.6);
  border-bottom: 1px solid rgba(0, 212, 255, 0.1);
}
.route-count {
  color: var(--text-accent);
}
.route-list-body {
  max-height: 160px;
  overflow-y: auto;
}
.route-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  font-size: 12px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.05);
  color: rgba(232, 240, 254, 0.8);
}
.route-list-item:hover {
  background: rgba(0, 212, 255, 0.08);
}
.route-seq {
  color: var(--text-accent);
  font-weight: bold;
  min-width: 18px;
  text-align: center;
}
.route-tree-id {
  color: #4dd9ff;
  flex: 1;
  font-size: 11px;
}
.route-tree-species {
  color: rgba(232, 240, 254, 0.5);
  font-size: 10px;
}
.route-remove-btn {
  background: none;
  border: none;
  color: #ff4d4f;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 4px;
  line-height: 1;
}
.route-remove-btn:hover {
  color: #ff7875;
}
.route-list-empty {
  padding: 24px 10px;
  text-align: center;
  font-size: 12px;
  color: rgba(232, 240, 254, 0.3);
}
.route-clear-btn {
  width: 100%;
  padding: 6px 0;
  font-size: 11px;
  border-radius: 0;
  border-top: 1px solid rgba(0, 212, 255, 0.1);
}
/* 方案结果 */
.route-result-area {
  padding: 10px;
  background: rgba(0, 212, 255, 0.06);
  border: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.route-result-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(232, 240, 254, 0.7);
}
.route-result-value {
  color: #4dd9ff;
  font-weight: bold;
}
.route-order-text {
  font-size: 10px;
  max-width: 180px;
  text-align: right;
  word-break: break-all;
}
/* ===== 单树定位查询 ===== */
.search-tree-area {
  margin-bottom: 12px;
}
.search-tree-row {
  display: flex;
  gap: 6px;
}
.search-tree-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 212, 255, 0.3);
  color: #fff;
  border-radius: 3px;
  outline: none;
}
.search-tree-input::placeholder {
  color: rgba(255,255,255,0.3);
}
.search-tree-input:focus {
  border-color: var(--border-glow);
}
.search-tree-btn {
  padding: 6px 14px;
  font-size: 12px;
  white-space: nowrap;
}
/* ===== 【新增】无人机动画控制 ===== */
.drone-control-area {
  padding: 10px;
  background: rgba(0, 212, 255, 0.05);
  border: 1px solid rgba(0, 212, 255, 0.15);
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drone-status-row {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.75);
}

.drone-control-row {
  display: flex;
  gap: 8px;
}

.drone-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
}

.drone-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: rgba(232, 240, 254, 0.6);
}
</style>
