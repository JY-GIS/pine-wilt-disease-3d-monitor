<!--
  UserManageView.vue
  职责：用户管理页 —— 用户列表表格 + 添加/编辑/删除用户
  
  后端接口：
    GET    /users              → 查询所有用户
    DELETE /users?userId=xx    → 删除用户
    POST   /users              → 新增用户（body: { userId, username, phone }）
    PUT    /users/{userId}/username → 修改用户名（body: { username }）
    POST   /users/{userId}/phone    → 修改手机号（?phone=xxx）
  
  边界情况：
    - 空列表 → 显示"暂无数据"
    - 添加/编辑时 user ID 为空 → 前端拦截
    - 删除失败 → alert 提示 + 不刷新列表
    - 网络异常 → console.error + alert
    - 未登录访问 → 路由守卫自动跳转 /login
-->
<template>
  <div class="manage-page">
    <!-- ===== 顶部标题栏 ===== -->
    <header class="manage-header">
      <button class="back-btn" @click="goBack">← 返回大屏</button>
      <h1 class="manage-title">用户管理</h1>
      <div class="header-spacer"></div>
    </header>
    <!-- ===== 操作按钮区 ===== -->
    <div class="toolbar">
      <button class="tech-btn" @click="loadUsers">刷新列表</button>
      <button class="tech-btn primary-btn" @click="openAddDialog">+ 添加用户</button>
    </div>
    <!-- ===== 用户列表表格 ===== -->
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>用户ID</th>
            <th>用户名</th>
            <th>电话号码</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(user, index) in usersList" :key="user.userId">
            <td>{{ index + 1 }}</td>
            <td>{{ user.userId }}</td>
            <td>{{ user.username }}</td>
            <td>{{ user.phone }}</td>
            <td class="action-cell">
              <button class="tech-btn small-btn" @click="openEditDialog(user)">编辑</button>
              <button class="tech-btn danger-btn small-btn" @click="handleDelete(user.userId)">删除</button>
            </td>
          </tr>
          <!-- 空数据 -->
          <tr v-if="usersList.length === 0">
            <td colspan="5" class="empty-cell">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- ===== 加载状态 ===== -->
    <div v-if="loading" class="loading-mask">加载中...</div>
    <!-- ===== 添加用户弹窗 ===== -->
    <div v-if="showAddDialog" class="dialog-overlay" @click.self="closeAddDialog">
      <div class="dialog-card">
        <div class="dialog-header">
          <span>添加用户</span>
          <button class="dialog-close" @click="closeAddDialog">✕</button>
        </div>
        <div class="dialog-body">
          <div class="input-group">
            <label>用户ID</label>
            <input class="tech-input" v-model="addForm.userId" placeholder="请输入用户ID（工号）" />
          </div>
          <div class="input-group">
            <label>用户名</label>
            <input class="tech-input" v-model="addForm.username" placeholder="请输入用户名" />
          </div>
          <div class="input-group">
            <label>手机号</label>
            <input class="tech-input" v-model="addForm.phone" placeholder="请输入手机号" />
          </div>
          <div v-if="addError" class="error-text">{{ addError }}</div>
        </div>
        <div class="dialog-footer">
          <button class="tech-btn" @click="closeAddDialog">取消</button>
          <button class="tech-btn primary-btn" :disabled="addLoading" @click="handleAdd">
            {{ addLoading ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
    <!-- ===== 编辑用户弹窗 ===== -->
    <div v-if="showEditDialog" class="dialog-overlay" @click.self="closeEditDialog">
      <div class="dialog-card">
        <div class="dialog-header">
          <span>编辑用户 - {{ editForm.userId }}</span>
          <button class="dialog-close" @click="closeEditDialog">✕</button>
        </div>
        <div class="dialog-body">
          <div class="input-group">
            <label>用户名</label>
            <input class="tech-input" v-model="editForm.username" placeholder="请输入新用户名" />
          </div>
          <div class="input-group">
            <label>手机号</label>
            <input class="tech-input" v-model="editForm.phone" placeholder="请输入新手机号" />
          </div>
          <div v-if="editError" class="error-text">{{ editError }}</div>
        </div>
        <div class="dialog-footer">
          <button class="tech-btn" @click="closeEditDialog">取消</button>
          <button class="tech-btn primary-btn" :disabled="editLoading" @click="handleEdit">
            {{ editLoading ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup> 
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../config/api.config.js'
import axios from 'axios'
// ===== 路由实例 =====
const router = useRouter()
// ===== 状态 =====
const usersList = ref([])
const loading = ref(false)
// ===== 添加用户相关 =====
const showAddDialog = ref(false)
const addLoading = ref(false)
const addError = ref('')
const addForm = reactive({
    userId:'',
    username:'',
    phone:'',
})
// ===== 编辑用户相关 =====
const showEditDialog = ref(false)
const editLoading = ref(false)
const editError = ref('')
const editForm = reactive({
  userId: '',
  username: '',
  phone: '',
})
// ===== 加载用户列表 =====
async function loadUsers() {
  loading.value = true
  try {
    const response = await axios.get(API.users.list, {
      headers: API.getHeaders(),
    })
    const result = response.data
    if (result.code === 1) {
      usersList.value = result.data || []
    } else {
      alert(result.msg || '查询用户列表失败')
    }
  } catch (error) {
    console.error('查询用户列表失败:', error)
    alert('网络错误，请检查后端服务')
  } finally {
    loading.value = false
  }
}
// ===== 删除用户 =====
async function handleDelete(userId) {
  if (!confirm(`确定要删除用户 ${userId} 吗？`)) return
  try {
    const response = await axios.delete(API.users.delete(userId), {
      headers: API.getHeaders(),
    })
    const result = response.data
    if (result.code === 1) {
      alert('删除成功')
      await loadUsers() // 刷新列表
    } else {
      alert(result.msg || '删除失败')
    }
  } catch (error) {
    console.error('删除用户失败:', error)
    alert('删除失败，请检查网络')
  }
}
// ===== 添加用户：打开弹窗 =====
function openAddDialog() {
  addForm.userId = ''
  addForm.username = ''
  addForm.phone = ''
  addError.value = ''
  showAddDialog.value = true
}
// ===== 添加用户：关闭弹窗 =====
function closeAddDialog() {
  showAddDialog.value = false
}
// ===== 添加用户：提交 =====
async function handleAdd() {
  if (!addForm.userId.trim() || !addForm.username.trim()) {
    addError.value = '用户ID和用户名不能为空'
    return
  }
  addLoading.value = true
  addError.value = ''
  try {
    // POST /users，body 是 JSON
    const response = await axios.post(API.users.add, {
      userId: addForm.userId,
      username: addForm.username,
      phone: addForm.phone,
    }, {
      headers: API.getHeaders(),
    })
    const result = response.data
    if (result.code === 1) {
      alert('添加成功')
      closeAddDialog()
      await loadUsers()
    } else {
      addError.value = result.msg || '添加失败'
    }
  } catch (error) {
    console.error('添加用户失败:', error)
    addError.value = '网络错误，请重试'
  } finally {
    addLoading.value = false
  }
}
// ===== 编辑用户：打开弹窗 =====
function openEditDialog(user) {
  editForm.userId = user.userId
  editForm.username = user.username
  editForm.phone = user.phone || ''
  editError.value = ''
  showEditDialog.value = true
}
// ===== 编辑用户：关闭弹窗 =====
function closeEditDialog() {
  showEditDialog.value = false
}
// ===== 编辑用户：提交（两个接口） =====
async function handleEdit() {
  editLoading.value = true
  editError.value = ''
  try {
    // 1. 修改用户名（PUT）
    const respName = await axios.put(
      API.users.updateName(editForm.userId),
      { username: editForm.username },
      { headers: API.getHeaders() }
    )
    // 2. 修改手机号（POST，@RequestParam）
    //    使用 params 选项传 query string
    const respPhone = await axios.post(
      API.users.updatePhone(editForm.userId),
      null, // 没有 body
      {
        headers: API.getHeaders(),
        params: { phone: editForm.phone },
      }
    )
    if (respName.data.code === 1 && respPhone.data.code === 1) {
      alert('修改成功')
      closeEditDialog()
      await loadUsers()
    } else {
      editError.value = respName.data.msg || respPhone.data.msg || '修改失败'
    }
  } catch (error) {
    console.error('编辑用户失败:', error)
    editError.value = '网络错误，请重试'
  } finally {
    editLoading.value = false
  }
}
// ===== 返回大屏 =====
function goBack() {
  router.push('/')
}
</script>
// ===== 页面挂载时自动加载列表 =====
// onMounted：页面首次渲染完成后执行，这里用它来加载初始数据
import { onMounted } from 'vue'
onMounted(() => {
  loadUsers()
})
<style scoped>
/* ===== 页面容器（深色科技风背景） ===== */
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
/* 返回按钮 */
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
/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  gap: 12px;
  padding: 16px 30px;
  flex-shrink: 0;
}
/* ===== 表格容器 ===== */
.table-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 0 30px 30px;
}
/* 滚动条美化 */
.table-wrap::-webkit-scrollbar {
  width: 6px;
}
.table-wrap::-webkit-scrollbar-thumb {
  background: rgba(0, 212, 255, 0.3);
  border-radius: 3px;
}
/* ===== 数据表格 ===== */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: center;
  border-bottom: 1px solid rgba(0, 212, 255, 0.1);
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
  background: rgba(0, 212, 255, 0.05);
}
.action-cell {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.empty-cell {
  color: rgba(232, 240, 254, 0.35);
  padding: 40px 0;
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
/* ===== 科技风按钮通用 ===== */
.tech-btn {
  padding: 8px 18px;
  border: 1px solid rgba(0, 212, 255, 0.35);
  background: rgba(0, 212, 255, 0.08);
  color: #4dd9ff;
  font-size: 13px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.25s;
  letter-spacing: 1px;
  outline: none;
}
.tech-btn:hover:not(:disabled) {
  background: rgba(0, 212, 255, 0.22);
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.25);
}
.tech-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
/* ===== 弹窗遮罩 ===== */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
/* ===== 弹窗卡片 ===== */
.dialog-card {
  width: 400px;
  background: rgba(10, 25, 47, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 6px;
  box-shadow: 0 0 30px rgba(0, 212, 255, 0.12);
  display: flex;
  flex-direction: column;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.15);
  font-size: 16px;
  color: #4dd9ff;
  font-weight: bold;
  letter-spacing: 1px;
}
.dialog-close {
  background: none;
  border: none;
  color: #ff6b6b;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
.dialog-close:hover {
  color: #ff9999;
}
.dialog-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid rgba(0, 212, 255, 0.1);
}
/* ===== 表单输入框 ===== */
.input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.input-group label {
  font-size: 13px;
  color: rgba(232, 240, 254, 0.7);
}
.tech-input {
  padding: 9px 12px;
  font-size: 14px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 3px;
  color: #e8f0fe;
  outline: none;
  transition: border-color 0.25s;
}
.tech-input::placeholder {
  color: rgba(232, 240, 254, 0.25);
}
.tech-input:focus {
  border-color: #4dd9ff;
}
/* ===== 错误提示 ===== */
.error-text {
  padding: 8px 12px;
  background: rgba(255, 77, 79, 0.12);
  border: 1px solid rgba(255, 77, 79, 0.3);
  border-radius: 3px;
  color: #ff6b6b;
  font-size: 13px;
  text-align: center;
}
</style>








