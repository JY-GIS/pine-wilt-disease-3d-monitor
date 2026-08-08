/**
 * 行政区划病树疫情 — 状态管理
 *
 * 【职责】
 *   - 存储所有省的统计数据（含 GeoJSON）
 *   - 追踪当前选中省 / 视图层级
 *   - 管理区域筛选用的病树 ID 集合
 *
 * 【不负责】
 *   - Cesium 图元操作（交给 useAdminDivision.js）
 *   - 病树基础统计（treeStore 管）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useTreeStore } from './treeStore.js'
import { API } from '../config/api.config.js'

export const useAdminDivisionStore = defineStore('adminDivision', () => {
    // ==================== 状态 ====================
    const provinces = ref([]) // 所有省的统计数据（接口 /provinces 的返回）
    const cities = ref([])
    const currentProvince = ref(null)
    const currentCity = ref(null)
    // 当前视图层级：'national' | 'province' | 'city'
    const viewLevel = ref('national')
    const visibleTreeIds = ref(null)
    const isLoading = ref(false)

    // ==================== 计算属性 ====================
    /**
     * 当前面板应显示的等级分布数据
     *
     * 全国视图 → 用 treeStore 的全局 gradeCounts（所有病树）
     * 省级视图 → 用当前省的 gradeCounts（该省内病树）
     *
     * 返回值形如 { 1: 200, 2: 80, 3: 50, 4: 30, 5: 7 }
     */
    const displayGradeCounts = computed(() => {
        if (viewLevel.value === 'city' && currentCity.value) {
            const c = currentCity.value
            return {
                1: c.grade1 || 0,
                2: c.grade2 || 0,
                3: c.grade3 || 0,
                4: c.grade4 || 0,
                5: c.grade5 || 0,
            }
        }
        if (viewLevel.value === 'province' && currentProvince.value) {
            const p = currentProvince.value
            return {
                1: p.grade1 || 0,
                2: p.grade2 || 0,
                3: p.grade3 || 0,
                4: p.grade4 || 0,
                5: p.grade5 || 0,
            }
        }
        // 全国视图：读 treeStore 的全局数据
        const treeStore = useTreeStore()
        return treeStore.gradeCounts
    })
    /**
     * 当前面板应显示的病树总数
     */
    const displayTreeCount = computed(() => {
        if (viewLevel.value === 'city' && currentCity.value) {
            return currentCity.value.treeCount || 0
        }
        if (viewLevel.value === 'province' && currentProvince.value) {
            return currentProvince.value.treeCount || 0
        }
        const treeStore = useTreeStore()
        return treeStore.treesCount
    })
    /**
     * 当前面板应显示的标题文字
     */
    const displayTitle = computed(() => {
        if (viewLevel.value === 'city' && currentCity.value) {
            return currentCity.value.name + '病树数量'
        }
        if (viewLevel.value === 'province' && currentProvince.value) {
            return currentProvince.value.name + '病树数量'
        }
        return '全国病树总数'
    })

    // ==================== 操作 ====================
    /**
     * 页面初始化：拉取全部省级统计数据
     *
     * 调用时机：App.vue onMounted 中
     */
    async function fetchProvinces() {
        isLoading.value = true
        try {
            const response = await fetch(API.adminDivision.provinces, {
                method: 'GET',
                headers: API.getHeaders(),
            })
            const result = await response.json()
            if (result.code === 1) {
                provinces.value = result.data
            } else {
                console.error('Failed to fetch provinces:', result.message)
            }
        } catch (error) {
            console.error('Error fetching provinces:', error)
        } finally {
            isLoading.value = false
        }
    }
    /**
     * 点击某个省 → 进入省级视图
     *
     * @param {Object} province - provinces 数组中的某个元素
     */
    async function selectProvince(province) {
        currentProvince.value = province
        viewLevel.value = 'province'
        isLoading.value = true
        try {
            // 改为拉取城市列表，而非病树 ID 列表
            const response = await fetch(
                API.adminDivision.citiesByProvince(province.gbCode), {
                method: 'GET',
                headers: API.getHeaders(),
            })
            const result = await response.json()
            if (result.code === 1) {
                cities.value = result.data || []
                console.log('城市列表加载完成, 数量:', cities.value.length)
            } else {
                console.error('Failed to fetch cities:', result.message)
                cities.value = []
            }
        } catch (error) {
            console.error('Error fetching cities:', error)
            cities.value = []
        } finally {
            isLoading.value = false
        }
    }
    /**
     * 点击某个市 → 进入市级视野
     *
     * 流程：存 currentCity → viewLevel='city' → 拉取该市病树 ID → visibleTreeIds = Set
     * 病树的显示/隐藏由 useAdminDivision.js 的 applyAllFilters 负责
     *
     * @param {Object} city - cities 数组中的某个元素（包含 name/gbCode/treeCount/grade1~5/geojson/boundary）
     */
    async function selectCity(city) {
        currentCity.value = city
        viewLevel.value = 'city'
        isLoading.value = true
        try {
            const response = await fetch(
                API.adminDivision.treeIdsByCity(city.gbCode), {
                method: 'GET',
                headers: API.getHeaders(),
            })
            const result = await response.json()
            if (result.code === 1) {
                visibleTreeIds.value = new Set(result.data || [])
                console.log('市级病树ID加载完成, 数量:', visibleTreeIds.value.size)
            } else {
                console.error('Failed to fetch tree IDs for city:', result.message)
                visibleTreeIds.value = new Set()
            }
        } catch (error) {
            console.error('Error fetching tree IDs for city:', error)
            visibleTreeIds.value = new Set()
        } finally {
            isLoading.value = false
        }
    }
    /**
     * 从市级视野返回省级视野
     */
    function backToProvince() {
        currentCity.value = null
        viewLevel.value = 'province'
        visibleTreeIds.value = null
        console.log('已返回省级视图')
    }
    /**
     * 返回全国视图
     */
    function backToNational() {
        currentProvince.value = null
        currentCity.value = null
        cities.value = []
        viewLevel.value = 'national'
        visibleTreeIds.value = null
        console.log('已返回全国视图')
    }
    /**
     * 根据 severity 返回颜色（纯工具函数，不依赖状态）
     *
     * @param {string} severity - 'none' | 'low' | 'moderate' | 'high'
     * @returns {string} CSS 颜色值
     */
    function getSeverityColor(severity) {
        const map = {
            none: 'rgb(214, 211, 211)',
            low: 'rgba(91, 244, 77, 1)',
            moderate: 'rgba(238, 103, 0, 1)',
            high: 'rgba(255, 0, 0, 1)',
        }
        return map[severity] || map.none
    }

    return {
        // 状态
        provinces,
        cities,
        currentProvince,
        currentCity,
        viewLevel,
        visibleTreeIds,
        isLoading,
        // 计算属性
        displayGradeCounts,
        displayTreeCount,
        displayTitle,
        // 操作
        fetchProvinces,
        selectProvince,
        selectCity,
        backToProvince,
        backToNational,
        getSeverityColor,
    }

})









