<template>
  <aside class="panel panel-left" :class="{ collapsed: collapsed }">
    <!-- 折叠按钮 -->
    <button class="collapse-btn left-toggle" @click="toggleCollapse">
      {{ collapsed ? '»' : '«' }}
    </button>

    <!-- 面板内容（仅在未折叠时显示） -->
    <div v-show="!collapsed" class="panel-inner">
      <!-- 顶部装饰条 -->
      <div class="panel-header-deco"></div>
      <h3 class="panel-title">病树数据管理</h3>

      <!-- 统计卡片 -->
      <!-- <div class="stat-card">
        <span class="stat-label">病树总数</span>
        <span class="stat-value"> {{ treesCount }} </span>
      </div>
      <div class="stat-card">
        <span class="stat-label">本月新增</span>
        <span class="stat-value"> {{ monthlyNewCount }} </span>
      </div> -->
      <RegionInfoCard/>

      <div class="section-title">病害等级分布</div>
      <GradeDonutChart :overrideData="adminStore.displayGradeCounts"/>

      <!-- 数据列表占位 -->
      <div class="data-list-placeholder">
        <p>最近调查记录：</p>
        <ul>
          <li v-for="record in recentRecords" :key="record.treeId">
            {{ record.treeId }} {{ record.species }} {{ record.grade }}级 {{ record.surveyDate }}
          </li>
          <li v-if="recentRecords.length === 0">暂无数据...</li>
        </ul>
      </div>

      <div v-if="showNearbyPanel && !showPolygonPanel" class="nearby-area">
        <!-- *****======【】【】周边查询区【】【】======***** -->
        <div class="nearby-header">
          <span class="nearby-title">🔍 周边查询</span>
        </div>
        <!-- 中心树信息 -->
        <div class="nearby-center-info" v-if="centerTreeInfo">
          中心点病树: ID{{ centerTreeInfo.treeId }} | {{ centerTreeInfo.species }} | {{ centerTreeInfo.grade }}级
        </div> 
        <!-- 半径选择 -->
        <div class="nearby-radius-row">
          <button class="tech-btn radius-btn" 
                  :class="{ active:searchRadius === 1000 }"
                  @click="setRadiusAndSearch(1000)"> 
                  <!-- 为什么这里会用到searchNearbyTrees() -->
            1000米
          </button>
          <button class="tech-btn radius-btn" 
                  :class="{ active:searchRadius === 5000 }"
                  @click="setRadiusAndSearch(5000)"> 
                  <!-- 为什么这里会用到searchNearbyTrees() -->
            5000米
          </button>
          <!-- 下面这些input里面的语法我都不懂 -->
          <input class="radius-input"   
                 v-model.number="inputRadius"  
                 placeholder="请输入查询半径(米)"
                 @keyup.enter="setCustomRadiusAndSearch()" />
          <button class="tech-btn radius-btn" 
          @click="setCustomRadiusAndSearch()"> 查询</button>
        </div>

        <!-- 结果列表 -->
        <div class="nearby-results" v-if="nearbyTrees.length > 0">
          <p class="nearby-count">共 {{ nearbyTrees.length }} </p>
          <ul>
            <li v-for="tree in nearbyTrees" :key="tree.treeId" class="nearby-item">
              <div class="nearby-item">
                <span class="nearby-id">{{ tree.treeId }}</span>
                <span class="nearby-species">{{ tree.species }}</span>
                <span class="nearby-grade">{{ tree.grade }}级</span>
                <span class="nearby-dist">{{ parseFloat(tree.distance).toFixed(0) }}m</span>
              </div>
            </li>
          </ul>
        </div>
        <div class="nearby-result" v-else>
          <p class="nearby-empty">点击半径按钮查询周边病树</p>
        </div>
      </div>
      <!-- *****======【】【】多边形圈选结果区【】【】======***** -->
      <div v-if="showPolygonPanel" class="nearby-area">
        <div class="nearby-header">
          <span class="nearby-title">📐 多边形圈选结果</span>
          <button class="tech-btn" style="padding:2px 8px;font-size:11px"
          @click="closePolygonPanel">✕</button>
        </div>
        <!-- 等级分布 -->
        <div class="nearby-center-info">
          <div v-for="(count,grade) in polygonGradeStats" 
              :key="grade" style="display:inline-block;margin:10px;">
            {{ grade }} 级: {{ count }} 棵
          </div>
          <div v-if="Object.keys(polygonGradeStats).length === 0">无数据</div> 
        </div>
        <!-- 结果列表 -->
        <div class="nearby-results" v-if="polygonResults.length > 0"> 
          <p class="nearby-count"> 共 {{ polygonResults.length }} 棵 </p>
          <ul>
            <li v-for="tree in polygonResults" :key="tree.treeId" class="nearby-item">
              <span class="nearby-id">{{ tree.treeId }}</span>
              <span class="nearby-species">{{ tree.species }}</span>
              <span class="nearby-grade">{{ tree.grade }}级</span>
            </li>
          </ul>
        </div>
        <div class="nearby-results" v-else>
          <p class="nearby-empty">该区域内无病树</p>
        </div>
      </div>

      <!-- 删除操作区（原 showDeleteButton 逻辑在此整合） -->
      <div v-if="showDeleteButton" class="action-area">
        <p class="selected-info">已选: {{ centerTreeInfo?.treeId || selectedTreeId || '' }}</p>
        <button class="tech-btn danger-btn" @click="deleteTree">
            删除此树
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
  import { ref, inject } from 'vue'
  import { useTreeStore } from '../../stores/treeStore.js'
  import { storeToRefs } from 'pinia'
  import GradeDonutChart from '../charts/GradeDonutChart.vue'
  import RegionInfoCard from './RegionInfoCard.vue'
  import { useAdminDivisionStore } from '../../stores/adminDivisionStore.js'

  const store = useTreeStore()
  const adminStore = useAdminDivisionStore()

  // ===== 从 store 解构状态（保持响应式） =====
  // storeToRefs 把 store 里的 ref 变成普通 ref，模板中使用时变量名不变
  const {
    treesCount,
    monthlyNewCount,
    recentRecords,
    showDeleteButton,
    selectedTreeId,
    centerTreeInfo,
    nearbyTrees,
    showNearbyPanel,
    showPolygonPanel,
    polygonResults,
    polygonGradeStats,
  } = storeToRefs(store)

  // searchRadius 需要可写且用于模板中 v-model 和赋值
  const searchRadius = storeToRefs(store).searchRadius

  // ===== 局部状态 =====
  const collapsed = ref(false)
  const inputRadius = ref('2000')

  // ===== 从 inject 获取函数（仍需 viewer，无法放入 store） =====
  const deleteTree = inject('deleteTree')
  const searchNearbyTrees = inject('searchNearbyTrees')
  const closePolygonPanel = inject('closePolygonPanel')

  // ===== 局部方法：解决 store ref 在模板中赋值的兼容问题 =====
  function setRadiusAndSearch(radius) {
    store.searchRadius = radius
    searchNearbyTrees()
  }

  function setCustomRadiusAndSearch() {
    store.searchRadius = inputRadius.value
    searchNearbyTrees()
  }

  const toggleCollapse = () => {
    collapsed.value = !collapsed.value
  }
