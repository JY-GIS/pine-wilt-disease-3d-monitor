/**
 * 病树交互 Hook
 *
 * 职责：
 * 1. 左键单击 → 选中病树 / 显示标签
 * 2. 左键双击 → 飞行到病树
 * 3. 右键单击 → 单树缓冲区（turf.js）
 * 4. 鼠标悬停 → 高亮
 * 5. 删除病树（Entity + Primitive 两套）
 */
import { inject } from 'vue'
import { useTreeStore } from '../stores/treeStore.js'
import { treeState } from './useDiseasedTrees.js'
import { API } from '../config/api.config.js'
import { throttle } from '../utils/debounce.js'
import { clearPolygonFromMap } from './usePolygonDraw.js'
import * as turf from '@turf/turf'

const Cesium = window.Cesium

// ==================== 模块级状态 ====================
// 供其他模块（周边查询、多边形圈选）访问
export let highlightedEntities = []
export let connectionLines = []

// 右键单树缓冲区引用（仅本文件使用）
let currentBufferDataSource = null

// ==================== Hook 入口 ====================
export function useTreeInteraction() {
    const store = useTreeStore()

    // ========== 辅助：清除连线（内部使用） ==========
    function _clearLines(viewer) {
        connectionLines.forEach((line) => {
            viewer.entities.remove(line)
        })
        connectionLines = []
    }

    // ========== 清除周边查询结果 ==========
    function clearSearchResults(viewer) {
        // 还原高亮
        highlightedEntities.forEach((entity) => {
            if (entity.point) {
                entity.point.pixelSize = entity._origPixelSize
                entity.point.outlineColor = Cesium.Color.WHITE
                entity.point.outlineWidth = 1
            }
        })
        highlightedEntities = []

        // 清除连线
        _clearLines(viewer)

        // 清空 store
        store.nearbyTrees = []
        store.showNearbyPanel = false
    }

    // ========== 删除选中病树 ==========
    async function deleteTree(viewer) {
        const selected = store.selectedEntity
        if (!selected) {
            store.selectedEntity = null
            return
        }

        // ====== 分支 A：Entity 模式 ======
        if (selected.properties && selected.properties.treeId) {
            const treeId = selected.properties.treeId.getValue()
            if (!confirm(`确定要删除树ID为${treeId}的病树吗？`)) return

            try {
                const response = await fetch(API.diseasedTrees.delete(treeId), {
                    method: 'DELETE',
                    headers: API.getHeaders(),
                })
                const result = await response.json()
                if (result.code === 1) {
                    treeState.dataSource.entities.remove(selected)
                    const index = treeState.entities.indexOf(selected)
                    if (index !== -1) treeState.entities.splice(index, 1)
                    store.showDeleteButton = false
                    store.selectedEntity = null
                    alert('删除成功')
                }
            } catch (error) {
                alert('删除失败')
                console.error('删除请求错误', error)
            }
            return
        }

        // ====== 分支 B：Primitive 模式 ======
        const pickedId = selected.id
        const treeData = treeState.treeDataMap.get(pickedId)
        if (!treeData) return

        const treeId = treeData.treeId
        if (!confirm(`确定要删除树ID为${treeId}的病树吗？`)) return

        try {
            const response = await fetch(API.diseasedTrees.delete(treeId), {
                method: 'DELETE',
                headers: API.getHeaders(),
            })
            const result = await response.json()
            if (result.code === 1) {
                treeState.pointPrimitiveCollection.remove(selected)
                treeState.treeDataMap.delete(pickedId)
                if (treeState.sharedLabelEntity) {
                    treeState.sharedLabelEntity.label.show = false
                }
                store.showDeleteButton = false
                store.selectedEntity = null
                alert('删除成功')
            }
        } catch (error) {
            alert('删除失败')
            console.error('删除请求错误', error)
        }
    }

    // ========== 左键单击：选中病树 ==========
    function handleLeftClickEvent(viewer) {
        const handler = viewer.screenSpaceEventHandler
        let lastSelectedEntity = null
        let lastSelectedPrimitive = null

        handler.setInputAction(async (click) => {
            const picked = viewer.scene.pick(click.position)

            // ====== 分支 A：点到了 Entity ======
            if (
                Cesium.defined(picked) &&
                picked.id &&
                picked.id.properties &&
                picked.id.properties.treeId
            ) {
                clearSearchResults(viewer)

                if (treeState.sharedLabelEntity) {
                    treeState.sharedLabelEntity.label.show = false
                }
                if (lastSelectedPrimitive) {
                    lastSelectedPrimitive.pixelSize = lastSelectedPrimitive._origPixelSize
                    lastSelectedPrimitive = null
                }
                if (lastSelectedEntity && lastSelectedEntity.label) {
                    lastSelectedEntity.label.show = false
                }

                const nowEntity = picked.id
                store.selectedEntity = nowEntity
                nowEntity.label.show = true
                store.showDeleteButton = true
                lastSelectedEntity = nowEntity

                store.centerTreeInfo = {
                    treeId: nowEntity.properties.treeId.getValue(),
                    species: nowEntity.properties.species.getValue(),
                    grade: nowEntity.properties.grade.getValue(),
                    lng: nowEntity.properties.longitude.getValue(),
                    lat: nowEntity.properties.latitude.getValue(),
                    chest: nowEntity.properties.chest.getValue(),
                }
                store.showNearbyPanel = true
                return
            }

            // ====== 分支 B：点到了 Primitive ======
            if (
                Cesium.defined(picked) &&
                picked.id &&
                treeState.treeDataMap.has(picked.id)
            ) {
                clearSearchResults(viewer)

                if (lastSelectedEntity && lastSelectedEntity.label) {
                    lastSelectedEntity.label.show = false
                    lastSelectedEntity = null
                }

                const treeData = treeState.treeDataMap.get(picked.id)
                treeState.sharedLabelEntity.position =
                    Cesium.Cartesian3.fromDegrees(treeData.longitude, treeData.latitude, 0)
                treeState.sharedLabelEntity.label.text =
                    `树ID: ${treeData.treeId}\n` +
                    `树种: ${treeData.species}\n` +
                    `等级: ${treeData.grade}\n` +
                    `胸径: ${treeData.chest}`
                treeState.sharedLabelEntity.label.show = true

                store.selectedEntity = picked.primitive
                lastSelectedPrimitive = picked.primitive

                store.centerTreeInfo = {
                    treeId: treeData.treeId,
                    species: treeData.species,
                    grade: treeData.grade,
                    lng: treeData.longitude,
                    lat: treeData.latitude,
                    chest: treeData.chest,
                }
                store.showNearbyPanel = true
                return
            }

            // ====== 点到了空白处 ======
            clearSearchResults(viewer)

            if (store.showPolygonPanel) {
                store.closePolygonPanel()
                clearPolygonFromMap(viewer)
            }

            if (lastSelectedEntity && lastSelectedEntity.label) {
                lastSelectedEntity.label.show = false
                lastSelectedEntity = null
            }
            if (lastSelectedPrimitive) {
                lastSelectedPrimitive.pixelSize = lastSelectedPrimitive._origPixelSize
                lastSelectedPrimitive = null
            }
            if (treeState.sharedLabelEntity) {
                treeState.sharedLabelEntity.label.show = false
            }

            store.selectedEntity = null
            store.showDeleteButton = false
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    }

    // ========== 左键双击：飞行到病树 ==========
    function setupDoubleClickToFly(viewer) {
        const handler = viewer.screenSpaceEventHandler

        handler.setInputAction(async (click) => {
            const picked = viewer.scene.pick(click.position)

            if (
                Cesium.defined(picked) &&
                picked.id &&
                picked.id.properties &&
                picked.id.properties.treeId
            ) {
                viewer.flyTo(picked.id, {
                    duration: 1.3,
                    maximumHeight: 5000,
                    offset: new Cesium.HeadingPitchRange(
                        Cesium.Math.toRadians(30),
                        Cesium.Math.toRadians(-40),
                        1500
                    ),
                })
            }
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    }

    // ========== 右键单击：单树缓冲区（turf.js） ==========
    function generateMergedBuffer(viewer) {
        const handler = viewer.screenSpaceEventHandler

        handler.setInputAction(async (click) => {
            const picked = viewer.scene.pick(click.position)

            if (
                Cesium.defined(picked) &&
                picked.id &&
                picked.id.properties &&
                picked.id.properties.treeId
            ) {
                if (currentBufferDataSource) {
                    viewer.dataSources.remove(currentBufferDataSource)
                    currentBufferDataSource = null
                }

                const lng = picked.id.properties.longitude.getValue()
                const lat = picked.id.properties.latitude.getValue()

                const bufferPoint = turf.point([lng, lat])
                const buffered = turf.buffer(bufferPoint, 300, { units: 'meters' })

                const feature = {
                    type: 'Feature',
                    geometry: buffered.geometry,
                    properties: { name: '病树缓冲区' },
                }

                currentBufferDataSource = await Cesium.GeoJsonDataSource.load(feature, {
                    fill: Cesium.Color.RED.withAlpha(0.5),
                    outline: false,
                })
                viewer.dataSources.add(currentBufferDataSource)
            } else {
                if (currentBufferDataSource) {
                    viewer.dataSources.remove(currentBufferDataSource)
                    currentBufferDataSource = null
                }
            }
        }, Cesium.ScreenSpaceEventType.RIGHT_UP)
    }

    // ========== 鼠标悬停高亮 ==========
    function highLightTree(viewer) {
        const handler = viewer.screenSpaceEventHandler
        let lastMovedTree = null

        const onMouseMove = function (movement) {
            const picked = viewer.scene.pick(movement.endPosition)
            let currentEntity = null
            let currentPrimitive = null

            if (
                Cesium.defined(picked) &&
                picked.id &&
                picked.id.properties &&
                picked.id.properties.treeId
            ) {
                currentEntity = picked.id
            } else if (
                Cesium.defined(picked) &&
                picked.id &&
                treeState.treeDataMap.has(picked.id)
            ) {
                currentPrimitive = picked.primitive
            }

            // 还原上一个 Entity
            if (
                lastMovedTree &&
                lastMovedTree !== currentEntity &&
                lastMovedTree.point
            ) {
                lastMovedTree.point.pixelSize = lastMovedTree._origPixelSize
                lastMovedTree.point.outlineColor = Cesium.Color.WHITE
                lastMovedTree.point.outlineWidth = lastMovedTree._origOutlineWidth
            }

            // 还原上一个 Primitive
            if (
                lastMovedTree &&
                lastMovedTree !== currentPrimitive &&
                lastMovedTree._origPixelSize &&
                !lastMovedTree.point
            ) {
                lastMovedTree.pixelSize = lastMovedTree._origPixelSize
                lastMovedTree.outlineColor = Cesium.Color.WHITE
                lastMovedTree.outlineWidth = lastMovedTree._origOutlineWidth
            }

            // 高亮当前 Entity
            if (currentEntity) {
                currentEntity.point.pixelSize = currentEntity._origPixelSize * 1.5
                currentEntity.point.outlineColor = Cesium.Color.LIME
                currentEntity.point.outlineWidth = 2
                lastMovedTree = currentEntity
            }
            // 高亮当前 Primitive
            else if (currentPrimitive) {
                currentPrimitive.pixelSize = currentPrimitive._origPixelSize * 1.5
                currentPrimitive.outlineColor = Cesium.Color.LIME
                currentPrimitive.outlineWidth = 2
                lastMovedTree = currentPrimitive
            } else {
                lastMovedTree = null
            }
        }

        handler.setInputAction(
            throttle(onMouseMove, 50),
            Cesium.ScreenSpaceEventType.MOUSE_MOVE
        )
    }

    return {
        handleLeftClickEvent,
        setupDoubleClickToFly,
        generateMergedBuffer,
        highLightTree,
        deleteTree,
        clearSearchResults,
    }
}