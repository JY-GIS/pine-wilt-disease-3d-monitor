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

    // ===== 无人机动画状态 =====
    const droneFlightResult = ref(null)
    /**
     * droneStatus 只允许这些值：
     * idle      未启动
     * loading   加载中
     * playing   飞行中
     * paused    已暂停
     * hidden    已隐藏
     *
     * 用字符串而不是多个布尔值，是因为这些状态互斥。
     */
    const droneStatus = ref('idle')
    const cameraFollowEnabled = ref(false)

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

    // ===== 无人机 ===== 
    function setDroneFlightResult(result) {
        droneFlightResult.value = result
    }
    function setDroneStatus(status) {
        droneStatus.value = status
    }
    function setCameraFollowEnabled(enabled) {
        cameraFollowEnabled.value = enabled
    }
    function clearDroneFlight() {
        droneFlightResult.value = null
        droneStatus.value = 'idle'
        cameraFollowEnabled.value = false
    }

    return {
        // 状态
        isRoutePlanningMode,
        selectedPoints,
        planResult,
        showPlanResult,
        isLoading,
        droneFlightResult,
        droneStatus,
        cameraFollowEnabled,
        // 操作
        setCameraFollowEnabled,
        addPoint,
        removePoint,
        clearPoints,
        setPlanResult,
        clearPlanResult,
        setDroneFlightResult,
        setDroneStatus,
        clearDroneFlight,
    }
})