/**
 * Vue Router 路由配置
 *
 * 路由表：
 *   /login          → LoginView（登录页，不需要 token）
 *   /               → MainView（3D 大屏，需要 token）
 *   /users          → UserManageView（用户管理，需要 token）
 *   /diseased-trees → DiseasedTreeManageView（病树管理，需要 token）
 *
 * 导航守卫：
 *   除 /login 外所有路由都需要 token，没有 token 自动跳转 /login
 */
import { createRouter, createWebHashHistory } from 'vue-router'
const routes = [
    {
        path: '/login',
        name: 'Login',
        // 动态 import：Vite 会把这个组件的代码单独打包，访问 /login 时才加载
        component: () => import('../views/LoginView.vue'),
        meta: { requiresAuth: false },
    },
    {
        path: '/',
        name: 'Dashboard',
        component: () => import('../views/MainView.vue'),
        meta: { requiresAuth: true },
    },
    {
        path: '/users',
        name: 'UserManage',
        component: () => import('../views/UserManageView.vue'),
        meta: { requiresAuth: true },
    },
    {
        path: '/diseased-trees',
        name: 'DiseasedTreeManage',
        component: () => import('../views/DiseasedTreeManageView.vue'),
        meta: { requiresAuth: true },
    },
]
const router = createRouter({
    // Hash 模式：URL 中带 #，如 http://localhost:5173/#/login
    // 为什么用 Hash 而不是 History：Vite 开发服务器对 History 模式需要额外配置 fallback，Hash 模式零配置、刷新不会 404
    history: createWebHashHistory(),
    routes,
})
// ===== 全局导航守卫 =====
router.beforeEach((to, from, next) => {
    const token = localStorage.getItem('token')
    // 目标路由需要登录 && 没有 token → 强制跳转登录页
    if (to.meta.requiresAuth && !token) {
        next('/login')
    } else {
        next()
    }
})
export default router




