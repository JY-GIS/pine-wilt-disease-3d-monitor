/**
 * Vue 应用入口
 *
 * 初始化顺序：
 *   1. createApp（Vue 实例）
 *   2. use(pinia)   → 全局状态管理
 *   3. use(router)  → 路由（新增）
 *   4. mount('#app')→ 挂载到 DOM
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'

const app = createApp(App)
// Pinia（状态管理）
app.use(createPinia())
// Vue Router（页面路由）
app.use(router)
app.mount('#app')