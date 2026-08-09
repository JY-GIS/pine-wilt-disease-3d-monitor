<!--
  DiseasedTreeManageView.vue
  职责：病树管理页 —— 属性筛选 + 空间搜索 + 病树列表 + 删除

  后端接口：
    GET  /diseasedTrees              → 属性筛选（species, grade, surveyId）
    GET  /diseasedTrees/search       → 空间搜索（longitude, latitude, radius）
    DELETE /diseasedTrees?treeId=xx  → 删除

  边界情况：
    - 空列表 → 显示"暂无数据"
    - 属性搜索无结果 → 空表格
    - 空间搜索无结果 → 空表格 + 距离列仍显示
    - 删除失败 → alert + 列表不变
    - 空间搜索未填坐标 → 前端拦截
    - 网络异常 → console.error + alert
-->
<template>
  <div class="manage-page">
    <!-- ===== 顶部标题栏 ===== -->
    <header class="manage-header">
      <button class="back-btn" @click="goBack">← 返回大屏</button>
      <h1 class="manage-title">病树管理</h1>
      <div class="header-spacer"></div>
    </header>

    <!-- ===== 搜索区域 ===== -->
    <div class="search-area">

      <!-- 空间搜索：经纬度 + 半径 -->
      <div class="search-block">
        <h3 class="search-label">空间搜索（附近病树）</h3>
        <div class="search-row">
          <div class="input-group">
            <label>经度</label>
            <input
              class="tech-input"
              v-model.number="searchForm.longitude"
              type="number"
              placeholder="如 118.03"
              step="any"
            />
          </div>
          <div class="input-group">
            <label>纬度</label>
            <input
              class="tech-input"
              v-model.number="searchForm.latitude"
              type="number"
              placeholder="如 30.12"
              step="any"
            />
          </div>
          <div class="input-group">
            <label>半径(米)</label>
            <input
              class="tech-input"
              v-model.number="searchForm.radius"
              type="number"
              placeholder="如 5000"
              step="any"
            />
          </div>
          <div class="btn-group">
            <button class="tech-btn primary-btn" @click="searchDiseasedTrees">搜索附近</button>
            <!-- reset + reload = 清空空间搜索 + 恢复全量列表 -->
            <button class="tech-btn" @click="clearSpatialSearch">清空</button>
          </div>
        </div>
      </div>

      <!-- 属性筛选 -->
      <div class="search-block">
        <h3 class="search-label">属性筛选</h3>
        <div class="search-row">
          <div class="input-group">
            <label>树编号</label>
            <input
              class="tech-input"
              v-model="searchForm.treeId"
              type="text"
              placeholder="如 SC-20240101-1"
            />
          </div>
          <div class="input-group">
            <label>调查员工号</label>
            <input
              class="tech-input"
              v-model="searchForm.surveyId"
              type="text"
              placeholder="调查人工号"
            />
          </div>
          <div class="input-group">
            <label>树种</label>
            <input
              class="tech-input"
              v-model="searchForm.species"
              type="text"
              placeholder="树种名称"
            />
          </div>
          <div class="input-group">
            <label>感染等级</label>
            <select class="tech-input tech-select" v-model="searchForm.grade">
              <option value="">全部</option>
              <option value="1">1级</option>
              <option value="2">2级</option>
              <option value="3">3级</option>
              <option value="4">4级</option>
              <option value="5">5级</option>
            </select>
          </div>
          <div class="btn-group">
            <button class="tech-btn primary-btn" @click="loadDiseasedTrees">查询</button>
            <button class="tech-btn" @click="clearAttrSearch">清空</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 数据表格 ===== -->
    <div class="table-wrap">
      <div class="table-info">
        <span>共 {{ diseasedTreesList.length }} 条记录</span>
        <!-- showDistance：空间搜索后为 true，显示"距离"列 -->
        <span v-if="showDistance" class="distance-tag">空间搜索结果</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>树编号</th>
            <th>调查员工号</th>
            <th>树种</th>
            <th>感染等级</th>
            <th>胸径(cm)</th>
            <th>经纬度</th>
            <!-- v-if 控制列显隐：空间搜索时显示距离列 -->
            <th v-if="showDistance">距离(米)</th>
            <th>调查日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(tree, index) in diseasedTreesList" :key="tree.treeId">
            <td>{{ index + 1 }}</td>
            <td>{{ tree.treeId }}</td>
            <td>{{ tree.surveyId }}</td>
            <td>{{ tree.species }}</td>
            <td>
              <span
                class="grade-badge"
                :style="{ background: getGradeColor(tree.grade) }"
              >
                {{ tree.grade }}级
              </span>
            </td>
            <td>{{ tree.chest }}</td>
            <td class="coord-cell">
              {{ tree.longitude?.toFixed?.(4) ?? tree.longitude }},
              {{ tree.latitude?.toFixed?.(4) ?? tree.latitude }}
            </td>
            <!-- 距离列：仅空间搜索时显示 -->
            <td v-if="showDistance">
              {{ tree.distance != null ? tree.distance.toFixed(1) : '-' }}
            </td>
            <td>{{ tree.surveyDate }}</td>
            <td>
              <button
                class="tech-btn danger-btn small-btn"
                @click="handleDelete(tree.treeId)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="diseasedTreesList.length === 0 && !loading">
            <td :colspan="showDistance ? 10 : 9" class="empty-cell">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-mask">加载中...</div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { API } from '../config/api.config.js'

