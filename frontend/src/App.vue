<!--
  App.vue
  职责：整个 SPA 的根组件，只负责 <router-view /> 路由出口
  
  为什么必须改：原来 App.vue 是 3D 大屏本身，
  引入路由后它变成页面容器，大屏内容搬到了 MainView.vue
  
  边界情况：
    - 初次访问无 token → 路由守卫自动跳 /login
    - 刷新页面 → token 保留在 localStorage → 守卫放行
-->
<template>
  <router-view />  <!-- 根据当前 URL 动态替换成匹配的路由组件 -->
</template>

<script setup>
// 根组件不需要任何逻辑，所有初始化在各页面组件各自的 onMounted 中完成
</script>

<style>
/* 全局重置（非 scoped，作用于所有页面） */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: 'Microsoft YaHei', sans-serif;
  background: #0a1628;
  color: #e8f0fe;
}
</style>