<!--
  RegionInfoCard.vue
  职责：显示当前视图层级的病树统计信息
    - 全国视图：标题 + 全国病树总数
    - 省级视图：标题 + 省病树数量 + 严重程度 + 返回全国按钮
    - 市级视图：标题 + 市病树数量 + 严重程度 + 返回省级按钮
  数据来源：
    - useAdminDivisionStore（adminStore）
    - provide 注入的回调函数（App.vue 提供，因为需要 viewer）
-->

<template> 
  <div class="region-info-card">
    <div class="region-btn-row">
      <button 
        v-if="adminStore.viewLevel !== 'national'"
        class="back-btn"
        @click="handleBack"
      >
        ← {{ adminStore.viewLevel === 'city' ? '返回省级视野' : '返回全国视图' }}
      </button>
      <button 
        v-if="adminStore.viewLevel !== 'national'"
        class="toggle-admin-btn"
        @click="toggleAdminVisibility"
      >
        行政区显示：{{ showAdmin ? '是' : '否' }}
      </button>
    </div>
      <div class="region-title">{{ adminStore.displayTitle }}</div>
      <div class="region-count">{{ adminStore.displayTreeCount }} 棵</div>
    <div
      v-if="adminStore.viewLevel !== 'national' && currentRegion"
      class="severity-row"
    >
      <span class="severity-dot" :style="{ background: severityColor }"></span>
      <span class="severity-text">严重程度：{{ severityText }}</span>
    </div>
  </div>
</template>

<script setup>  
  import { computed , inject } from 'vue'
  import { useAdminDivisionStore } from '../../stores/adminDivisionStore.js'

  // ===== Store =====
  const adminStore = useAdminDivisionStore()
  // ===== 从 App.vue 注入的函数（内部需要 viewer，组件里拿不到） =====
  const backToNational = inject('backToNational')
  const backToProvince = inject('backToProvince') 
  const toggleAdminVisibility = inject('toggleAdminVisibility') 
  // ===== 点击返回按钮 → 根据 viewLevel 分发 =====
  function handleBack() {
    if (adminStore.viewLevel === 'city') {
      backToProvince()
    } else {
      backToNational()
    }
  }
  // ===== 当前区划（省或市，响应式） =====
  // 不再硬编码 currentProvince，而是根据 viewLevel 取不同对象
  const currentRegion = computed(() => {
    if (adminStore.viewLevel === 'city') {
      return adminStore.currentCity
    }
    return adminStore.currentProvince
  })
  // ===== 严重程度英文 → 中文文案 =====
  const SEVERITY_TEXT_MAP = { 
    'none': '无疫情',
    'low': '轻度',
    'moderate': '中度',
    'high': '重度'
  }
  const severityText = computed(() => {
    const s = currentRegion.value?.severity
    return SEVERITY_TEXT_MAP[s] || '未知'
  })
  const severityColor = computed(() => {
    const s = currentRegion.value?.severity
    return adminStore.getSeverityColor(s)
  })
</script>

<style scoped>
/* ===== 卡片容器：与面板其他区块风格统一 ===== */
.region-info-card {
  padding: 12px 16px;
  background: rgba(0, 212, 255, 0.06);
  border: 1px solid rgba(0, 212, 255, 0.15);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* ★ 新增：按钮行（返回 + 开关并排） */
.region-btn-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
/* ===== 返回按钮 ===== */
.back-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: #4dd9ff;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.25s;
}
.back-btn:hover {
  background: rgba(0, 212, 255, 0.3);
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
}
/* ★ 新增：行政区开关按钮 */
.toggle-admin-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: #ffa940;
  background: rgba(255, 169, 64, 0.1);
  border: 1px solid rgba(255, 169, 64, 0.3);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.25s;
  white-space: nowrap;
}
.toggle-admin-btn:hover {
  background: rgba(255, 169, 64, 0.3);
  box-shadow: 0 0 8px rgba(255, 169, 64, 0.3);
}
/* ===== 标题（全国病树总数 / 安徽省病树数量 / 合肥市病树数量） ===== */
.region-title {
  font-size: 13px;
  color: rgba(232, 240, 254, 0.7);
}
/* ===== 数量（大字突出显示） ===== */
.region-count {
  font-size: 26px;
  font-weight: bold;
  color: #4dd9ff;
  line-height: 1.2;
}
/* ===== 严重程度行 ===== */
.severity-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.severity-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
}
.severity-text {
  font-size: 13px;
  color: rgba(232, 240, 254, 0.8);
}
</style>