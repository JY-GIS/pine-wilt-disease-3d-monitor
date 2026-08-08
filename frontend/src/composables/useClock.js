/**
 * 系统时钟 Hook
 * 每秒更新 formattedTime，组件卸载时自动清除定时器
 */
import { ref, onUnmounted } from 'vue'
// onUnmounted() 【Vue 生命周期 API】
//含义：组件销毁、页面关闭那一刻自动执行里面的代码

export function useClock() {
    const formattedTime = ref(new Date().toLocaleTimeString())

    const timer = setInterval(() => {
        formattedTime.value = new Date().toLocaleTimeString()
    }, 1000)

    onUnmounted(() => clearInterval(timer))

    return {
        formattedTime,
    }
}