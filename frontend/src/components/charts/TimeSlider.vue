<template>
    <div class="time-slider-wrap">
        <!-- 当前过滤状态文字 -->
        <div class="slider-label">
            <span class="label-text">
                {{ statusText }}
            </span>
            <button
                v-if="store.selectedMonthIndex !== null"
                class="clear-filter-btn"
                @click="store.clearMonthFilter"
            >
                清除
            </button>
        </div>
        <!-- 滑块（有数据时显示） -->
        <div v-if="store.monthlyData.length > 1" class="slider-row">
            <span class="slider-end">{{ store.monthlyData[0]?.month || '' }}</span>
            <input
                type="range"
                class="month-slider"
                :min="0"
                :max="store.maxSliderIndex"
                :value="store.selectedMonthIndex ?? store.maxSliderIndex"
                @input="onSliderInput"
            />
            <span class="slider-end">{{ store.monthlyData[store.maxSliderIndex]?.month || '' }}</span>
        </div>
        <!-- 无数据提示 -->
        <div v-else class="slider-empty">暂无月份数据</div>
    </div>
</template>
<script setup>
import { computed } from 'vue' 
import { useSpatioTemporalStore } from '../../stores/spatioTemporalStore';
const store = useSpatioTemporalStore()
/**
 * 滑块状态文字
 *   文字依赖 selectedMonthIndex 和 monthlyData 两个响应式值，
 *   用 computed 自动追踪依赖，任何一个变了文字自动更新
 */
const statusText = computed(() => {
    if(store.monthlyData.length === 0) return '暂无数据'
    if(store.selectedMonthIndex === null) return '显示全部月份'
    const month = store.monthlyData[store.selectedMonthIndex]?.month
    const cumulative = store.monthlyData[store.selectedMonthIndex]?.cumulativeCount
    return `截止 ${month} | 累计 ${cumulative || 0} 棵`
})
/**
 * 滑块输入事件
 * ★ 为什么绑定 @input 而不是 @change：
 *   @input 在拖拽过程中实时触发，@change 在松开鼠标后才触发
 *   这里需要拖拽时实时更新地图，所以用 @input
 */
function onSliderInput(e) {
    const index = parseInt(e.target.value)
    store.selectMonth(index)
}
</script>
<style scoped>
/* ===== 容器 ===== */
.time-slider-wrap {
  padding: 10px;
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.1);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* ===== 状态标签 ===== */
.slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.label-text {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.7);
}
.clear-filter-btn {
  padding: 2px 8px;
  font-size: 11px;
  color: #ff6b6b;
  background: rgba(255, 77, 79, 0.1);
  border: 1px solid rgba(255, 77, 79, 0.3);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
}
.clear-filter-btn:hover {
  background: rgba(255, 77, 79, 0.25);
}
/* ===== 滑块行 ===== */
.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slider-end {
  font-size: 10px;
  color: rgba(232, 240, 254, 0.4);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
}
/* ===== 原生 range 样式美化（仅改外观，功能不变） ===== */
.month-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(0, 212, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
/* 滑块轨道 */
.month-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
}
/* 滑块按钮 */
.month-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff8c00;
  border: 2px solid #fff;
  margin-top: -5px;
  cursor: pointer;
  box-shadow: 0 0 6px rgba(255, 140, 0, 0.5);
}
.month-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff8c00;
  border: 2px solid #fff;
  cursor: pointer;
}
/* 空数据 */
.slider-empty {
  font-size: 12px;
  color: rgba(232, 240, 254, 0.3);
  text-align: center;
  padding: 8px 0;
}
</style>