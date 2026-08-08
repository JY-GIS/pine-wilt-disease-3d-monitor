<template>
  <div class="grade-chart-wrap">
    <div ref="chartRef" class="grade-chart"></div>
    <div v-if="isEmpty" class="grade-chart-empty">暂无数据</div>
  </div>
</template>

<script setup>
    import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
    import * as echarts from 'echarts'
    import { storeToRefs } from 'pinia'
    import { useTreeStore } from '../../stores/treeStore.js'
    import { GRADE_COLORS } from '../../utils/treeStyle.js'

    // ==================== 状态 ====================
    const store = useTreeStore()
    const { gradeCounts,selectedGrade } = storeToRefs(store)
    const props = defineProps({
        overrideData: {
            type: Object,
            default: null,
        },
    })
    const effectiveCounts = computed(
        () => props.overrideData || gradeCounts.value || {}
    )
    const chartRef = ref(null)
    // Echarts 实例
    let chart = null
    // 容器尺寸观察器（面板折叠/展开时触发resize）
    let resizeObserver = null
    // 是否空数据
    const isEmpty = computed(() => {
        const counts = effectiveCounts.value || {}
        return Object.values(counts).every(count => count === 0)
    })

    // ==================== 构建图表数据 ====================
    function buildChartData() { 
        const total = Object.values(effectiveCounts.value).reduce(
            (sum, count) => sum + count,
            0
        )
        const data = []
        for(let g = 1; g <= 5; g++) {
            const count = effectiveCounts.value[g] || 0
            if(count > 0) {
                data.push({
                    value: count,
                    name: `${g}级`,
                    grade: g,
                    itemStyle: { color: GRADE_COLORS[g] }
                })
            }
        }
        return { data,total }
    }

    // ==================== 构建 option ====================
    function buildOption() { 
        const { data,total } = buildChartData()
        const active = selectedGrade.value
        const styleData = data.map((item) => ({
            ...item,
            itemStyle: {
                color:item.itemStyle.color,
                opacity: active === null || active === item.grade ? 1 : 0.25
            }, 
        }))
        return{
            title: {
                text:String(total),
                subtext:'病树总数',
                left: 'center',
                top: '38%',
                textStyle: {
                    color: '#4dd9ff',
                    fontSize: 22,
                    fontWeight: 'bold',
                },
                subtextStyle: {
                    color: 'rgba(232, 240, 254, 0.6)',
                    fontSize: 12,
                },
            },
            // 悬浮提示：等级 + 数量 + 占比
            tooltip: {
                trigger: 'item',
                formatter: (params) => {
                    const percent =
                        total > 0
                            ? ((params.value / total) * 100).toFixed(1)
                            : '0.0'
                    return `${params.name}:${params.value} 棵（${percent}%）`
                },
                backgroundColor: 'rgba(10, 25, 47, 0.9)',
                borderColor: 'rgba(0, 212, 255, 0.3)',
                textStyle: { color: '#e8f0fe', fontSize: 12 },
            },
            series: [
                {
                    type: 'pie',
                    // 空心环形图：内半径45%，外半径70%
                    radius: ['45%', '70%'],
                    center: ['50%', '50%'],
                    // 扇区之间留出深色缝隙，科技感
                    itemStyle: {
                        borderColor: '#0a1628',
                        borderWidth: 2,
                    },
                    // 默认不显示扇区文字，保持干净
                    label: { show: false },
                    // 悬浮高亮：扇区发光 + 显示名字
                    emphasis: {
                        label: {
                            show: true,
                            fontSize: 14,
                            fontWeight: 'bold',
                            color: '#ffffff',
                        },
                        itemStyle: {
                            shadowBlur: 10,
                            shadowColor: 'rgba(0, 212, 255, 0.5)',
                        },
                    },
                    data: styleData,
                },
            ],
        }
    }

    // ==================== 图表初始化 ====================
    function initChart() { 
        if(!chartRef.value) return
        chart = echarts.init(chartRef.value)
        chart.setOption(buildOption())
        chart.on('click', (params) => {
            if(params && params.data && params.data.grade !== undefined) {
                store.toggleGradeFilter(params.data.grade)
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
    watch([effectiveCounts, selectedGrade], () => {
        if (chart) {
            chart.setOption(buildOption(), true)
        }
    })
    // ==================== 生命周期 ====================
    onMounted(() => {
        // nextTick：确保 DOM 渲染完成后再初始化 ECharts
        nextTick(() => {
            initChart()
        })
    })
    onBeforeUnmount(() => {
        // 清理：断开观察器、移除监听、销毁实例，防止内存泄漏
        if (resizeObserver) resizeObserver.disconnect()
        window.removeEventListener('resize', onWindowResize)
        if (chart) {
            chart.dispose()
            chart = null
        }
    })

</script>

<style scoped>
    /* ===== 图表区域容器（与左面板 other 区块风格统一） ===== */
    .grade-chart-wrap {
        position: relative;
        padding: 10px;
        background: rgba(0, 212, 255, 0.05);
        border: 1px solid rgba(0, 212, 255, 0.2);
        border-radius: 4px;
    }
    .grade-chart {
        width: 100%;
        height: 220px;
    }
    /* ===== 空数据提示（绝对定位盖在图表上） ===== */
    .grade-chart-empty {
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