// ===== 路由 =====
const router = useRouter()

// ===== 状态 =====
const loading = ref(false)
const diseasedTreesList = ref([])
// showDistance：控制距离列是否显示 + 标签文字
const showDistance = ref(false)

// ===== 搜索表单（用 reactive 包裹，整个重置时方便） =====
const searchForm = reactive({
  // 空间搜索
  longitude: '',
  latitude: '',
  radius: '',
  // 属性筛选
  treeId: '',
  surveyId: '',
  species: '',
  grade: '',
})

// ===== 属性筛选查询 =====
async function loadDiseasedTrees() {
showDistance.value = false
  loading.value = true
  try {
    if (searchForm.treeId && searchForm.treeId.trim()) {
      // 单树查询 —— 只有 treeId 有效，忽略其他筛选条件
      const response = await axios.get(
        API.searchTreeById(searchForm.treeId.trim()),
        { headers: API.getHeaders() }
      )
      const result = response.data
      if (result.code === 1) {
        // 这个接口返回的是数组（不是 PageResult），直接赋值
        diseasedTreesList.value = result.data || []
      } else {
        alert(result.msg || '查询失败')
      }
    } else {
      // 原有分页/筛选接口 —— 物种、等级、工号均有效
      const response = await axios.get(API.diseasedTrees.list, {
        params: {
          // treeId 已移除，其他三个字段原样传递
          species: searchForm.species || undefined,
          grade: searchForm.grade || undefined,
          surveyId: searchForm.surveyId || undefined,
        },
        headers: API.getHeaders(),
      })
      const result = response.data
      if (result.code === 1) {
        diseasedTreesList.value = result.data.rows || result.data || []
      } else {
        alert(result.msg || '查询失败')
      }
    }
  } catch (error) {
    console.error('查询病树失败:', error)
    alert('网络错误，请检查后端服务')
  } finally {
    loading.value = false
  }
}

// ===== 空间搜索（附近病树） =====
async function searchDiseasedTrees() {
  // 前端校验：坐标不能为空
  if (!searchForm.longitude || !searchForm.latitude || !searchForm.radius) {
    alert('请输入经度、纬度和搜索半径')
    return
  }
  showDistance.value = true // 空间搜索 → 显示距离列
  loading.value = true
  try {
    const response = await axios.get(
      API.nearbySearch(
        searchForm.longitude,
        searchForm.latitude,
        searchForm.radius
      ),
      {
        headers: API.getHeaders(),
      }
    )
    const result = response.data
    if (result.code === 1) {
      diseasedTreesList.value = result.data || []
    } else {
      alert(result.msg || '搜索失败')
    }
  } catch (error) {
    console.error('空间搜索失败:', error)
    alert('网络错误，请检查后端服务')
  } finally {
    loading.value = false
  }
}

// ===== 清空空间搜索表单 + 恢复全量列表 =====
function clearSpatialSearch() {
  searchForm.longitude = ''
  searchForm.latitude = ''
  searchForm.radius = ''
  loadDiseasedTrees()
}

// ===== 清空属性筛选表单 + 恢复全量列表 =====
function clearAttrSearch() {
  searchForm.treeId = ''
  searchForm.surveyId = ''
  searchForm.species = ''
  searchForm.grade = ''
  loadDiseasedTrees()
}

// ===== 删除病树 =====
async function handleDelete(treeId) {
  if (!confirm(`确定要删除病树 ${treeId} 吗？`)) return
  try {
    const response = await axios.delete(API.diseasedTrees.delete(treeId), {
      headers: API.getHeaders(),
    })
    const result = response.data
    if (result.code === 1) {
      alert('删除成功')
      // 重新加载当前列表（空间搜索结果或属性筛选结果）
      if (showDistance.value) {
        await searchDiseasedTrees()
      } else {
        await loadDiseasedTrees()
      }
    } else {
      alert(result.msg || '删除失败')
    }
  } catch (error) {
    console.error('删除病树失败:', error)
    alert('删除失败，请检查网络')
  }
}

// ===== 等级 → 颜色（和图例一致） =====
function getGradeColor(grade) {
  const map = {
    1: '#00ff00',
    2: '#ffff00',
    3: '#800080',
    4: '#ff0000',
    5: '#000000',
  }
  return map[grade] || '#666'
}

// ===== 返回大屏 =====
function goBack() {
  router.push('/')
}

// ===== 页面加载：拉取全量病树列表 =====
onMounted(() => {
  loadDiseasedTrees()
})
</script>