</script>

<style scoped>
/* ===== 公共变量 ===== */
:root {
  --bg-dark: #0a1628;
  --panel-bg: rgba(10, 25, 47, 0.85);
  --border-glow: #00d4ff;
  --text-main: #e8f0fe;
  --text-accent: #4dd9ff;
}

/* ===== 面板基础样式 ===== */
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
  width: 320px;
  height: calc(100vh - 60px - 40px); /* 减去 header + footer */
  overflow: hidden;
}

.panel-left {
  border-right: 1px solid rgba(0, 212, 255, 0.3);
}

.panel.collapsed {
  width: 0;
  padding: 0;
  border: none;
}

.panel-inner {
  width: 100%;
  padding: 20px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 装饰与标题 ===== */
.panel-header-deco {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--border-glow), transparent);
}

.panel-title {
  font-size: 18px;
  color: var(--text-accent);
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.15);
  margin-bottom: 4px;
  letter-spacing: 2px;
}
/* ===== 病害分布 ===== */
.section-title {
  font-size: 14px;
  color: var(--text-accent);
  font-weight: bold;
  margin-top: 4px;
}
/* ===== 统计卡片 ===== */
.stat-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(0, 212, 255, 0.06);
  border: 1px solid rgba(0, 212, 255, 0.15);
  border-radius: 4px;
}
.stat-label { font-size: 13px; color: rgba(232, 240, 254, 0.7); }
.stat-value { font-size: 22px; font-weight: bold; color: var(--text-accent); }

