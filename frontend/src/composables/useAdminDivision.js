/**
 * 行政区划病树疫情 — Cesium 图层与交互
 *
 * 【核心规则】
 *   全国视图 → 只显示省份多边形 + 白色省界，所有病树 Entity 隐藏
 *   省级视图 → 选中省填充消失（金色边界线勾勒），其他省半透明，
 *             显示该省城市面（四色 + 市界），不显示病树
 *   市级视图 → 选中市填充消失（金色边界线勾勒），其他市半透明，
 *             显示该市病树
 *
 * 【省界/市界绘制方案】（重要背景）
 *   - 项目全局设置了 Cesium.GeoJsonDataSource.clampToGround = true，
 *     Cesium 1.142 会强制禁用贴地 polygon 的 outline（控制台警告
 *     "Entity geometry outlines are unsupported on terrain."），
 *     所以 polygon.outline / stroke 画的边界永远不显示。
 *   - 本次改为：后端用 ST_Boundary(geom) 单独返回边界线 GeoJSON，
 *     前端用独立贴地 Polyline 渲染（polyline 不受 outline 限制）。
 *
 * 【职责】
 *   1. 加载省级多边形 GeoJSON → 按严重程度着色
 *   2. 加载省边界线 → 独立贴地 Polyline（白色）
 *   3. 加载完成后立即隐藏所有病树（全国视图不显示病树）
 *   4. 鼠标悬停：省/市填充变金色半透明
 *   5. 点击省份：选中省 + 加载城市层 + 飞行
 *   6. 点击城市：选中市 + 显示该市病树 + 飞行
 *   7. 返回全国/返回省级：还原所有样式 + 飞行
 *   8. 统一筛选：等级 + 区域取交集
 */
import { useAdminDivisionStore } from '../stores/adminDivisionStore.js'
import { useTreeStore } from '../stores/treeStore.js'
import { treeState } from './useDiseasedTrees.js'
const Cesium = window.Cesium

// ==================== 模块级变量（不对外暴露） ====================
// ---------- 省级 ----------
let provinceDataSource = null
let provinceBorderEntities = new Map()
let provinceEntityMap = new Map()
let selectedProvinceGbCode = null
let highlightedProvinceGbCode = null
// ---------- 市级 ----------
let cityDataSource = null
let cityBorderEntities = new Map()
let cityEntityMap = new Map()
let selectedCityGbCode = null
let highlightedCityGbCode = null
// ---------- 交互（省市共用） ----------
let originalLeftClick = null
let originalMouseMove = null

