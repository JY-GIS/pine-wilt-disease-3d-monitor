/**
 * 周边病树查询 Hook
 *
 * 职责：
 * 1. 调后端空间索引接口查询半径内的病树
 * 2. 高亮范围内病树
 * 3. 绘制中心点到各病树的连线
 * 4. 清除连线和高亮
 */
import { useTreeStore } from '../stores/treeStore.js'
import { treeState } from './useDiseasedTrees.js'
import { highlightedEntities, connectionLines } from './useTreeInteraction.js'
import { API } from '../config/api.config.js'

const Cesium = window.Cesium

// ==================== Hook 入口 ====================
export function useNearbySearch() {
    const store = useTreeStore()

    // ========== 清除旧连线 ==========
    function clearConnectionLines(viewer) {
        connectionLines.forEach((line) => {
            viewer.entities.remove(line)
        })
        connectionLines.length = 0
    }

    // ========== 绘制中心点到周边病树的连线 ==========
    function drawConnectionLines(viewer) {
        clearConnectionLines(viewer)

        if (!store.centerTreeInfo) return

        const centerPosition = Cesium.Cartesian3.fromDegrees(
            store.centerTreeInfo.lng,
            store.centerTreeInfo.lat
        )

        store.nearbyTrees.forEach((tree) => {
            // 距离小于 1 米的不画线（可能是中心点自身）
            if (parseFloat(tree.distance) < 1) return

            const treePosition = Cesium.Cartesian3.fromDegrees(
                tree.longitude,
                tree.latitude
            )

            const lineEntity = viewer.entities.add({
                polyline: {
                    positions: [centerPosition, treePosition],
                    width: 1.5,
                    material: Cesium.Color.WHITE,
                    clampToGround: true,
                },
            })
            connectionLines.push(lineEntity)
        })
    }

    // ========== 高亮范围内病树 ==========
    function highlightNearbyTrees() {
        // 还原上一次高亮
        highlightedEntities.forEach((entity) => {
            entity.point.pixelSize = entity._origPixelSize
            entity.point.outlineColor = Cesium.Color.WHITE
            entity.point.outlineWidth = 1
        })
        highlightedEntities.length = 0

        // 高亮当前结果
        store.nearbyTrees.forEach((tree) => {
            // tree.treeId 可能为数字，转为字符串匹配
            const entity = treeState.entityMap.get(String(tree.treeId))
            if (entity) {
                entity.point.pixelSize = 6
                entity.point.outlineColor = Cesium.Color.CYAN
                entity.point.outlineWidth = 2.5
                highlightedEntities.push(entity)
            }
        })
    }

    // ========== 周边病树查询 ==========
    async function searchNearbyTrees(viewer) {
        if (!store.centerTreeInfo) return

        const { lng, lat } = store.centerTreeInfo
        const radius = store.searchRadius

        try {
            const response = await fetch(
                API.nearbySearch(lng, lat, radius),
                {
                    method: 'GET',
                    headers: API.getHeaders(),
                }
            )
            const result = await response.json()
            if (result.code === 1) {
                store.nearbyTrees = result.data.rows || result.data || []
                highlightNearbyTrees()
                drawConnectionLines(viewer)
            }
        } catch (error) {
            console.log('周边病树查询失败', error)
        }
    }

    return {
        searchNearbyTrees,
        highlightNearbyTrees,
        drawConnectionLines,
        clearConnectionLines,
    }
}