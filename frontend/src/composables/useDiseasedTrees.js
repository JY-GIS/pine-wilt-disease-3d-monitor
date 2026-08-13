/**
 * 病树数据加载 Hook
 *
 * 职责：
 * 1. 从后端加载病树数据 → 转为 GeoJSON → 加载为 Entity
 * 2. 设置病树样式（颜色/大小/标签）
 * 3. 构建 Primitive 版本（供模式切换用）
 * 4. 加载疫区边界多边形
 * 5. 提供 Entity ↔ Primitive 模式切换
 */
import { ref } from 'vue'
import { API } from '../config/api.config.js'
import { getGradeColorAndSize } from '../utils/treeStyle.js'

const Cesium = window.Cesium

// ==================== 模块级共享状态 ====================
// 其他 hook（交互、缓冲区、周边查询）需要访问这些数据
// 用对象包裹，确保引用不变（内部属性可变）
export const treeState = {
    entities: null,           // Entity 数组
    dataSource: null,         // GeoJsonDataSource
    entityMap: new Map(),     // treeId → Entity 映射（用于高亮周边病树）
    rowTrees: [],             // 原始数据数组（用于 Primitive 模式）
    pointPrimitiveCollection: null,  // Primitive 点集合
    treeDataMap: new Map(),   // id → 原始数据 映射（用于 Primitive 交互）
    sharedLabelEntity: null,  // Primitive 模式共用的标签 Entity
}

