<template>
  <header class="top-header">
    <div class="header-side header-left">系统时间: {{ formattedTime }}</div>
    <div class="header-title">松材线虫病疫情监测平台</div>
    <div class="header-side header-right">
      管理员: {{ username }}
      <span class="nav-links">
        <router-link to="/users" class="nav-link">用户管理</router-link>
        <router-link to="/diseased-trees" class="nav-link">病树管理</router-link>
        <span class="nav-link logout-link" @click="handleLogout">退出</span>
      </span>
    </div>
  </header>
</template>

<script setup>
import { ref } from 'vue'
import { useClock } from '../../composables/useClock.js'
import { useRouter } from 'vue-router'
const { formattedTime } = useClock()
const router = useRouter()
const username = ref(localStorage.getItem('username') || 'Admin')
// 退出登录：清除 token → 跳转登录页
function handleLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('username')
  router.push('/login')
}
</script>

<style scoped>
.top-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30px;
  background: linear-gradient(180deg, rgba(0, 212, 255, 0.15) 0%, transparent 100%);
  border-bottom: 1px solid rgba(0, 212, 255, 0.3);
  z-index: 100;
  flex-shrink: 0;
}
.header-title {
  font-size: 28px;
  font-weight: bold;
  letter-spacing: 6px;
  color: #4dd9ff;
  text-shadow: 0 0 15px rgba(77, 217, 255, 0.6);
}
.header-side {
  font-size: 14px;
  color: rgba(232, 240, 254, 0.7);
  min-width: 180px;
}
.header-right {
  text-align: right;
  display: flex;
  align-items: center;
  gap: 14px;
}
/* ===== 管理页导航链接 ===== */
.nav-links {
  display: flex;
  gap: 12px;
}
.nav-link {
  font-size: 13px;
  color: #4dd9ff;
  text-decoration: none;
  padding: 4px 10px;
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 3px;
  transition: all 0.25s;
}
.nav-link:hover {
  background: rgba(0, 212, 255, 0.2);
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
}
/* 退出按钮：红色调 */
.logout-link {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.3);
  cursor: pointer;
}
.logout-link:hover {
  background: rgba(255, 77, 79, 0.15);
  box-shadow: 0 0 8px rgba(255, 77, 79, 0.3);
}
</style>