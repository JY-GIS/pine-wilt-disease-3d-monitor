<template>
  <header class="top-header">
    <div class="header-side header-left">系统时间: {{ formattedTime }}</div>
    <div class="header-title">松材线虫病疫情监测平台</div>
    <div class="header-side header-right">管理员: Admin</div>
  </header>
</template>

<script setup>
import { useClock } from '../../composables/useClock.js'

const { formattedTime } = useClock()
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
}
</style>