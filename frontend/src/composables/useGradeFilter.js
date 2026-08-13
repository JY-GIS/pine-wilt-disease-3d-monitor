/**
 * 病害等级分布 Hook
 *
 * 职责：
 * 1. 调后端 /diseasedTrees/statistics 拉取各等级统计数量
 * 2. 根据 store.selectedGrade 对 Cesium 点位做显示/隐藏（Entity + Primitive 双模式）
 * 3. 筛选时清理"不符合筛选等级"的幽灵选中态
 *
 * 设计要点：
 * - 本文件不直接创建/移除任何图元，只修改已有图元的 show 属性
 * - 通过 treeState 拿到两套渲染的数据引用，谁存在就筛谁，无需感知当前模式
 */
import { useTreeStore } from '../stores/treeStore.js'
import { treeState } from './useDiseasedTrees.js'
import { API } from '../config/api.config.js'

// ==================== Hook 入口 ====================
export function useGradeFilter() {
    const store = useTreeStore()

    // ========== 读取Entity的等级 ==========
    function getEntityGrade(entity) {
        try {
            return entity.properties.grade.getValue()
        } catch (e) {
            return entity.properties.grade
        }
    }

    // ========== 从后端接口读取感染等级统计 ==========
    async function loadGradeStats() {
        try {
            const response = await fetch(API.statisticsByGrade, {
                method: 'GET',
                headers: API.getHeaders(),
                // POST	请求体（body），JSON 格式
            })
            const result = await response.json()
            if (result.code === 1 && result.data) {
                const counts = {}
                result.data.forEach((row) => {
                    counts[Number(row.grade)] = Number(row.numbers)
                })
                store.setGradeCounts(counts)
            } else {
                console.error('Failed to load grade statistics:', result.message)
            }
        } catch (error) {
            console.error('Failed to load grade statistics:', error)
        }
    }

    // ========== 删除病树后刷新统计 ==========
    function refreshGradeStats() {
        return loadGradeStats()
    }

    // ========== 根据等级筛选点位(Entity||Primitive) ==========
    function applyGradeFilter(grade) {
        // ----------- Entity 模式 -----------
        if (treeState.entities && treeState.entities.length > 0) {
            for (const entity of treeState.entities) {
                const entityGrade = getEntityGrade(entity)
                entity.show = (grade === null || entityGrade === grade)
                // entity.show：是 Cesium Entity 自带的显示开关，布尔值
            }
        }
        // ---------- Primitive 模式 ----------
        const collection = treeState.pointPrimitiveCollection
        if (collection) {
            for (const pt of collection.value) {
                const data = treeState.treeDataMap.get(pt.id)
                pt.show = (grade === null || data.grade === grade)
            }
        }
        clearInconsistentSelection(grade)
    }

    // ========== 按 store 当前状态筛选 ==========
    function applyCurrentFilter() {
        applyGradeFilter(store.selectedGrade)
    }

    // ========== 清理不符合筛选等级的选中态 ==========
    function clearInconsistentSelection(grade) {
        if (grade === null) return
        const selected = store.selectedTree
        if (!selected) return
        // ---------- 选中的是 Entity ----------
        if (selected.properties && selected.properties.treeId) {
            if (getEntityGrade(selected) !== grade) {
                if (selected.label) {
                    selected.label.show = false
                }
                store.selectedTreeId = null
                store.showDeleteButton = false
            }
            return
        }
        // ---------- 选中的是 Primitive ----------
        const data = treeState.treeDataMap.get(selected.id)
        if (data && data.grade !== grade) {
            if (treeState.sharedLabel) {
                treeState.sharedLabelEntity.show = false
            }
            store.selectedTreeId = null
            store.showDeleteButton = false
        }

    }
    return {
        loadGradeStats,
        refreshGradeStats,
        applyGradeFilter,
        applyCurrentFilter,
        clearInconsistentSelection,
    }






}


