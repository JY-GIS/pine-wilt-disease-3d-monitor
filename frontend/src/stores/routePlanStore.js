/**
 * 路径规划状态管理
 *
 * 【职责】
 * - 管理路径选点模式、已选点位列表、规划结果
 * - 只存纯状态，不涉及 Cesium 图元操作
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useRoutePlanStore = defineStore('routePlan', () => {

    // ==================== 状态 ====================

    /** 是否处于路径选点模式（点击地图添加病树） */
    const isRoutePlanningMode = ref(false)

    /**
     * 用户已点选的病树列表
     * 每个元素：{ treeId, species, grade, lng, lat }
     */
    const selectedPoints = ref([])

    /** 后端返回的路径规划结果（RoutePlanResponse.data） */
    const planResult = ref(null)

    /** 是否展示规划结果面板 */
    const showPlanResult = ref(false)

    /** 是否正在请求后端 */
    const isLoading = ref(false)

    // ==================== 操作 ====================

    /**
     * 添加一个病树点到已选列表
     * @param {Object} point - { treeId, species, grade, lng, lat }
     * @returns {boolean} true=成功，false=已达上限50
     */
    function addPoint(point) {
        if (selectedPoints.value.length >= 50) {
            return false
        }
        // 去重
        const exists = selectedPoints.value.find(
            (p) => p.treeId === point.treeId
        )
        if (exists) return true
        selectedPoints.value.push(point)
        return true
    }

    /**
     * 从已选列表中移除一个病树点
     * @param {String} treeId
     */
    function removePoint(treeId) {
        selectedPoints.value = selectedPoints.value.filter(
            (p) => p.treeId !== treeId
        )
    }

    /** 清空所有已选点位 */
    function clearPoints() {
        selectedPoints.value = []
    }

    /**
     * 存储后端返回的规划结果
     * @param {Object} result
     */
    function setPlanResult(result) {
        planResult.value = result
        showPlanResult.value = true
    }

    /** 清除规划结果 */
    function clearPlanResult() {
        planResult.value = null
        showPlanResult.value = false
    }

    return {
        // 状态
        isRoutePlanningMode,
        selectedPoints,
        planResult,
        showPlanResult,
        isLoading,
        // 操作
        addPoint,
        removePoint,
        clearPoints,
        setPlanResult,
        clearPlanResult,
    }
})