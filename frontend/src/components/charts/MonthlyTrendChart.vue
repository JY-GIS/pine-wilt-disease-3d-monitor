<template>
    <div class="trend-chart-wrap">
        <div class="chart-header">
            <span class="chart-title">📊 月度病树趋势</span>
            <span class="chart-region">{{ store.currentRegionLabel }}</span>
        </div>
        <div ref="chartRef" class="trend-chart" ></div>
        <div v-if="isEmpty" class="trend-chart-empty">暂无数据</div>
    </div>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useSpatioTemporalStore } from '../../stores/spatioTemporalStore.js'
// ==================== 状态 ====================
const store = useSpatioTemporalStore()
const chartRef = ref(null)
let chart = null
let resizeObserver = null
const isEmpty = computed(() => {
    return !store.monthlyData || store.monthlyData.length === 0
})
// ==================== 构建 ECharts option ====================
function buildOption() { 
    const data = store.monthlyData
    const selectedIdx = store.selectedMonthIndex
    // X 轴：月份标签（"2026-06" → 截取 "06月" 显示更简洁）
    const months = data.map(item => {
        const parts = item.month.split('-')
        return parts[1] + '月'
    })
    const newCounts = data.map(item => item.newCount || 0)
    const cumulativeCounts = data.map(item => item.cumulativeCount || 0)
    // 柱状图颜色：选中的月份用高亮色，其他用默认色
    const barColors = data.map(( _ , index ) => {
        if(selectedIdx === index) {
            return '#ff8c00' // 橙色高亮
        }
        return 'rgba(0, 212, 255, 0.7)' // 默认青色
    })
    return {
        // 科技风深色背景
        backgroundColor: 'transparent',
        // 悬浮提示
        tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(10, 25, 47, 0.9)',
        borderColor: 'rgba(0, 212, 255, 0.3)',
        textStyle: { color: '#e8f0fe', fontSize: 12 },
        // 自定义提示格式：显示"新增"和"累计"
        formatter: (params) => {
            const month = params[0].axisValue
            let html = `<strong>${month}</strong><br/>`
            params.forEach(p => {
            html += `${p.marker} ${p.seriesName}: ${p.value} 棵<br/>`
            })
            return html
        },
        },
        // 图例
        legend: {
        data: ['新增数量', '累计数量'],
        bottom: 0,
        textStyle: { color: 'rgba(232, 240, 254, 0.7)', fontSize: 11 },
        itemWidth: 16,
        itemHeight: 8,
        },
        // X 轴
        xAxis: {
        type: 'category',
        data: months,
        axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
            color: 'rgba(232, 240, 254, 0.6)',
            fontSize: 10,
            rotate: data.length > 6 ? 30 : 0, // 月份多时倾斜防止重叠
        },
        },
        // Y 轴：左侧-新增，右侧-累计
        yAxis: [
        {
            type: 'value',
            name: '新增(棵)',
            nameTextStyle: { color: 'rgba(232, 240, 254, 0.5)', fontSize: 10 },
            splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.08)' } },
            axisLabel: { color: 'rgba(232, 240, 254, 0.5)', fontSize: 10 },
        },
        {
            type: 'value',
            name: '累计(棵)',
            nameTextStyle: { color: 'rgba(232, 240, 254, 0.5)', fontSize: 10 },
            splitLine: { show: false },
            axisLabel: { color: 'rgba(232, 240, 254, 0.5)', fontSize: 10 },
        },
        ],
        grid: {
        left: '8%',
        right: '8%',
        top: '10%',
        bottom: '14%',
        },
        series: [
        {
            name: '新增数量',
            type: 'bar',
            data: newCounts,
            // 逐柱设置颜色（选中高亮用）
            itemStyle: {
            color: (params) => barColors[params.dataIndex],
            borderRadius: [3, 3, 0, 0], // 柱顶圆角
            },
            // 悬浮时加发光效果
            emphasis: {
            itemStyle: {
                shadowBlur: 8,
                shadowColor: 'rgba(0, 212, 255, 0.5)',
            },
            },
            barMaxWidth: 30, // 柱子最大宽度，月份少时不至于太宽
        },
        {
            name: '累计数量',
            type: 'line',
            yAxisIndex: 1, // 使用右侧 Y 轴
            data: cumulativeCounts,
            lineStyle: {
            color: '#ff8c00', // 橙色折线
            width: 2,
            },
            itemStyle: {
            color: '#ff8c00',
            },
            symbol: 'circle',
            symbolSize: 6,
            // 折线平滑
            smooth: true,
        },
        ],
    }
}
// ==================== 图表初始化 ====================
function initChart() {
    if(!chartRef.value) return
    chart = echarts.init(chartRef.value) //echarts.init(dom)
    chart.setOption(buildOption())
    // 点击事件：选中/取消月份
    // 使用 getZr() 而不是 chart.on('click')，因为后者在点击空白处也会触发
    // 可能点到柱子之间的空白处,用getZr()可以拿到点击像素坐标,然后通过convertFromPixel反算
    chart.getZr().on('click', (params) => {
        // 获取点击位置的图表坐标
        const pointInPixel = [params.offsetX, params.offsetY]
        if(chart.containPixel('grid',pointInPixel)) {
            // pointInPixel = [150, 80]  ← 点击位置的像素坐标
            // containPixel 判断这个像素坐标是否在 grid（图表绘图区）内
            // 返回 true → 点到了图表里面
            // 返回 false → 点到了坐标轴外面（比如图例）
            const xIndex = chart.convertFromPixel({seriesIndex: 0},pointInPixel)[0]
            const index = Math.round(xIndex) // 取整
            if(index >= 0 && index < store.monthlyData.length){
                store.selectMonth(index)
            }
        }
    })
    setupResize()
}
// ==================== 尺寸自适应 ====================
function setupResize() { 
    resizeObserver = new ResizeObserver(() => {
        if(chart && chartRef.value && chartRef.value.clientWidth > 0) {
            chart.resize()
        } 
    })
    if(chartRef.value) {
        resizeObserver.observe(chartRef.value)
    }
    window.addEventListener('resize', onWindowResize)
}
function onWindowResize() {
    if(chart && chartRef.value && chartRef.value.clientWidth > 0) {
        chart.resize()
    }
}