// ==================== Hook 入口 ====================
export function useDiseasedTrees() {
    // 渲染模式标识
    const isPrimitiveMode = ref(false)

    // ========== 设置单个病树的 Entity 样式 ==========
    function initDiseasedTreeStyle(entity) {
        const props = entity.properties

        // 清除可能存在的 billboard
        if (entity.billboard) {
            entity.billboard = undefined
        }

        // 获取等级
        let grade = null
        try {
            grade = props.grade.getValue()
        } catch (e) {
            console.log('grade 取值异常，跳过', e)
        }

        // 等级 → 颜色 & 大小
        let color, pixelSize
        if (grade == 5) { color = Cesium.Color.BLACK; pixelSize = 4 }
        else if (grade == 4) { color = Cesium.Color.RED; pixelSize = 3.75 }
        else if (grade == 3) { color = Cesium.Color.PURPLE; pixelSize = 3.5 }
        else if (grade == 2) { color = Cesium.Color.YELLOW; pixelSize = 3.25 }
        else if (grade == 1) { color = Cesium.Color.GREEN; pixelSize = 3 }
        else { color = Cesium.Color.WHITE; pixelSize = 3 }

        // 设置点样式
        entity.point = new Cesium.PointGraphics({
            pixelSize: pixelSize,
            color: color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000000),
            scaleByDistance: new Cesium.NearFarScalar(500, 2, 20000000, 0.2),
        })

        // 保存原始样式（供高亮还原用）
        entity._origPixelSize = pixelSize
        entity._origOutlineWidth = 1

        // 设置标签（默认隐藏，点击时显示）
        entity.label = new Cesium.LabelGraphics({
            text:
                `树ID: ${props.treeId.getValue()}\n` +
                `树种: ${props.species.getValue()}\n` +
                `等级: ${props.grade.getValue()}\n` +
                `胸径: ${props.chest.getValue()}\n` +
                `调查时间: ${props.surveyDate.getValue()}`,
            font: '11px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            showBackground: true,
            outlineColor: Cesium.Color.BLACK,
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            show: false,
        })
    }

    // ========== 加载病树数据（Entity 模式） ==========
    async function loadDiseasedTreesPoints(viewer) {
        // 1. 调后端接口
        const response = await fetch(API.diseasedTrees.list, {
            method: 'GET',
            headers: API.getHeaders(),
        })
        const result = await response.json()
        const trees = result.data.rows || result.data

        // 2. 缓存原始数据（供 Primitive 模式用）
        treeState.rowTrees = trees

        // 3. 构建 GeoJSON
        const geojson = {
            type: 'FeatureCollection',
            features: trees.map((tree) => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [tree.longitude, tree.latitude],
                },
                properties: {
                    treeId: tree.treeId,
                    species: tree.species,
                    grade: tree.grade,
                    chest: tree.chest,
                    longitude: tree.longitude,
                    latitude: tree.latitude,
                    surveyDate: tree.surveyDate,
                },
            })),
        }

        // 4. 加载为 Entity 数据源
        treeState.dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
            pointSize: 7,
        })
        treeState.entities = treeState.dataSource.entities.values
        console.log('entities 数量为:', treeState.entities.length)

        // 5. 设置每个点样式 + 建立索引
        for (let i = 0; i < treeState.entities.length; i++) {
            const entity = treeState.entities[i]
            initDiseasedTreeStyle(entity)
            treeState.entityMap.set(
                entity.properties.treeId.getValue(),
                entity
            )
        }

        // 6. 添加到场景
        viewer.dataSources.add(treeState.dataSource)

        // 7. 飞向数据区域
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(103.90, 36.05, 5000000),
            orientation: {
                heading: Cesium.Math.toRadians(0),
                pitch: Cesium.Math.toRadians(-90.0),
                roll: 0.0,
            },
        })

        // setTimeout(() => {
        //     viewer.flyTo(treeState.dataSource, {
        //     viewer.flyTo(treeState.dataSource, {
        //         duration: 3,
        //         maximumHeight: 1500000,
        //     })
        // }, 1000)

        // 8. 返回统计信息
        const now = new Date()
        const monthlyNew = treeState.entities.filter((e) => {
            const d = new Date(
                e.properties.surveyDate?.getValue?.() || e.properties.surveyDate
            )
            return (
                d.getMonth() === now.getMonth() &&
                d.getFullYear() === now.getFullYear()
            )
        }).length

        const recent = treeState.entities
            .map((e) => ({
                treeId:
                    e.properties.treeId?.getValue?.() ?? e.properties.treeId,
                species:
                    e.properties.species?.getValue?.() ?? e.properties.species,
                grade:
                    e.properties.grade?.getValue?.() ?? e.properties.grade,
                surveyDate:
                    e.properties.surveyDate?.getValue?.() ?? e.properties.surveyDate,
            }))
            .sort((a, b) => new Date(b.surveyDate) - new Date(a.surveyDate))
            .slice(0, 5)

        return {
            treesCount: treeState.entities.length,
            monthlyNewCount: monthlyNew,
            recentRecords: recent,
        }
    }

    // ========== 构建混合模式 Primitive 点 ==========
    function buildMixedPrimitivePoints(viewer) {
        const trees = treeState.rowTrees
        const collection = new Cesium.PointPrimitiveCollection()

        for (let i = 0; i < trees.length; i++) {
            const tree = trees[i]
            const id = `tree_${tree.treeId}`
            const { color, pixelSize } = getGradeColorAndSize(tree.grade)

            // 缓存原始数据
            treeState.treeDataMap.set(id, tree)

            // 添加点
            const pt = collection.add({
                position: Cesium.Cartesian3.fromDegrees(
                    tree.longitude,
                    tree.latitude
                ),
                color: color,
                pixelSize: pixelSize,
                outlineWidth: 1,
                outlineColor: Cesium.Color.WHITE,
                id: id,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            })

            // 保存原始样式（供高亮还原）
            pt._origPixelSize = pixelSize
            pt._origOutlineWidth = 1
        }

        treeState.pointPrimitiveCollection = collection

        // 创建共享标签 Entity（默认隐藏）
        treeState.sharedLabelEntity = viewer?.entities?.add({
            position: Cesium.Cartesian3.fromDegrees(0, 0),
            label: {
                text: '',
                font: '11px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                showBackground: true,
                outlineColor: Cesium.Color.BLACK,
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                show: false,
            },
        })

        return collection
    }

    // ========== 加载疫区边界 ==========
    async function loadOutbreakPolygon(viewer) {
        const response = await fetch(API.outBounder, {
            method: 'GET',
            headers: API.getHeaders(),
        })
        const result = await response.json()
        const polygonGeo = JSON.parse(result.data)

        // GeoJSON Feature
        const feature = {
            type: 'Feature',
            geometry: polygonGeo,
            properties: { name: '疫区边界' },
        }

        // 加载为半透明面
        const polygonDataSource = await Cesium.GeoJsonDataSource.load(feature, {
            fill: Cesium.Color.WHITE.withAlpha(0.15),
            outline: false,
        })
        viewer.dataSources.add(polygonDataSource)

        // 提取外环画边框线
        const coords = polygonGeo.coordinates[0]
        const cartesianArr = coords.flatMap((lnglat) =>
            Cesium.Cartesian3.fromDegrees(lnglat[0], lnglat[1])
        )

        viewer.entities.add({
            polyline: {
                positions: cartesianArr,
                clampToGround: true,
                width: 1.5,
                material: Cesium.Color.YELLOW.withAlpha(0.9),
            },
        })
    }

    // ========== Entity ↔ Primitive 模式切换 ==========
    function switchToMixedMode(viewer) {
        if (!isPrimitiveMode.value) {
            // 切换到 Primitive 模式
            if (treeState.dataSource) treeState.dataSource.show = false
            if (treeState.sharedLabelEntity) {
                treeState.sharedLabelEntity.label.show = false
            }
            buildMixedPrimitivePoints(viewer)
            viewer.scene.primitives.add(treeState.pointPrimitiveCollection)
            isPrimitiveMode.value = true
        } else {
            // 切换回 Entity 模式
            if (treeState.pointPrimitiveCollection) {
                viewer.scene.primitives.remove(treeState.pointPrimitiveCollection)
                treeState.pointPrimitiveCollection = null
                treeState.treeDataMap.clear()
            }
            if (treeState.sharedLabelEntity) {
                treeState.sharedLabelEntity.label.show = false
            }
            if (treeState.dataSource) treeState.dataSource.show = true
            isPrimitiveMode.value = false
        }
    }

    return {
        loadDiseasedTreesPoints,
        loadOutbreakPolygon,
        switchToMixedMode,
        isPrimitiveMode,
    }
}