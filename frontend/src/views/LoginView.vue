<!--
  LoginView.vue
  职责：登录页 —— 用户名 + 密码 → POST /login → 存 token → 跳转大屏
  
  边界情况：
    - 登录失败：后端返回 code=0 → 显示红色错误提示
    - 网络错误：catch 到异常 → 显示"网络错误"
    - 无 token 直接访问 /：路由守卫会跳回这里（已处理）
    - 已有 token 访问 /login：不阻止（用户可能想换账号），但也可以直接跳走（可以删掉）
    - 空用户名/密码：前端校验，不发送请求
-->
<template>
    <div class="login-page"> 
        <!-- 背景装饰 -->
        <div class="login-bg"></div>
        <!-- 登录卡片 -->
        <div class="login-card">
            <!-- 顶部装饰条 -->
            <div class="login-header-deco"></div>
            <h1 class="login-title">松材线虫病疫情监测平台</h1>
            <p class="login-subtitle">Pine Wilt Disease Monitoring System</p>
            <!-- 错误提示 -->
            <div class="login-error" v-if="errorMsg">{{ errorMsg }}</div>
            <!-- 表单 -->
            <div class="login-form">
                <div class="input-group">
                    <label class="input-label">用户名</label>
                    <input
                        class="login-input"
                        v-model="username"
                        type="text"
                        placeholder="请输入用户名"
                        @keyup.enter="handleLogin"
                    />
                </div>
                <div class="input-group">
                    <label class="input-label">密码</label>
                    <input
                        class="login-input"
                        v-model="password"
                        type="password"
                        placeholder="请输入密码"
                        @keyup.enter="handleLogin"
                    />
                </div>
                <button
                    class="login-btn"
                    :disabled="loading"
                    @click="handleLogin"
                >
                    {{ loading ? '登录中...' : '登 录' }}
                </button>
            </div>
            <!-- 底部提示 -->
            <p class="login-tip">默认账号：调查员工号 = 密码</p>
        </div>
    </div>
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../config/api.config.js' 
import axios from 'axios'
// ===== 响应式状态 =====
const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)
// ===== router 实例（用于跳转） =====
const router = useRouter()
// ===== 登录逻辑 =====
async function handleLogin() {
    // ----- 前端校验：空值不发送请求 -----
    if(!username.value.trim() || !password.value.trim()) {
        errorMsg.value = '用户名或密码不能为空'
        return
    }
    // ----- 进入加载态 -----
    loading.value = true
    errorMsg.value = ''
    try {
        // 后端接收的是 "普通表单参数"）
        // 用 URLSearchParams 构建 application/x-www-form-urlencoded 格式
        const formData = new URLSearchParams()
        formData.append('username', username.value)
        formData.append('password', password.value)
        const response = await axios.post(API.login, formData,{
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
        const result = response.data
        if(result.code === 1 && result.data) {
            localStorage.setItem('token', result.data.token)
            localStorage.setItem('username', result.data.username || result.value)
            router.push('/')
        } else {
            errorMsg.value = result.msg || '用户名或密码错误'
        } 
    }catch (error) {
        console.error('登录请求失败:', error)
        errorMsg.value = '网络错误，请检查后端服务是否启动'
    } finally {
        loading.value = false
    }
}
</script>
<style scoped>
/* ===== 整页背景 ===== */
.login-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  background: url('/image/松林.png') center / cover no-repeat;
  justify-content: center;
  position: relative;
  overflow: hidden;
  font-family: 'Microsoft YaHei', sans-serif;
}
/* ===== 背景动态光晕（纯 CSS，可以删掉） ===== */
.login-bg {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle at 50% 50%, rgba(0, 212, 255, 0.06) 0%, transparent 60%);
  animation: bgPulse 6s ease-in-out infinite;
}
@keyframes bgPulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
/* ===== 登录卡片 ===== */
.login-card {
  position: absolute; 
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 420px;
  padding: 40px 36px 32px;
  background: rgba(10, 25, 47, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 6px;
  box-shadow: 0 0 40px rgba(0, 212, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/* 顶部装饰条 */
.login-header-deco {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, #00d4ff, transparent);
}
/* ===== 标题 ===== */
.login-title {
  font-size: 22px;
  font-weight: bold;
  color: #4dd9ff;
  text-align: center;
  letter-spacing: 3px;
  text-shadow: 0 0 12px rgba(77, 217, 255, 0.4);
  margin: 0;
}
.login-subtitle {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.4);
  text-align: center;
  letter-spacing: 1px;
  margin: -8px 0 0;
}
/* ===== 错误提示 ===== */
.login-error {
  padding: 10px 14px;
  background: rgba(255, 77, 79, 0.12);
  border: 1px solid rgba(255, 77, 79, 0.35);
  border-radius: 3px;
  color: #ff6b6b;
  font-size: 13px;
  text-align: center;
}
/* ===== 表单 ===== */
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.input-label {
  font-size: 13px;
  color: rgba(232, 240, 254, 0.7);
}
.login-input {
  padding: 10px 14px;
  font-size: 14px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 3px;
  color: #e8f0fe;
  outline: none;
  transition: border-color 0.25s;
}
.login-input::placeholder {
  color: rgba(232, 240, 254, 0.25);
}
.login-input:focus {
  border-color: #4dd9ff;
}
/* ===== 登录按钮 ===== */
.login-btn {
  padding: 11px 0;
  font-size: 15px;
  font-weight: bold;
  letter-spacing: 4px;
  background: rgba(0, 212, 255, 0.15);
  border: 1px solid #00d4ff;
  color: #4dd9ff;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.25s;
  margin-top: 6px;
}
.login-btn:hover:not(:disabled) {
  background: rgba(0, 212, 255, 0.3);
  box-shadow: 0 0 14px rgba(0, 212, 255, 0.3);
}
.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* ===== 底部提示 ===== */
.login-tip {
  font-size: 11px;
  color: rgba(232, 240, 254, 0.3);
  text-align: center;
  margin: 0;
}
</style>