/* ===== 列表占位 ===== */
.data-list-placeholder {
  padding: 12px;
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.1);
  border-radius: 4px;
  font-size: 13px;
  color: rgba(232, 240, 254, 0.6);
}
.data-list-placeholder ul { padding-left: 13px; margin-top: 6px; }
.data-list-placeholder li { margin-bottom: 4px; }

/* ===== 操作区 ===== */
.action-area {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 212, 255, 0.15);
}
.selected-info {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.6);
  margin-bottom: 8px;
}

/* ===== 按钮样式 ===== */
.tech-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-glow);
  background: rgba(0, 212, 255, 0.1);
  color: var(--text-accent);
  font-size: 13px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.25s;
  letter-spacing: 1px;
}
.tech-btn:hover {
  background: rgba(0, 212, 255, 0.3);
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
}
.danger-btn {
  border-color: #ff4d4f;
  color: #ff4d4f;
  background: rgba(255, 77, 79, 0.1);
  width: 100%;
}
.danger-btn:hover {
  background: rgba(255, 77, 79, 0.3);
  box-shadow: 0 0 10px rgba(255, 77, 79, 0.3);
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
  transition: all 0.3s;
}
.collapse-btn:hover { background: rgba(0, 212, 255, 0.35); }
.left-toggle { right: -24px; border-left: none; border-radius: 0 4px 4px 0; }
/* ===== 周边查询区域 ===== */
.nearby-area {
  padding: 12px;
  background: rgba(0, 212, 255, 0.05);
  border: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nearby-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.nearby-title {
  font-size: 14px;
  color: var(--text-accent);
  font-weight: bold;
}
.nearby-center-info {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.8);
  padding: 4px 8px;
  background: rgba(0, 212, 255, 0.1);
  border-radius: 3px;
}
.nearby-radius-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.radius-btn {
  padding: 4px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.radius-btn.active {
  background: rgba(0, 212, 255, 0.35);
  color: #fff;
  font-weight: bold;
}
.radius-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 212, 255, 0.3);
  color: #fff;
  border-radius: 3px;
  outline: none;
}
.radius-input::placeholder {
  color: rgba(255,255,255,0.3);
}
.radius-input:focus {
  border-color: var(--border-glow);
}

.nearby-results {
  max-height: 200px;
  overflow-y: auto;
}
.nearby-count {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.6);
  margin-bottom: 4px;
}
.nearby-results ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.nearby-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 6px;
  font-size: 12px;
  color: rgba(232, 240, 254, 0.8);
  border-bottom: 1px solid rgba(0, 212, 255, 0.08);
}
.nearby-item:hover {
  background: rgba(0, 212, 255, 0.1);
}
.nearby-id { color: var(--text-accent); min-width: 40px; }
.nearby-species { flex: 1; text-align: center; }
.nearby-grade { min-width: 30px; text-align: center; }
.nearby-dist { color: #4dd9ff; min-width: 45px; text-align: right; }
.nearby-empty {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.4);
  text-align: center;
  padding: 16px 0;
}
</style>