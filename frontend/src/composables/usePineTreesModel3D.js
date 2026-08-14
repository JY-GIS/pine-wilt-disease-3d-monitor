/**
 * 3D 松树模型 Hook（病树点 ↔ 3D 松树 切换）
 *
 * 职责：
 * 1. 按感染等级加载对应松树 GLB：绿=1~2级 / 黄=3~4级 / 枯=5级
 * 2. 为病树点创建带属性 + 隐藏标签的 model 实体（复用现有点击交互）
 * 3. 点模式 ↔ 3D 松树模式切换（只切 show，不重复创建）
 * 4. 支持感染等级过滤（与点模式行为一致）
 *
 * 设计说明：
 * - 实体方案适合几百棵以内；数量大时应换 i3dm 实例化瓦片
 * - 树用 heightReference: CLAMP_TO_GROUND 贴地形，后续可换成 height 字段精确落位
 * - 每个实体附带隐藏 point 图形，目的是兼容现有 hover 高亮逻辑（hover 会读写 point.pixelSize）
 */
import { reactive } from 'vue'
import { treeState } from './useDiseasedTrees.js'
import { useTreeStore } from '../stores/treeStore.js'

const Cesium = window.Cesium

// ==================== 模块级状态 ====================
const pineState = reactive({
    loaded: false,   // 是否已创建松树实体
    enabled: false,  // 当前是否为 3D 松树模式
    count: 0,        // 创建的松树数量
})

let pineEntities = []

// 采取三种松树模型(绿/黄/枯)分别对应不同的病害感染等级
const GRADE_TO_MODEL = {
    1: '/models/pine-green.glb',
    2: '/models/pine-green.glb',
    3: '/models/pine-yellow.glb',
    4: '/models/pine-yellow.glb',
    5: '/models/pine-dry.glb',
}
const GRADE_SILHOUETTE = {
    1: Cesium.Color.GREEN,
    2: Cesium.Color.GREEN,
    3: Cesium.Color.ORANGE,
    4: Cesium.Color.ORANGE,
    5: Cesium.Color.YELLOW,
}

// 实体方案性能上限：病树超过该数量时只保留高等级的前 N 棵
const MAX_PINE_TREES = 600
// 模型缩放系数（按模型实际尺寸调整，一般 2~5）
const MODEL_SCALE = 10

// ==================== Hook 入口 ====================
export function usePineTreesModel3D() {
    const treeStore = useTreeStore()
    //======== 创建3D松树模型 ========
    function buildPineEntities(viewer) {
        if (!viewer || pineState.loaded) return
        const rows = treeState.rowTrees || []
        if (rows.length === 0) return
        // --- 数量保护 ---
        let trees = rows
        if (trees.length > MAX_PINE_TREES) {
            // 可读性较差 -> 注释掉
            // trees = [...trees].sort((a,b) => b.grade - a.grade)
            //                   .slice(0, MAX_PINE_TREES)
            // 可读性更好
            const sortedTrees = [...trees].sort((a, b) => b.grade - a.grade);
            trees = sortedTrees.slice(0, MAX_PINE_TREES);
            // 错误！会直接改变原始数组顺序 trees.sort((a,b)=>b.grade-a.grade)
            // 使用[...trees]新建数组，规避了这个问题
            console.warn(
                `[usePineTrees] 病树共 ${rows.length} 棵，超过上限 ${MAX_PINE_TREES}，3D 松树只显示最高等级的前 ${MAX_PINE_TREES} 棵`
            )
        }
        for (const tree of trees) {
            const modelUrl = GRADE_TO_MODEL[tree.grade] || GRADE_TO_MODEL[1]
            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(
                    tree.longitude,
                    tree.latitude
                ),
                model: {
                    uri: modelUrl,
                    scale: MODEL_SCALE,
                    minimumPixelSize: 25,
                    maximumScale: 200,
                    silhouetteColor: GRADE_SILHOUETTE[tree.grade] || Cesium.Color.WHITE,
                    silhouetteSize: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: {
                    treeId: tree.treeId,
                    species: tree.species,
                    grade: tree.grade,
                    chest: tree.chest,
                    longitude: tree.longitude,
                    latitude: tree.latitude,
                    altitude: tree.altitude,
                },
                label: {
                    text:
                        `树ID: ${tree.treeId}\n` +
                        `树种: ${tree.species}\n` +
                        `等级: ${tree.grade}\n` +
                        `胸径: ${tree.chest} cm`,
                    font: '11px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    showBackground: true,
                    outlineColor: Cesium.Color.BLACK,
                    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    show: false,
                },
                // 隐藏点图形:兼容现有hover高亮逻辑(hover会读写point.pixelSize)
                point: {
                    pixelSize: 0,
                    show: false,
                    color: Cesium.Color.WHITE,
                },
            })
            entity._origPixelSize = 0
            entity._origOutlineWidth = 0
            entity.show = false // 默认点模式，松树先隐藏
            pineEntities.push(entity)
        }
        pineState.loaded = true
        pineState.count = pineEntities.length
        console.log(`[usePineTrees] 已创建 ${pineEntities.length} 棵 3D 松树`)
    }

    // ========== 点模式 ↔ 3D 松树模式 切换 ==========
    function togglePineMode(viewer) {
        if (!viewer) return
        if (!pineState.loaded) {
            buildPineEntities(viewer)
        }
        if (pineEntities.length === 0) return
        if (pineState.enabled) {
            // 切换为'点'模式
            pineEntities.forEach((entity) => {
                entity.show = false
            })
            if (treeState.dataSource) { treeState.dataSource.show = true }
            if (treeState.pointPrimitiveCollection) {
                treeState.pointPrimitiveCollection.show = true
            }
            pineState.enabled = false
        } else {
            // 切换为'3D'模式 
            if (treeState.dataSource) { treeState.dataSource.show = false }
            if (treeState.pointPrimitiveCollection) {
                treeState.pointPrimitiveCollection.show = false
            }
            pineEntities.forEach((e) => { e.show = true })
            pineState.enabled = true
        }
        // 切换后应用当前等级过滤
        applyGradeFilter(treeStore.selectedGrade)
    }

    // ========== 等级过滤（与点模式一致） ==========
    function applyGradeFilter(grade) {
        if (!pineState.loaded) return
        for (const e of pineEntities) {
            if (!pineState.enabled) {
                e.show = false
                continue
            }
            let g
            try {
                g = e.properties.grade.getValue()
            } catch (err) {
                g = e.properties.grade
            }
            e.show = (grade === null || g === grade)
        }
    }

    // ========== 卸载清理 ==========
    function unloadPineEntities(viewer) {
        if (!viewer) return
        pineEntities.forEach((e) => {
            try {
                viewer.entities.remove(e)
            } catch (err) {
                // viewer 已销毁时忽略
            }
        })
        pineEntities = []
        pineState.loaded = false
        pineState.enabled = false
        pineState.count = 0
    }

    return {
        pineState,
        buildPineEntities,
        togglePineMode,
        applyGradeFilter,
        unloadPineEntities,
    }
}


