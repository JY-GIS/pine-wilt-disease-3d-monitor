/**
 * 病树数据全局状态管理
 *
 * 【设计说明】
 * - 只存「多个组件共享」的状态
 * - Cesium 实例、图元引用不放在这里
 * - 纯状态操作放 actions，涉及 Cesium 的操作留在 hooks 中
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
    defineStore('仓库名', () => {
        写 ref、写 function
        return { 把要共享的暴露出去 }
    })
 */
export const useTreeStore = defineStore('tree', () => {
    // ==================== 病树统计 ====================
    const treesCount = ref(0)
    const monthlyNewCount = ref(0)
    const recentRecords = ref([])

    // ================== 显示指定感染等级 ==================
    const gradeCounts = ref({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
    const selectedGrade = ref(null)

    // ==================== 选中与删除 ====================
    const selectedEntity = ref(null)
    const showDeleteButton = ref(false)

    // ==================== 周边查询 ====================
    const centerTreeInfo = ref(null)
    const searchRadius = ref(500)
    const nearbyTrees = ref([])
    const showNearbyPanel = ref(false)

    // ==================== 多边形圈选 ====================
    const isDrawingMode = ref(false)
    const showPolygonPanel = ref(false)
    const polygonResults = ref([])
    const polygonGradeStats = ref({})

    // ==================== 缓冲区 ====================
    const bufferVisibleAll = ref(false)



    //***************************************************** 
    // ==================== 纯状态操作 ====================
    //***************************************************** 
    /** 关闭多边形圈选面板并清空结果 */
    function closePolygonPanel() {
        showPolygonPanel.value = false
        polygonResults.value = []
        polygonGradeStats.value = {}
    }

    /** 设置中心病树信息（供周边查询） */
    function setCenterTreeInfo(info) {
        centerTreeInfo.value = info
        showNearbyPanel.value = true
    }

    /** 清除周边查询结果 */
    function clearNearbyResults() {
        nearbyTrees.value = []
        showNearbyPanel.value = false
        centerTreeInfo.value = null
    }

    /** 写入等级统计 */
    function setGradeCounts(counts) {
        gradeCounts.value = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...counts }
        //展开运算符。作用是把counts对象里所有的"键值对"拆开、平铺进当前这个对象里
    }

    /** 单选切换等级按钮 */
    function toggleGradeFilter(grade) {
        selectedGrade.value = selectedGrade.value === grade ? null : grade
        // 再次点击 => 点击系统等级就取消筛选
    }

    /** 清除等级筛选 */
    function clearGradeFilter() {
        selectedGrade.value = null
    }

    return {
        // 状态
        treesCount,
        monthlyNewCount,
        recentRecords,
        selectedEntity,
        showDeleteButton,
        centerTreeInfo,
        searchRadius,
        nearbyTrees,
        showNearbyPanel,
        isDrawingMode,
        showPolygonPanel,
        polygonResults,
        polygonGradeStats,
        bufferVisibleAll,
        gradeCounts,
        selectedGrade,


        // 操作
        closePolygonPanel,
        setCenterTreeInfo,
        clearNearbyResults,
        setGradeCounts,
        toggleGradeFilter,
        clearGradeFilter,
    }
})