// ==================== 响应式更新 ====================
// ★ 为什么用 watch 而不是 computed：
//   ECharts 不是响应式的，必须手动调用 chart.setOption() 更新。
//   watch 监听 store 数据变化后主动更新图表。
watch(
    () => [store.monthlyData,store.selectedMonthIndex], // ① 监听这两个值
    () => {                                             // ② 变了就执行这个回调
        if (chart) { 
            chart.setOption(buildOption(), true)        // ③ 重新画图
        }
    },
    { deep:true } // deep: true 因为 monthlyData 是数组，需深度监听
    //                     ④ 深度监听 --> "数组里的元素变了也能检测到"
)
// ==================== 生命周期（标准写法） ====================
onMounted(() => { 
    // onMounted执行时，<div ref="chartRef">这个DOM元素可能还没真正渲染到浏览器页面上
    //（Vue 把 DOM 更新放进了一个队列）
    nextTick(() => { //等 Vue 把这一批 DOM 更新全部完成之后，再执行我的代码
        initChart()
    })
})
onBeforeUnmount(() => {
    if(resizeObserver) resizeObserver.disconnect()
    window.removeEventListener('resize', onWindowResize)
    if(chart) {
        chart.dispose()
        chart = null
    }
})
</script>
<style scoped>
/* ===== 容器 ===== */
.trend-chart-wrap {
  position: relative;
  padding: 10px;
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.1);
  border-radius: 4px;
}
/* ===== 头部 ===== */
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.chart-title {
  font-size: 13px;
  color: #4dd9ff;
  font-weight: bold;
}
.chart-region {
  font-size: 11px;
  color: rgba(232, 240, 254, 0.5);
  padding: 2px 8px;
  background: rgba(0, 212, 255, 0.08);
  border-radius: 3px;
}
/* ===== 图表区域 ===== */
.trend-chart {
  width: 100%;
  height: 200px;
}
/* ===== 空数据提示 ===== */
.trend-chart-empty {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: rgba(232, 240, 254, 0.4);
  background: rgba(10, 25, 47, 0.6);
  border-radius: 4px;
}
</style>