// ==================== Hook 入口 ====================
export function useAdminDivision() {
    // ================================================================
    //  1. 加载省级多边形图层
    // ================================================================
    /**
     * 从 adminDivisionStore.provinces 读取数据，
     * 构建 GeoJSON FeatureCollection，加载为 Cesium GeoJsonDataSource，
     * 逐个 Entity 按严重程度着色，
     * 加载完成后立即隐藏所有病树 Entity（全国视图不显示病树）。
     *
     * 调用时机：App.vue onMounted，必须在病树数据加载完成之后调用
     *          （因为需要访问 treeState.entities）
     *
     * @param {Cesium.Viewer} viewer
     */
    async function loadProvincesLayer(viewer) {
        const store = useAdminDivisionStore()
        // ----- 防御：避免重复添加 -----
        if (provinceDataSource) {
            viewer.dataSources.remove(provinceDataSource)
            provinceDataSource = null
        }
        clearAllBorderEntities(viewer)
        // ----- 构建 GeoJSON FeatureCollection -----
        // store.provinces 每个元素的 geojson 字段是 ST_AsGeoJSON 返回的字符串
        const features = store.provinces.map((p) => {
            const geometry = JSON.parse(p.geojson)
            return {
                type: 'Feature',
                geometry: geometry,
                properties: {
                    provinceGbCode: p.gbCode,
                    provinceName: p.name,
                    severity: p.severity,
                    treeCount: p.treeCount,
                },
            }
        })
        const featureCollection = {
            type: 'FeatureCollection',
            features: features,
        }
        // ----- 加载到 Cesium -----
        provinceDataSource = await Cesium.GeoJsonDataSource.load(
            featureCollection,
            {
                fill: Cesium.Color.WHITE.withAlpha(0.1),
                clampToGround: true,
            }
        )
        viewer.dataSources.add(provinceDataSource)
        // ----- 逐个着色：按严重程度设置填充色 -----
        const entities = provinceDataSource.entities.values
        // 清空并重建 gbCode → 省面 entity 映射
        provinceEntityMap.clear()
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]
            const severity = entity.properties.severity?.getValue()
            const colorStr = store.getSeverityColor(severity)
            const color = Cesium.Color.fromCssColorString(colorStr)
            entity.polygon.material = color
            // 保存原始样式（供取消选中 / 取消高亮时还原）
            entity._fillColor = color.clone()
            const gbCode = entity.properties.provinceGbCode.getValue()
            entity._gbCode = gbCode
            // ----- 将岛屿也并入省份 -----
            if (!provinceEntityMap.has(gbCode)) {
                provinceEntityMap.set(gbCode, [])
            }
            provinceEntityMap.get(gbCode).push(entity)
        }
        console.log('省级行政区图层加载完毕,共', entities.length, '个面')
        // ================================================================
        //  创建省边界线（独立贴地 Polyline）
        // ================================================================
        createProvinceBorders(viewer, store)
        // ----- ★ 关键：全国视图下隐藏所有病树 -----
        // 必须在多边形加载完成后立即执行，
        // 确保用户第一眼看到的地图是干净的（只有省界面，没有病树点）
        hideAllTrees()
    }
    // ================================================================
    //  加载城市行政区（和 loadProvincesLayer 镜像）
    // ================================================================
    function loadCityLayer(viewer, store) {
        // 防御：先清除旧城市层
        if (cityDataSource) {
            viewer.dataSources.remove(cityDataSource)
            cityDataSource = null
        }
        clearCityBorderEntities(viewer)
        cityEntityMap.clear()
        if (!store.cities || store.cities.length === 0) {
            console.warn('城市列表为空，跳过加载城市层')
            return
        }
        // 构建 GeoJSON FeatureCollection
        const features = store.cities.map((c) => {
            const geometry = JSON.parse(c.geojson)
            return {
                type: 'Feature',
                geometry: geometry,
                properties: {
                    // ★ 注意：属性名是 cityGbCode，和省 provinceGbCode 区分
                    // 这样 pick 时可以判断 entity 是省还是市
                    cityGbCode: c.gbCode,
                    cityName: c.name,
                    severity: c.severity,
                    treeCount: c.treeCount,
                },
            }
        })
        const featureCollection = {
            type: 'FeatureCollection',
            features: features,
        }
            // 用 IIFE 包装  作用：让点击省之后直接飞行，而不是等加载完市行政区再飞行
            ; (async () => {
                cityDataSource = await Cesium.GeoJsonDataSource.load(
                    featureCollection,
                    {
                        fill: Cesium.Color.WHITE.withAlpha(0.1),
                        stroke: Cesium.Color.WHITE,
                        strokeWidth: 1,
                        clampToGround: true,
                    }
                )
                viewer.dataSources.add(cityDataSource)
                const entities = cityDataSource.entities.values
                for (let i = 0; i < entities.length; i++) {
                    const entity = entities[i]
                    const severity = entity.properties.severity?.getValue()
                    const colorStr = store.getSeverityColor(severity)
                    const color = Cesium.Color.fromCssColorString(colorStr)
                    entity.polygon.material = color
                    entity._fillColor = color.clone()
                    const gbCode = entity.properties.cityGbCode.getValue()
                    entity._gbCode = gbCode
                    if (!cityEntityMap.has(gbCode)) {
                        cityEntityMap.set(gbCode, [])
                    }
                    cityEntityMap.get(gbCode).push(entity)
                }
                console.log('城市图层加载完毕,共', entities.length, '个面')
                // 创建市边界线
                createCityBorders(viewer, store)
            })()
    }

    // ================================================================
    //  创建所有省边界线 + 清理
    // ================================================================
    /**
     * 遍历 store.provinces，为每个省的 boundary 逐段创建贴地 Polyline entity
     *
     * @param {Cesium.Viewer} viewer
     * @param {Object} store - adminDivisionStore 实例
     */
    function createProvinceBorders(viewer, store) {
        provinceBorderEntities = new Map()
        for (const p of store.provinces) {
            let boundary
            try {
                boundary = JSON.parse(p.boundary)
            } catch (e) {
                console.error('省份边界解析失败，跳过:', p.name, e)
                continue
            }
            if (!boundary || boundary.type !== 'MultiLineString') {
                console.error('省份边界格式错误，跳过:', p.name)
                continue
            }
            const borderEntities = []
            // MultiLineString.coordinates = [ [ [lng,lat],... ], ... ]，每段是一条线
            for (const lineCoords of boundary.coordinates) {
                const flat = lineCoords.flat()
                const borderEntity = viewer.entities.add({
                    properties: {
                        provinceGbCode: p.gbCode,
                    },
                    polyline: {
                        positions: Cesium.Cartesian3.fromDegreesArray(flat),
                        clampToGround: false,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        width: 3,
                        material: Cesium.Color.WHITE,
                    },
                })
                // 保存该省的"原始边界颜色"（高亮还原用）
                // _ 前缀 = 约定俗成的私有属性标记
                borderEntity._boundaryColor = Cesium.Color.WHITE
                borderEntities.push(borderEntity)
            }
            provinceBorderEntities.set(p.gbCode, borderEntities)
        }
        console.log('省边界线创建完成,共', provinceBorderEntities.size, '个省的边界')
    }
    // ================================================================
    //   城市边界线（和 createProvinceBorders 镜像）
    // ================================================================
    function createCityBorders(viewer, store) {
        cityBorderEntities = new Map()
        for (const c of store.cities) {
            let boundary
            try {
                boundary = JSON.parse(c.boundary)
            } catch (e) {
                console.error('城市边界解析失败，跳过:', c.name, e)
                continue
            }
            if (!boundary || boundary.type !== 'MultiLineString') {
                console.error('城市边界格式错误，跳过:', c.name)
                continue
            }
            const borderEntities = []
            for (const lineCoords of boundary.coordinates) {
                const flat = lineCoords.flat()
                const borderEntity = viewer.entities.add({
                    properties: {
                        cityGbCode: c.gbCode,
                    },
                    polyline: {
                        positions: Cesium.Cartesian3.fromDegreesArray(flat),
                        clampToGround: false,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        width: 2.5,
                        material: Cesium.Color.WHITE,
                    },
                })
                borderEntity._boundaryColor = Cesium.Color.WHITE
                borderEntities.push(borderEntity)
            }
            cityBorderEntities.set(c.gbCode, borderEntities)
        }
        console.log('市边界线创建完成,共', cityBorderEntities.size, '个市')
    }

    /**
     * 清除所有边界线 entity 并清空映射
     * 调用时机：loadProvincesLayer 开头（防止重复加载残留）
     *
     * @param {Cesium.Viewer} viewer
     */
    function clearAllBorderEntities(viewer) {
        for (const borders of provinceBorderEntities.values()) {
            for (const b of borders) {
                viewer.entities.remove(b)
            }
        }
        provinceBorderEntities.clear()
    }
    function clearCityBorderEntities(viewer) {
        for (const borders of cityBorderEntities.values()) {
            for (const b of borders) {
                viewer.entities.remove(b)
            }
        }
        cityBorderEntities.clear()
    }

    // ================================================================
    //  边界线颜色工具（高亮金色 / 还原白色）
    // ================================================================
    /**
     * 把某省所有边界线设为金色
     * 参数从 entity 改为 gbCode —— 边界线映射本来就按 gbCode 存储，
     *   直接查即可，不需要先反查 entity
     */
    function highlightBorderColor(gbCode) {
        const borders = provinceBorderEntities.get(gbCode)
        if (!borders) {
            return
        }
        for (const b of borders) {
            b.polyline.material = Cesium.Color.GOLD
        }
    }
    /**
     * 把某省边界线还原为白色
     * 选中的省不还原（保持金色）——与 restoreProvinceStyle 的 selectedProvinceEntity 判断一致
     */
    function restoreBorderColor(gbCode) {
        if (selectedProvinceGbCode === gbCode) return
        const borders = provinceBorderEntities.get(gbCode)
        if (!borders) return
        for (const b of borders) {
            b.polyline.material = b._boundaryColor || Cesium.Color.WHITE
        }
    }

    // ================================================================
    //  2. 设置交互事件（包裹现有处理器）
    // ================================================================
    /**
     * 包裹 Cesium 的 LEFT_CLICK 和 MOUSE_MOVE 处理器。
     *
     * ★ Cesium 的 setInputAction 会替换同类型的旧处理器。
     *   所以先用 getInputAction 取出旧处理器保存，
     *   新处理器内部"不命中省份时调用旧处理器"。
     *   这是 Cesium 多层交互的标准做法。
     *
     * 调用时机：App.vue onMounted，在树交互事件注册之后
     *
     * @param {Cesium.Viewer} viewer
     */
    function setupProvinceInteraction(viewer) {
        const handler = viewer.screenSpaceEventHandler
        // 保存原始处理器 - (树交互)
        originalLeftClick = handler.getInputAction(
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        )
        originalMouseMove = handler.getInputAction(
            Cesium.ScreenSpaceEventType.MOUSE_MOVE
        )
        // ----- 左键单击：市 > 省 > 树（优先级递减） -----
        handler.setInputAction((click) => {
            const picked = viewer.scene.pick(click.position)
            // 第 1 优先：命中城市
            if (Cesium.defined(picked) && picked.id &&
                picked.id.properties && picked.id.properties.cityGbCode) {
                handleCityClick(picked.id, viewer)
                return
            }
            // 第 2 优先：命中省份
            if (Cesium.defined(picked) && picked.id &&
                picked.id.properties && picked.id.properties.provinceGbCode) {
                handleProvinceClick(picked.id, viewer)
                return
            }
            // 都不是 → 交给树交互处理器
            if (originalLeftClick) {
                originalLeftClick(click)
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
        // ----- 鼠标移动：市悬停 > 省悬停 → 始终调用树悬停 -----
        handler.setInputAction((movement) => {
            const picked = viewer.scene.pick(movement.endPosition)
            // 第 1 优先：市悬停高亮
            let cityHoverGbCode = null
            if (Cesium.defined(picked) && picked.id &&
                picked.id.properties && picked.id.properties.cityGbCode) {
                cityHoverGbCode = picked.id.properties.cityGbCode.getValue()
            }
            if (highlightedCityGbCode && highlightedCityGbCode !== cityHoverGbCode) {
                restoreCityFill(highlightedCityGbCode)
                highlightedCityGbCode = null
            }
            if (cityHoverGbCode && cityHoverGbCode !== selectedCityGbCode) {
                highlightCityFill(cityHoverGbCode)
                highlightedCityGbCode = cityHoverGbCode
            }
            // 第 2 优先：省悬停高亮（城市没命中时才生效）
            let hoverGbCode = null
            if (!cityHoverGbCode &&
                Cesium.defined(picked) && picked.id &&
                picked.id.properties && picked.id.properties.provinceGbCode) {
                hoverGbCode = picked.id.properties.provinceGbCode.getValue()
            }
            if (highlightedProvinceGbCode && highlightedProvinceGbCode !== hoverGbCode) {
                restoreProvinceFill(highlightedProvinceGbCode)
                highlightedProvinceGbCode = null
            }
            if (hoverGbCode && hoverGbCode !== selectedProvinceGbCode) {
                highlightProvinceFill(hoverGbCode)
                highlightedProvinceGbCode = hoverGbCode
            }
            // 始终调用原始鼠标移动处理器（树悬停高亮）
            if (originalMouseMove) {
                originalMouseMove(movement)
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
        console.log('省市交互事件注册完成（市 > 省 > 树 优先级链）')
    }

    // ================================================================
    //  4a. 省份点击处理
    // ================================================================
    /**
     * 点击省份的完整流程：
     *   1. 设置选中态（选中省金色边框 + 其他省半透明）
     *   2. 更新 Store → 拉取该省病树 ID 列表
     *   3. 显示该省病树（applyAllFilters）
     *   4. 相机飞到该省上空
     */
    async function handleProvinceClick(entity, viewer) {
        const store = useAdminDivisionStore()
        const gbCode = entity.properties.provinceGbCode.getValue()
        const province = store.provinces.find((p) => p.gbCode === gbCode)
        if (!province) {
            console.warn('未找到省份数据:', gbCode)
            return
        }
        // ----- 1. 设置省选中态（选中省金色边框 + 其他省半透明）-----
        setProvinceSelection(gbCode)
        // ----- 2. 更新 Store 拉取城市列表 -----
        await store.selectProvince(province)
        // ----- 3. 加载市级行政区 -----
        loadCityLayer(viewer, store)
        // ----- 4. 隐藏该省病树 -----
        applyAllFilters()
        // ----- 5. 飞行到该省 -----
        flyToProvince(gbCode, viewer)
        console.log('已进入省级视图:', province.name, '城市数:', store.cities.length)
    }
    // ================================================================
    //  4b. 城市点击处理
    // ================================================================
    async function handleCityClick(entity, viewer) {
        const store = useAdminDivisionStore()
        const gbCode = entity.properties.cityGbCode.getValue()
        const city = store.cities.find((c) => c.gbCode === gbCode)
        if (!city) {
            console.warn('未找到城市数据:', gbCode)
            return
        }
        // 1. 设置市选中态
        setCitySelection(gbCode)
        // 2. 更新 Store：拉取该市病树 ID
        await store.selectCity(city)
        // 3. 显示该市病树
        applyAllFilters()
        // 4. 飞行到该市
        flyToCity(gbCode, viewer)
        console.log('已进入市级视图:', city.name, '病树数:', city.treeCount)
    }

    // ================================================================
    //  5a. 选中态：选中省高亮 + 其他省半透明
    // ================================================================
    function setProvinceSelection(selectedGbCode) {
        const entities = provinceDataSource?.entities?.values
        if (!entities) return
        selectedProvinceGbCode = null
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]
            const code = entity._gbCode
            if (code === selectedGbCode) {
                // 选中省：所有子面填充消失
                entity.polygon.show = false
                entity._dimmedColor = null
                // 整省边界线金色
                highlightBorderColor(code)
            } else {
                // 其他省：恢复填充显示 + 半透明
                entity.polygon.show = true
                if (entity._fillColor) {
                    const dimmed = entity._fillColor.clone()
                    dimmed.alpha = 0.8
                    entity._dimmedColor = dimmed
                    entity.polygon.material = dimmed
                }
                // 边界线还原白色（无条件，绕过选中判断）
                restoreBorderColor(code)
            }
        }
        selectedProvinceGbCode = selectedGbCode
        highlightedProvinceGbCode = null
    }
    // ================================================================
    //  5b. 选中态：选中市高亮 + 其他市半透明
    // ================================================================
    function setCitySelection(selectedGbCode) {
        const entities = cityDataSource?.entities?.values
        if (!entities) return
        selectedCityGbCode = null
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]
            const code = entity._gbCode
            if (code === selectedGbCode) {
                // 选中省：所有子面填充消失
                entity.polygon.show = false
                entity._dimmedColor = null
            } else {
                entity.polygon.show = true
                if (entity._fillColor) {
                    const dimmed = entity._fillColor.clone()
                    dimmed.alpha = 0.8
                    entity._dimmedColor = dimmed
                    entity.polygon.material = dimmed
                }
            }
        }
        selectedCityGbCode = selectedGbCode
        highlightedCityGbCode = null
    }

    // ================================================================
    //  6a. 取消省选中态
    // ================================================================
    function clearProvinceSelection() {
        const entities = provinceDataSource?.entities?.values
        if (!entities) return
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]
            entity.polygon.show = true
            entity._dimmedColor = null
            if (entity._fillColor) {
                entity.polygon.material = entity._fillColor.clone()
            }
        }
        // 兜底：全量还原所有边界线为白色
        for (const borders of provinceBorderEntities.values()) {
            for (const b of borders) {
                b.polyline.material = b._boundaryColor || Cesium.Color.WHITE
            }
        }
        selectedProvinceGbCode = null
        highlightedProvinceGbCode = null
    }
    // ================================================================
    //  6b. 取消市选中态
    // ================================================================
    function clearCitySelection() {
        const entities = cityDataSource?.entities?.values
        if (!entities) return
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i]
            entity.polygon.show = true
            entity._dimmedColor = null
            if (entity._fillColor) {
                entity.polygon.material = entity._fillColor.clone()
            }
        }
        selectedCityGbCode = null
        highlightedCityGbCode = null
    }

    // ================================================================
    //  7. 统一筛选：等级 + 区域 取交集
    // ================================================================
    /**
     * 整个病树显示/隐藏逻辑的唯一入口。
     *
     * 规则：
     *   全国视图（visibleTreeIds === null）→ 所有病树隐藏
     *   省级视图（visibleTreeIds 是 Set）→
     *     条件 A：treeId 在 Set 中
     *     条件 B：entity.grade === selectedGrade（如果 selectedGrade 不为 null）
     *     最终 show = 条件A AND 条件B
     *
     * 只操作 Entity 模式。Primitive 模式不影响行政区功能。
     */
    function applyAllFilters() {
        const adminStore = useAdminDivisionStore()
        const treeStore = useTreeStore()
        const regionIds = adminStore.visibleTreeIds
        const gradeFilter = treeStore.selectedGrade
        if (!treeState.entities || treeState.entities.length === 0) return
        if (regionIds === null) {
            hideAllTrees()
            return
        }
        for (let i = 0; i < treeState.entities.length; i++) {
            const entity = treeState.entities[i]
            let treeId
            try {
                treeId = entity.properties.treeId.getValue()
            } catch (e) {
                treeId = entity.properties.treeId
            }
            // 条件A ：在该省内
            let show = regionIds.has(treeId)  // O(1) 哈希查找
            // 条件B ：等级筛选
            if (show && gradeFilter !== null) {
                let entityGrade
                try {
                    entityGrade = entity.properties.grade.getValue()
                } catch (e) {
                    entityGrade = entity.properties.grade
                }
                show = (entityGrade === gradeFilter)
            }
            entity.show = show
        }
    }
    // ================================================================
    //  填充面高亮工具（悬停高亮用）
    // ================================================================
    // ---------- 省级 ----------
    function highlightProvinceFill(gbCode) {
        const entityList = provinceEntityMap.get(gbCode)
        if (!entityList) return
        for (const entity of entityList) {
            if (entity.polygon.show === false) continue
            entity.polygon.material = Cesium.Color.GOLD.withAlpha(0.75)
        }
    }
    function restoreProvinceFill(gbCode) {
        if (selectedProvinceGbCode === gbCode) return
        const entityList = provinceEntityMap.get(gbCode)
        if (!entityList) return
        for (const entity of entityList) {
            const target = entity._dimmedColor || entity._fillColor
            if (target) {
                entity.polygon.material = target.clone()
            }
        }
    }
    // ---------- 市级 ----------
    function highlightCityFill(gbCode) {
        const entityList = cityEntityMap.get(gbCode)
        if (!entityList) return
        for (const entity of entityList) {
            if (entity.polygon.show === false) continue
            entity.polygon.material = Cesium.Color.GOLD.withAlpha(0.75)
        }
    }
    function restoreCityFill(gbCode) {
        if (selectedCityGbCode === gbCode) return
        const entityList = cityEntityMap.get(gbCode)
        if (!entityList) return
        for (const entity of entityList) {
            const target = entity._dimmedColor || entity._fillColor
            if (target) {
                entity.polygon.material = target.clone()
            }
        }
    }
    /**
     * 隐藏所有病树 Entity
     * 多处使用，提取为独立函数避免重复代码
     */
    function hideAllTrees() {
        if (!treeState.entities) return
        for (let i = 0; i < treeState.entities.length; i++) {
            treeState.entities[i].show = false
        }
    }
    // ================================================================
    //  8. 返回操作
    // ================================================================
    /**
     *  "返回省级"按钮的回调（市级 → 省级）
     *   1. Store 回退到 province 状态
     *   2. 清除城市选中态，还原城市面样式
     *   3. 隐藏所有病树
     */
    function backToProvince(viewer) {
        const store = useAdminDivisionStore()
        store.backToProvince()
        clearCitySelection()
        applyAllFilters()
        console.log('已返回省级视图')
        // 注意：不清除城市层！城市面仍然显示
    }
    /**
     * "返回全国"按钮的回调（省级/市级 → 全国）
     *   1. Store 回退到 national 状态
     *   2. 清除城市层
     *   3. 还原省样式
     *   4. 隐藏所有病树
     *   5. 飞回全国
     */
    function backToNational(viewer) {
        const store = useAdminDivisionStore()
        store.backToNational()
        removeCityLayer(viewer)
        clearProvinceSelection()
        applyAllFilters()
        flyToNational(viewer)
        console.log('已返回全国视图')
    }
    // ================================================================
    //   清除城市层（dataSource + 边界线 + 映射）
    // ================================================================
    function removeCityLayer(viewer) {
        if (cityDataSource) {
            viewer.dataSources.remove(cityDataSource)
            cityDataSource = null
        }
        clearCityBorderEntities(viewer)
        cityEntityMap.clear()
        selectedCityGbCode = null
        highlightedCityGbCode = null
    }
    /**
     * 相机飞回中国全景
     */
    function flyToNational(viewer) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(103.90, 36.05, 5000000),
            duration: 1.8,
            orientation: {
                heading: 0,
                pitch: Cesium.Math.toRadians(-90.0),
                roll: 0.0,
            },
        })
    }
    /**
     * 飞到某省上空
     *
     * ★ 为什么遍历 provinceEntityMap 数组而不是用单个 entity：
     *   MultiPolygon 省被 Cesium 拆成多个 entity（大陆、每个岛屿各一个），
     *   单个 entity 的 hierarchy 只有它自己的顶点 → 飞到小岛。
     *   合并【该省所有子面】的顶点 → 一定能覆盖整个省。
     *
     * @param {string} gbCode
     * @param {Cesium.Viewer} viewer
     */
    function flyToProvince(gbCode, viewer) {
        // 1. 取出该省所有子面 entity（数组）
        const entityList = provinceEntityMap.get(gbCode)
        if (!entityList || entityList.length === 0) {
            console.warn('未找到省份实体，跳过飞行:', gbCode)
            return
        }
        // 2. 合并所有子面的顶点
        const allPositions = []
        for (const entity of entityList) {
            try {
                const hierarchy = entity.polygon.hierarchy.getValue()
                // push(...数组)：把每个子面的顶点全部展开追加
                allPositions.push(...hierarchy.positions)
            } catch (e) {
                // 单个子面取不到就跳过，不影响其他子面
                continue
            }
        }
        if (allPositions.length === 0) {
            console.warn('省份多边形顶点为空，跳过飞行')
            return
        }
        // 3. 算包围球 + 飞行
        const boundingSphere = Cesium.BoundingSphere.fromPoints(allPositions)
        viewer.camera.flyToBoundingSphere(boundingSphere, {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(0),
                Cesium.Math.toRadians(-90),
                boundingSphere.radius * 2.2
            ),
        })
    }
    /**
     *  飞到某市上空（和 flyToProvince 镜像，操作 cityEntityMap）
     */
    function flyToCity(gbCode, viewer) {
        const entityList = cityEntityMap.get(gbCode)
        if (!entityList || entityList.length === 0) {
            console.warn('未找到城市实体，跳过飞行:', gbCode)
            return
        }
        const allPositions = []
        for (const entity of entityList) {
            try {
                const hierarchy = entity.polygon.hierarchy.getValue()
                allPositions.push(...hierarchy.positions)
            } catch (e) {
                continue
            }
        }
        if (allPositions.length === 0) {
            console.warn('城市多边形顶点为空，跳过飞行')
            return
        }
        const boundingSphere = Cesium.BoundingSphere.fromPoints(allPositions)
        viewer.camera.flyToBoundingSphere(boundingSphere, {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(0),
                Cesium.Math.toRadians(-90),
                boundingSphere.radius * 2.2
            ),
        })
    }
    // ================================================================
    //  9. 切换省市行政区显示/隐藏
    // ================================================================
    function toggleAdminVisibility() {
        // 切换省级数据源
        if (provinceDataSource) {
            provinceDataSource.show = !provinceDataSource.show
        }
        // 切换城市数据源（如果存在）
        if (cityDataSource) {
            cityDataSource.show = !cityDataSource.show
        }
        // 同步切换省边界线
        for (const borders of provinceBorderEntities.values()) {
            for (const b of borders) {
                b.show = provinceDataSource ? provinceDataSource.show : true
            }
        }
        // 同步切换市边界线
        for (const borders of cityBorderEntities.values()) {
            for (const b of borders) {
                b.show = cityDataSource ? cityDataSource.show : true
            }
        }
        console.log('行政区显示已切换')
    }


    return {
        loadProvincesLayer,        // App.vue onMounted 调用（在病树加载之后）
        setupProvinceInteraction,  // App.vue onMounted 调用（在树交互之后）
        applyAllFilters,           // 等级筛选 watch → 省份点击 → 返回全国时调用
        backToNational,            // 返回全国按钮 → provide 到组件
        backToProvince,
        toggleAdminVisibility,
    }


}






