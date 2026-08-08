/**
* 根据ID定位病树 Hook
*
* 职责：
* 1. 输入病树的ID
* 2. 点击定位按钮
* 3. 镜头飞向病树
*
*/
import { treeState } from './useDiseasedTrees.js'
import { API } from '../config/api.config.js'
import { getViewer } from './useCesiumViewer.js'
const Cesium = window.Cesium

// ==================== 单树查询 ====================
let markerEntity = null
let labelEntity = null
let removeTimer = null

// ==================== Hook 入口 ====================
export function useSearchTree() {

    function flyToPosition(lng, lat, viewer) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, 2000),
            duration: 1.5,
            orientation: {
                heading: Cesium.Math.toRadians(0),
                pitch: Cesium.Math.toRadians(-90),
                roll: 0,
            },
        })
    }

    function addTempMarker(tree, viewer) {
        clearTempMarker(viewer)
        const position = Cesium.Cartesian3.fromDegrees(tree.longitude, tree.latitude)
        markerEntity = viewer.entities.add({
            position: position,
            point: {
                pixelSize: 8,
                color: Cesium.Color.GOLD,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1.3,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
        labelEntity = viewer.entities.add({
            position: position,
            label: {
                text: [
                    `ID: ${tree.treeId}`,
                    `树种: ${tree.species}`,
                    `等级: ${tree.grade}级`,
                    `胸径: ${tree.chest}cm`,
                ].join('\n'),
                font: '12px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -18),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
        })
        // 5 秒后自动清除
        removeTimer = setTimeout(() => {
            clearTempMarker(viewer)
        }, 5000)
    }


    function clearTempMarker(viewer) {
        if (removeTimer) {
            clearTimeout(removeTimer)
            removeTimer = null
        }
        if (markerEntity) {
            viewer.entities.remove(markerEntity)
            markerEntity = null
        }
        if (labelEntity) {
            viewer.entities.remove(labelEntity)
            labelEntity = null
        }
    }

    async function searchTreeById(treeId) {
        if (!treeId || !treeId.trim()) {
            console.error('请输入病树编号')
            return
        }
        let result
        try {
            const response = await fetch(API.searchTreeById(treeId), {
                method: 'GET',
                headers: API.getHeaders(),
            })
            result = await response.json()
        } catch (error) {
            console.error('查询失败', error)
            alert('查询失败，请检查网络')
            return
        }
        if (result.code !== 1 || !result.data || result.data.length === 0) {
            alert('未找到该病树')
            return
        }
        const tree = result.data[0]
        const viewer = getViewer()
        if (!viewer) {
            console.warn('viewer 未初始化')
            return
        }
        flyToPosition(tree.longitude, tree.latitude, viewer)
        addTempMarker(tree, viewer)
    }

    return {
        searchTreeById
    }
}