<style scoped>
/* ===== 页面容器 ===== */
.manage-page {
  width: 100vw;
  height: 100vh;
  background: radial-gradient(ellipse at center, #0a1628 0%, #050d1a 100%);
  display: flex;
  flex-direction: column;
  font-family: 'Microsoft YaHei', sans-serif;
  color: #e8f0fe;
  overflow: hidden;
}

/* ===== 顶部标题栏 ===== */
.manage-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30px;
  background: linear-gradient(180deg, rgba(0, 212, 255, 0.15) 0%, transparent 100%);
  border-bottom: 1px solid rgba(0, 212, 255, 0.3);
  flex-shrink: 0;
}
.manage-title {
  font-size: 24px;
  font-weight: bold;
  letter-spacing: 4px;
  color: #4dd9ff;
  text-shadow: 0 0 12px rgba(77, 217, 255, 0.4);
}
.header-spacer {
  min-width: 120px;
}

.back-btn {
  padding: 6px 16px;
  font-size: 13px;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid rgba(0, 212, 255, 0.3);
  color: #4dd9ff;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.25s;
}
.back-btn:hover {
  background: rgba(0, 212, 255, 0.25);
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
}

/* ===== 搜索区域 ===== */
.search-area {
  padding: 14px 30px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 212, 255, 0.1);
}
.search-block {
  padding: 12px 16px;
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.1);
  border-radius: 4px;
}
.search-label {
  font-size: 13px;
  color: #4dd9ff;
  margin-bottom: 10px;
  letter-spacing: 1px;
}
.search-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

/* ===== 表单输入 ===== */
.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.input-group label {
  font-size: 11px;
  color: rgba(232, 240, 254, 0.5);
}
.tech-input {
  padding: 7px 10px;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 3px;
  color: #e8f0fe;
  outline: none;
  transition: border-color 0.25s;
  width: 130px;
}
.tech-input::placeholder {
  color: rgba(232, 240, 254, 0.2);
}
.tech-input:focus {
  border-color: #4dd9ff;
}
/* select 下拉框 */
.tech-select {
  cursor: pointer;
  /* appearance: none 移除原生箭头（可以删掉，看个人喜好） */
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%234dd9ff'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 26px;
}
.tech-select option {
  background: #0a1628;
  color: #e8f0fe;
}

.btn-group {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding-bottom: 1px;
}

/* ===== 科技风按钮 ===== */
.tech-btn {
  padding: 7px 16px;
  border: 1px solid rgba(0, 212, 255, 0.35);
  background: rgba(0, 212, 255, 0.08);
  color: #4dd9ff;
  font-size: 13px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.25s;
  letter-spacing: 1px;
  outline: none;
  white-space: nowrap;
}
.tech-btn:hover:not(:disabled) {
  background: rgba(0, 212, 255, 0.22);
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.25);
}
.primary-btn {
  background: rgba(0, 212, 255, 0.16);
  border-color: #4dd9ff;
  color: #fff;
}
.danger-btn {
  border-color: rgba(255, 77, 79, 0.45);
  color: #ff6b6b;
  background: rgba(255, 77, 79, 0.08);
}
.danger-btn:hover:not(:disabled) {
  background: rgba(255, 77, 79, 0.2);
  box-shadow: 0 0 10px rgba(255, 77, 79, 0.3);
}
.small-btn {
  padding: 5px 12px;
  font-size: 12px;
}

/* ===== 表格容器 ===== */
.table-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 0 30px 30px;
}
.table-wrap::-webkit-scrollbar {
  width: 6px;
}
.table-wrap::-webkit-scrollbar-thumb {
  background: rgba(0, 212, 255, 0.3);
  border-radius: 3px;
}

.table-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  font-size: 13px;
  color: rgba(232, 240, 254, 0.5);
}
.distance-tag {
  padding: 3px 10px;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 3px;
  color: #4dd9ff;
  font-size: 11px;
}

/* ===== 数据表格 ===== */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th,
.data-table td {
  padding: 10px 10px;
  text-align: center;
  border-bottom: 1px solid rgba(0, 212, 255, 0.08);
}
.data-table th {
  background: rgba(0, 212, 255, 0.08);
  color: #4dd9ff;
  font-weight: bold;
  letter-spacing: 1px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.data-table tbody tr:hover {
  background: rgba(0, 212, 255, 0.04);
}
.coord-cell {
  font-size: 12px;
  font-family: 'Courier New', monospace;
  color: rgba(232, 240, 254, 0.6);
}
.empty-cell {
  color: rgba(232, 240, 254, 0.3);
  padding: 40px 0;
}

/* 等级徽章 */
.grade-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  color: #fff;
  text-shadow: 0 0 2px rgba(0,0,0,0.5);
}

/* ===== 加载遮罩 ===== */
.loading-mask {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(5, 13, 26, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #4dd9ff;
  z-index: 10;
}
</style>