/**
 * 时空趋势分析 —— Pinia Store
 *
 * 【职责】
 *   - 存储月度统计数据（全国 / 省 / 市）
 *   - 管理当前选中的截止月份
 *   - 暴露"选中月末日期"供 applyAllFilters 使用
 *
 * 【不负责】
 *   - Cesium 图元操作（交给 useCentroidMigration.js）
 *   - ECharts 渲染（交给 MonthlyTrendChart.vue）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { API } from '../config/api.config.js'
import { useAdminDivisionStore } from './adminDivisionStore.js'
export const useSpatioTemporalStore = defineStore('spatioTemporal', () => {
    // ==================== 状态 ====================
    const monthlyData = ref([])
    const selectedMonthIndex = ref(null)
    const isLoading = ref(false)
    const currentRegionLabel = ref('全国')
    // =================== 计算属性 ===================
    /**
     * 选中月份的月末日期字符串
     *
     * 返回格式："2026-06-30"，供 applyAllFilters 做字符串比较。
     * 返回 null 表示不限制时间。
     */
    const selectedMonthEnd = computed(() => {
        if (selectedMonthIndex.value === null || monthlyData.value.length === 0) {
            return null
        }
        const monthStr = monthlyData.value[selectedMonthIndex.value]?.month
        if (!monthStr) return null
        const [year, month] = monthStr.split('-')
        const lastDay = new Date(Number(year), Number(month), 0).getDate()
        return `${year}-${month}-${String(lastDay).padStart(2, '0')}`
    })
    /**
     * 滑块最大值（对应 monthlyData 最后一个索引）
     */
    const maxSliderIndex = computed(() => {
        return Math.max(0, monthlyData.value.length - 1)
    })
    /**
     * 有重心坐标的月份数据（过滤掉 centerLng 为 null 的项）
     * 供重心迁移线使用
     */
    const centroidPoints = computed(() => {
        return monthlyData.value.filter(
            item => item.centerLng != null && item.centerLat != null
        )
    })
    // ==================== 操作 ====================
    /**
     * 加载全国月度数据
     * 调用时机：MainView onMounted，页面初始化
     */
    async function fetchNationalMonthlyStats() {
        isLoading.value = true
        try {
            const response = await fetch(API.spatiotemporal.monthlyStats, {
                method: 'GET',
                headers: API.getHeaders(),
            })
            const result = await response.json()
            if (result.code === 1) {
                monthlyData.value = result.data || []
                if (monthlyData.value.length > 0) {
                    selectedMonthIndex.value = monthlyData.value.length - 1
                }
                currentRegionLabel.value = '全国'
            } else {
                console.error('加载月度统计失败:', result.msg)
                monthlyData.value = []
            }
        } catch (error) {
            console.error('加载月度统计网络错误:', error)
            monthlyData.value = []
        } finally {
            isLoading.value = false
        }
    }
    /**
     * 加载省/市月度数据
     *   省/市视图也调后端而不是前端本地聚合：
     *   - 后端 SQL 聚合更快，且前端不需要维护本地聚合逻辑
     */
    async function fetchRegionalMonthlyStats(gbCode, level, label) {
        isLoading.value = true
        try {
            const response = await fetch(
                API.spatiotemporal.monthlyStatsByRegion(gbCode, level),
                {
                    method: 'GET',
                    headers: API.getHeaders(),
                }
            )
            const result = await response.json()
            if (result.code === 1) {
                monthlyData.value = result.data || []
                if (monthlyData.value.length > 0) {
                    selectedMonthIndex.value = monthlyData.value.length - 1
                }
                currentRegionLabel.value = label
            }
        } catch (error) {
            console.error('加载区域月度统计网络错误:', error)
            monthlyData.value = []
        } finally {
            isLoading.value = false
        }
    }
    /**
     * 用户选择月份（拖拽滑块或点击图表）
     */
    function selectMonth(index) {
        if (index === selectedMonthIndex.value) {
            selectedMonthIndex.value = null
        } else {
            selectedMonthIndex.value = index
        }
    }
    /**
     * 清除时间过滤
     */
    function clearMonthFilter() {
        selectedMonthIndex.value = null
    }
    /**
     * 重置到最新月份
     */
    function resetToLatest() {
        if (monthlyData.value.length > 0) {
            selectedMonthIndex.value = monthlyData.value.length - 1
        }
    }

    return {
        // 状态
        monthlyData,
        selectedMonthIndex,
        isLoading,
        currentRegionLabel,
        // 计算属性
        selectedMonthEnd,
        maxSliderIndex,
        centroidPoints,
        // 操作
        fetchNationalMonthlyStats,
        fetchRegionalMonthlyStats,
        selectMonth,
        clearMonthFilter,
        resetToLatest,
    }
})



