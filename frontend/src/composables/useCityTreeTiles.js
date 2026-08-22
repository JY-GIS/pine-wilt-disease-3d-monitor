import { reactive, readonly } from 'vue'

const Cesium = window.Cesium
const DEFAULT_TILESET_URL = '/tree-tiles/high/tileset.json'

// ★====== version2新增开始 ==========
import {
    getCityTreeTilesConfig,
    supportsCityTreeTiles,
} from '../config/treeTiles.config.js'
// ★----------- version2新增结束 ------------

// ★====== version4新增开始 ==========
import { treeState } from './useDiseasedTrees.js'
// ★----------- version4新增结束 ------------

// ★====== version5新增开始 ==========
/**
 * API 提供后端病树查询地址和统一请求头。
 * useTreeStore 负责把点击结果共享给周边查询面板等 Vue 组件。
 */
import { API } from '../config/api.config.js'
import { useTreeStore } from '../stores/treeStore.js'
// ★----------- version5新增结束 ------------

const state = reactive({
    loading: false,
    loaded: false,
    tilesetUrl: '',
    error: '',

    // ★====== version2新增开始 ==========
    cityGbCode: null,
    cityName: null,
    totalInstances: 0,
    cellCount: 0,
    loadedCellCount: 0,
    // ★----------- version2新增结束 ------------

    // ★====== version3新增开始 ==========
    loadedLowCount: 0,
    loadedHighCount: 0,
    // ★----------- version3新增结束 ------------

    // ★====== version4新增开始 ==========
    enabled: false,
    // ★----------- version4新增结束 ------------

    // ★====== version5新增开始 ==========
    /**
     * selectionLoading 只表示“单树详情请求”是否进行中，不能复用 loading。
     * loading 属于城市 manifest，二者可能在不同时间发生。
     */
    selectionLoading: false,
    selectedTreeId: null,
    selectedDiseaseLevel: null,
    selectionError: '',
    // ★----------- version5新增结束 ------------
})

export function useCityTreeTiles() {
    // ★====== version5新增开始 ==========
    const treeStore = useTreeStore()
    // ★----------- version5新增结束 ------------

    let viewer = null
    let tileset = null

    // ★====== version2新增开始 ==========
    // 配置、服务端 manifest、前端 cell 运行状态分开保存。
    let activeConfig = null
    let manifest = null
    let cellRuntimes = []
    // ★----------- version2新增结束 ------------

    // ★====== version3新增开始 ==========
    let clusterEntities = []
    let removeCameraChanged = null
    let removeCameraMoveEnd = null
    let previousPercentageChanged = null

    // Scratch 对象用于复用高频空间计算的结果容器，减少垃圾回收。
    const scratchToCluster = new Cesium.Cartesian3()
    const scratchWindowPosition = new Cesium.Cartesian2()
    const scratchCellGround = new Cesium.Cartesian3()
    // ★----------- version3新增结束 ------------

    // ★====== version4新增开始 ==========
    /**
     * 城市异步版本令牌：切换或卸载后，旧请求不得再写入场景。
     */
    let runtimeVersion = 0

    // 同城重复调用复用已有 Promise，避免重复请求和重复事件监听。
    let pendingCityGbCode = null
    let pendingCityPromise = null

    // 保存原有病树图层的 show 值，退出 3D Tiles 模式时按原样恢复。
    let previousDataSourceShow = null
    let previousPrimitiveShow = null
    let previousSharedLabelShow = null
    // ★----------- version4新增结束 ------------

    // ★====== version5新增开始 ==========
    /**
     * selectionVersion 是“单树详情查询”的版本令牌。
     * - runtimeVersion 解决城市切换；
     * - selectionVersion 解决用户快速连续点击多棵树。
     */
    let selectionVersion = 0

    /**
     * viewer.screenSpaceEventHandler 的 LEFT_CLICK 同一时刻只能保存一个处理函数。
     * originalLeftClick 保存进入 3D Tiles 模式前的处理函数；
     * treeTilesLeftClick 保存本模块安装的处理函数，退出时据此安全恢复。
     */
    let originalLeftClick = null
    let treeTilesLeftClick = null

    // selectionMarker 是点击病树后创建的金色定位 Entity。
    let selectionMarker = null

    /**
     * 保存当前等级筛选。新 Tileset 是按相机距离异步加载的，
     * 因此不能只筛选“此刻已经存在”的 Tileset，还要让后加载的 Tileset 自动继承同一个筛选条件。
     */
    let activeGradeFilter = null
    // ★----------- version5新增结束 ------------

    function validateViewer(targetViewer) {
        if (!targetViewer || targetViewer.isDestroyed()) {
            throw new Error('Cesium Viewer 尚未初始化或已经销毁')
        }
    }

    // ★====== version2新增开始 ==========
    /** 校验 manifest 的城市、cell 结构和实例总数。 */
    function validateManifest(data, config, city) {
        if (!data || !Array.isArray(data.cells)) {
            throw new Error('城市 3D Tiles manifest 缺少 cells 数组')
        }
        if (String(data.city?.gbCode) !== String(config.gbCode)) {
            throw new Error(
                `manifest 城市编码不一致：` +
                `${data.city?.gbCode} != ${config.gbCode}`
            )
        }
        if (String(data.city?.gbCode) !== String(city.gbCode)) {
            throw new Error(
                `请求城市与 manifest 不一致：` +
                `${city.gbCode} != ${data.city?.gbCode}`
            )
        }
        if (!Number.isInteger(data.totalInstances) || data.totalInstances < 0) {
            throw new Error('manifest.totalInstances 必须是非负整数')
        }

        const cellTreeCount = data.cells.reduce((total, cell) => {
            if (
                !cell.id ||
                !Array.isArray(cell.region) ||
                cell.region.length !== 6 ||
                !Array.isArray(cell.center) ||
                cell.center.length !== 3 ||
                !cell.lowTilesetUrl ||
                !cell.highTilesetUrl
            ) {
                throw new Error(`manifest cell 格式错误：${cell.id || '未知'}`)
            }
            if (!Number.isInteger(cell.treeCount) || cell.treeCount <= 0) {
                throw new Error(`cell.treeCount 非法：${cell.id}`)
            }
            return total + cell.treeCount
        }, 0)

        if (cellTreeCount !== data.totalInstances) {
            throw new Error(
                `manifest 实例数不一致：` +
                `cells=${cellTreeCount}, total=${data.totalInstances}`
            )
        }

        const expectedTreeCount = Number(city.treeCount)
        if (
            Number.isInteger(expectedTreeCount) &&
            expectedTreeCount > 0 &&
            expectedTreeCount !== data.totalInstances
        ) {
            throw new Error(
                `行政区统计与 3D Tiles 实例数不一致：` +
                `${expectedTreeCount} != ${data.totalInstances}`
            )
        }
    }
    // ★----------- version2新增结束 ------------

    // ★====== version3修改开始 ==========
    /**
     * Version 4 将 config 作为参数传入，不再依赖可能被城市切换改写的
     * activeConfig。这样旧请求即使晚返回，解析 URL 时仍使用自己的配置。
     */
    function resolveManifestUrl(relativeUrl, config) {
        const manifestAbsoluteUrl = new URL(
            config.manifestUrl,
            window.location.origin
        )
        return new URL(relativeUrl, manifestAbsoluteUrl).toString()
    }

    async function fetchCityManifest(config) {
        const response = await fetch(config.manifestUrl)
        if (!response.ok) {
            throw new Error(
                `manifest 请求失败：HTTP ${response.status} ` +
                `${response.statusText}`
            )
        }
        return response.json()
    }

    /** 创建包含 cluster、Low、High 状态的 cell runtime。 */
    function initializeCellRuntimes(manifestData, config) {
        cellRuntimes = manifestData.cells.map((cell) => ({
            id: cell.id,
            treeCount: cell.treeCount,
            center: cell.center,
            region: cell.region,
            lowTilesetUrl: resolveManifestUrl(cell.lowTilesetUrl, config),
            highTilesetUrl: resolveManifestUrl(cell.highTilesetUrl, config),
            centerCartesian: Cesium.Cartesian3.fromDegrees(
                cell.center[0],
                cell.center[1],
                cell.center[2]
            ),
            lowTileset: null,
            lowLoadingPromise: null,
            lowReady: false,
            highTileset: null,
            highLoadingPromise: null,
            highReady: false,
            desiredLevel: 'cluster',
            isWithinLowRange: false,
            isWithinHighRange: false,
            clusterEntity: null,
            error: '',
        }))

        state.cellCount = cellRuntimes.length
        state.loadedCellCount = 0
        state.loadedLowCount = 0
        state.loadedHighCount = 0
    }
    // ★----------- version3修改结束 ------------

    // ★====== version3新增开始 ==========
    /** 每个非空 cell 创建一个远景聚合 Entity。 */
    function createClusterEntities() {
        clusterEntities = cellRuntimes.map((cell) => {
            const entity = viewer.entities.add({
                id: `tree-cluster-${cell.id}`,
                name: `病树聚合区域 ${cell.id}`,
                position: cell.centerCartesian,
                show: false,
                model: {
                    uri: activeConfig.cluster.modelUrl,
                    scale: activeConfig.cluster.modelScale,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    shadows: Cesium.ShadowMode.DISABLED,
                },
                label: {
                    text: `${cell.treeCount} 棵`,
                    font: '16px Microsoft YaHei',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    showBackground: true,
                    backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
                    pixelOffset: new Cesium.Cartesian2(
                        0,
                        activeConfig.cluster.labelOffsetY
                    ),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
            cell.clusterEntity = entity
            return entity
        })
    }

    function removeClusterEntities() {
        if (viewer && !viewer.isDestroyed()) {
            clusterEntities.forEach((entity) => {
                viewer.entities.remove(entity)
            })
        }
        clusterEntities = []
        cellRuntimes.forEach((cell) => {
            cell.clusterEntity = null
        })
    }

    /** 用动态属性名统一处理 Low/High 两套运行状态。 */
    function getLodPropertyKeys(level) {
        if (level === 'high') {
            return {
                tilesetKey: 'highTileset',
                loadingKey: 'highLoadingPromise',
                readyKey: 'highReady',
                urlKey: 'highTilesetUrl',
                levelName: 'High',
            }
        }
        return {
            tilesetKey: 'lowTileset',
            loadingKey: 'lowLoadingPromise',
            readyKey: 'lowReady',
            urlKey: 'lowTilesetUrl',
            levelName: 'Low',
        }
    }

    /** 把 null 或 1~5 之外的值统一处理为“不过滤”。 */
    function normalizeGradeFilter(grade) {
        if (grade === null || grade === undefined || grade === '') {
            return null
        }
        const numericGrade = Number(grade)
        return Number.isInteger(numericGrade) &&
            numericGrade >= 1 &&
            numericGrade <= 5
            ? numericGrade
            : null
    }

    /**
     * Cesium3DTileStyle：在 GPU 渲染阶段按结构化 Metadata 决定实例是否显示。
     * 这是 3D Tiles 按属性筛选的 【标准写法】 
     */
    function applyGradeStyleToTileset(targetTileset) {
        if (!targetTileset || !activeConfig) {
            return
        }

        const diseaseLevelProperty =
            activeConfig.metadata.diseaseLevelProperty
        const showExpression = activeGradeFilter === null
            ? true
            : `\${${diseaseLevelProperty}} === ${activeGradeFilter}`

        targetTileset.style = new Cesium.Cesium3DTileStyle({
            show: showExpression,
        })
    }

    /**
     * 同时更新已经加载的 Low/High Tileset，并记录条件供以后懒加载使用。
     */
    function applyGradeFilter(grade) {
        activeGradeFilter = normalizeGradeFilter(grade)

        cellRuntimes.forEach((cell) => {
            applyGradeStyleToTileset(cell.lowTileset)
            applyGradeStyleToTileset(cell.highTileset)
        })

        if (
            activeGradeFilter !== null &&
            state.selectedTreeId !== null &&
            Number(state.selectedDiseaseLevel) !== activeGradeFilter
        ) {
            clearTreeSelection()
        }
    }

    /** 新层级未就绪时继续显示旧层级，避免切换期间出现空白。 */
    function shouldShowLodTileset(cell, level) {
        if (level === 'high') {
            return (
                cell.desiredLevel === 'high' ||
                (cell.desiredLevel === 'low' &&
                    !cell.lowReady &&
                    cell.highReady)
            )
        }
        return (
            cell.desiredLevel === 'low' ||
            (cell.desiredLevel === 'high' &&
                !cell.highReady &&
                cell.lowReady)
        )
    }

    function refreshLoadedCounts() {
        state.loadedLowCount = cellRuntimes.filter(
            (cell) => cell.lowTileset !== null
        ).length
        state.loadedHighCount = cellRuntimes.filter(
            (cell) => cell.highTileset !== null
        ).length
        state.loadedCellCount = cellRuntimes.filter(
            (cell) => cell.lowTileset !== null || cell.highTileset !== null
        ).length
    }
    // ★----------- version3新增结束 ------------

    // ★====== version3修改开始 ==========
    /**
     * 按距离懒加载 Low/High；Version 4 增加运行版本校验，阻止旧城市的
     * 异步 Tileset 在城市切换后加入新场景。
     */
    async function loadLodTileset(cell, level) {
        const keys = getLodPropertyKeys(level)
        if (cell[keys.tilesetKey]) {
            return cell[keys.tilesetKey]
        }
        if (cell[keys.loadingKey]) {
            return cell[keys.loadingKey]
        }

        // ★====== version4新增开始 ==========
        const requestVersion = runtimeVersion
        // ★----------- version4新增结束 ------------

        cell.error = ''
        try {
            cell[keys.loadingKey] = Cesium.Cesium3DTileset.fromUrl(
                cell[keys.urlKey],
                {
                    maximumScreenSpaceError:
                        activeConfig.tileset?.maximumScreenSpaceError ?? 32,
                    dynamicScreenSpaceError:
                        activeConfig.tileset?.dynamicScreenSpaceError ?? true,
                    shadows: activeConfig.tileset?.disableShadows
                        ? Cesium.ShadowMode.DISABLED
                        : Cesium.ShadowMode.ENABLED,
                }
            )

            const loadedTileset = await cell[keys.loadingKey]

            // ★====== version4新增开始 ==========
            // await 后核对城市版本和 cell 身份，旧运行时只能销毁结果。
            if (
                !isRuntimeCurrent(requestVersion) ||
                !cellRuntimes.includes(cell)
            ) {
                loadedTileset.destroy()
                return null
            }
            // ★----------- version4新增结束 ------------

            // 新瓦片必须继承当前筛选，否则移动相机后会重新出现其他等级。
            applyGradeStyleToTileset(loadedTileset)

            loadedTileset.show = shouldShowLodTileset(cell, level)
            cell[keys.tilesetKey] = loadedTileset

            loadedTileset.tileLoad.addEventListener(() => {
                if (cell[keys.readyKey]) {
                    return
                }
                cell[keys.readyKey] = true
                setTimeout(() => {
                    // ★====== version4新增开始 ==========
                    if (!isRuntimeCurrent(requestVersion)) {
                        return
                    }
                    // ★----------- version4新增结束 ------------
                    updateLodByCamera()
                }, 0)
            })
            loadedTileset.tileFailed.addEventListener((tileError) => {
                console.error(
                    `cell ${cell.id} 的 ${keys.levelName} GLB 加载失败：`,
                    tileError.url,
                    tileError.message
                )
            })

            viewer.scene.primitives.add(loadedTileset)
            refreshLoadedCounts()
            return loadedTileset
        } catch (error) {
            if (isRuntimeCurrent(requestVersion)) {
                cell.error = error?.message || String(error)
                console.error(
                    `[useCityTreeTiles:Version4] cell ${cell.id} ` +
                    `${keys.levelName} Tileset 加载失败`,
                    error
                )
            }
            return null
        } finally {
            cell[keys.loadingKey] = null
        }
    }
    // ★----------- version3修改结束 ------------

    // ★====== version3新增开始 ==========
    function isClusterOnScreen(position) {
        Cesium.Cartesian3.subtract(
            position,
            viewer.camera.positionWC,
            scratchToCluster
        )
        if (
            Cesium.Cartesian3.dot(
                viewer.camera.directionWC,
                scratchToCluster
            ) <= 0
        ) {
            return false
        }

        const windowPosition =
            Cesium.SceneTransforms.worldToWindowCoordinates(
                viewer.scene,
                position,
                scratchWindowPosition
            )
        if (!Cesium.defined(windowPosition)) {
            return false
        }

        const canvas = viewer.scene.canvas
        const margin = activeConfig.camera.screenMarginPixels
        return (
            windowPosition.x >= -margin &&
            windowPosition.x <= canvas.clientWidth + margin &&
            windowPosition.y >= -margin &&
            windowPosition.y <= canvas.clientHeight + margin
        )
    }

    /** 计算相机到 cell 地表矩形的最近距离，而不是到中心点的距离。 */
    function getCameraDistanceToCell(camera, cell) {
        const [west, south, east, north] = cell.region
        const cameraPosition = camera.positionCartographic
        const nearestLongitude = Cesium.Math.clamp(
            cameraPosition.longitude,
            west,
            east
        )
        const nearestLatitude = Cesium.Math.clamp(
            cameraPosition.latitude,
            south,
            north
        )
        Cesium.Cartesian3.fromRadians(
            nearestLongitude,
            nearestLatitude,
            0,
            Cesium.Ellipsoid.WGS84,
            scratchCellGround
        )
        return Cesium.Cartesian3.distance(
            camera.positionWC,
            scratchCellGround
        )
    }

    /**
     * 核心 LOD：远处 cluster，中距离 Low，近距离 High；进入与退出阈值
     * 不同，形成迟滞区间，避免相机在边界附近导致层级反复闪烁。
     */
    function updateLodByCamera() {
        if (!viewer || viewer.isDestroyed() || !activeConfig) {
            return
        }

        const camera = viewer.camera
        const distanceConfig = activeConfig.lodDistance
        cellRuntimes.forEach((cell) => {
            const distance = getCameraDistanceToCell(camera, cell)

            if (cell.isWithinLowRange) {
                cell.isWithinLowRange =
                    distance < distanceConfig.lowExitMeters
            } else {
                cell.isWithinLowRange =
                    distance <= distanceConfig.lowEnterMeters
            }
            if (cell.isWithinHighRange) {
                cell.isWithinHighRange =
                    distance < distanceConfig.highExitMeters
            } else {
                cell.isWithinHighRange =
                    distance <= distanceConfig.highEnterMeters
            }

            if (!cell.isWithinLowRange) {
                cell.desiredLevel = 'cluster'
            } else if (cell.isWithinHighRange) {
                cell.desiredLevel = 'high'
            } else {
                cell.desiredLevel = 'low'
            }

            if (cell.desiredLevel === 'low') {
                loadLodTileset(cell, 'low')
            } else if (cell.desiredLevel === 'high') {
                loadLodTileset(cell, 'high')
            }

            if (cell.lowTileset) {
                cell.lowTileset.show = shouldShowLodTileset(cell, 'low')
            }
            if (cell.highTileset) {
                cell.highTileset.show = shouldShowLodTileset(cell, 'high')
            }

            let hasReadyFallback = false
            if (cell.desiredLevel === 'low') {
                hasReadyFallback = cell.lowReady || cell.highReady
            } else if (cell.desiredLevel === 'high') {
                hasReadyFallback = cell.highReady || cell.lowReady
            }

            cell.clusterEntity.show =
                isClusterOnScreen(cell.centerCartesian) &&
                (cell.desiredLevel === 'cluster' || !hasReadyFallback)
        })

        viewer.scene.requestRender()
    }

    function setupLodCameraListeners() {
        previousPercentageChanged = viewer.camera.percentageChanged
        viewer.camera.percentageChanged =
            activeConfig.camera.percentageChanged
        removeCameraChanged = viewer.camera.changed.addEventListener(
            updateLodByCamera
        )
        removeCameraMoveEnd = viewer.camera.moveEnd.addEventListener(
            updateLodByCamera
        )
        updateLodByCamera()
    }

    function removeLodCameraListeners() {
        if (removeCameraChanged) {
            removeCameraChanged()
            removeCameraChanged = null
        }
        if (removeCameraMoveEnd) {
            removeCameraMoveEnd()
            removeCameraMoveEnd = null
        }
        if (viewer && previousPercentageChanged !== null) {
            viewer.camera.percentageChanged = previousPercentageChanged
        }
        previousPercentageChanged = null
    }
    // ★----------- version3新增结束 ------------

    // ★====== version3修改开始 ==========
    /** 移除当前城市已经加入场景的全部 Low/High Tileset。 */
    function removeCellTilesets() {
        if (viewer && !viewer.isDestroyed()) {
            cellRuntimes.forEach((cell) => {
                if (cell.lowTileset) {
                    viewer.scene.primitives.remove(cell.lowTileset)
                }
                if (cell.highTileset) {
                    viewer.scene.primitives.remove(cell.highTileset)
                }
            })
        }
        cellRuntimes = []
        manifest = null
        activeConfig = null
    }
    // ★----------- version3修改结束 ------------

    // ★====== version5新增开始 ==========
    /**
     * 从被点击的 Cesium3DTileFeature 中读取业务 Metadata。
     */
    function readTreeFeatureMetadata(feature) {
        const businessIdProperty =
            activeConfig.metadata.businessIdProperty
        const diseaseLevelProperty =
            activeConfig.metadata.diseaseLevelProperty

        if (!feature.hasProperty(businessIdProperty)) {
            throw new Error(
                `被点击实例缺少 Metadata：${businessIdProperty}`
            )
        }

        const rawTreeId = feature.getProperty(businessIdProperty)
        if (
            rawTreeId === null ||
            rawTreeId === undefined ||
            String(rawTreeId).length === 0
        ) {
            throw new Error('被点击实例的 tree_id 为空')
        }

        let diseaseLevel = null
        if (feature.hasProperty(diseaseLevelProperty)) {
            diseaseLevel = feature.getProperty(diseaseLevelProperty)
        }

        return {
            treeId: String(rawTreeId),
            diseaseLevel: diseaseLevel,
        }
    }

    /**
     * 根据业务 tree_id 请求 Spring Boot 中的病树详情。
     *
     * encodeURIComponent(value)：把树编号中的空格、中文、斜杠等特殊字符
     * 转义成安全的 URL 参数，避免它们破坏查询字符串。
     */
    async function fetchTreeDetail(treeId) {
        const safeTreeId = encodeURIComponent(treeId)
        const response = await fetch(API.searchTreeById(safeTreeId), {
            method: 'GET',
            headers: API.getHeaders(),
        })

        if (!response.ok) {
            throw new Error(
                `病树详情请求失败：HTTP ${response.status} ` +
                `${response.statusText}`
            )
        }

        const result = await response.json()

        /**
         * Array.isArray() 确认 result.data 真的是数组。
         * 现有 searchTreeById 接口即使只查一棵树，也返回数组，
         * 所以必须读取 result.data[0]，不能直接把 result.data 当病树对象。
         */
        if (
            result.code !== 1 ||
            !Array.isArray(result.data) ||
            result.data.length === 0
        ) {
            throw new Error(result.msg || result.message || '未找到该病树')
        }

        return result.data[0]
    }

    /** 移除上一次点击创建的金色标记。 */
    function removeSelectionMarker() {
        if (
            selectionMarker &&
            viewer &&
            !viewer.isDestroyed()
        ) {
            viewer.entities.remove(selectionMarker)
        }
        selectionMarker = null
    }

    /**
     * 在后端返回的真实经纬度位置创建选中标记。
     *
     * 为什么不用鼠标点击位置：scene.pickPosition() 得到的是模型表面位置，
     * 可能受树模型缩放和枝叶几何影响；数据库经纬度才是业务树木的位置。
     */
    function createSelectionMarker(tree, metadata) {
        const longitude = Number(tree.longitude)
        const latitude = Number(tree.latitude)

        /**
         * Number.isFinite() 只接受有限数字，会排除 NaN、Infinity 和
         * -Infinity。坐标非法时不创建 Entity，避免 Cesium 内部计算报错。
         */
        if (
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude)
        ) {
            state.selectionError = '后端病树详情缺少合法经纬度'
            return null
        }

        removeSelectionMarker()

        const businessTreeId = tree.treeId || metadata.treeId
        const diseaseLevel = tree.grade ?? metadata.diseaseLevel

        const labelText = [
            `ID: ${businessTreeId}`,
            `树种: ${tree.species || '未知'}`,
            `等级: ${diseaseLevel ?? '未知'}级`,
            `胸径: ${tree.chest ?? '未知'}cm`,
        ].join('\n')

        selectionMarker = viewer.entities.add({
            id: 'city-tree-tiles-selection-marker',
            position: Cesium.Cartesian3.fromDegrees(
                longitude,
                latitude
            ),
            point: {
                pixelSize: 12,
                color: Cesium.Color.GOLD,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
                text: labelText,
                font: '12px Microsoft YaHei',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })

        return selectionMarker
    }

    function writeTreeDetailToStore(tree, metadata) {
        const businessTreeId = tree.treeId || metadata.treeId
        const diseaseLevel = tree.grade ?? metadata.diseaseLevel

        treeStore.selectedTreeId = businessTreeId

        /**
         * 3D Tiles 中的一棵树是 GPU Instance，不是独立 Entity；
         * 当前不能通过 viewer.entities.remove() 单独删除，所以不显示删除按钮。
         */
        treeStore.showDeleteButton = false

        treeStore.setCenterTreeInfo({
            treeId: businessTreeId,
            species: tree.species,
            grade: diseaseLevel,
            lng: Number(tree.longitude),
            lat: Number(tree.latitude),
            chest: tree.chest,
        })
    }

    function clearTreeSelection() {
        selectionVersion += 1
        removeSelectionMarker()

        state.selectionLoading = false
        state.selectedTreeId = null
        state.selectedDiseaseLevel = null
        state.selectionError = ''

        treeStore.selectedTreeId = null
        treeStore.showDeleteButton = false
        treeStore.clearNearbyResults()
    }

    /**
     * 完成一次“Metadata → 后端详情 → Store → Cesium标记”的业务闭环。
     */
    async function selectTreeFeature(feature) {
        let metadata
        try {
            metadata = readTreeFeatureMetadata(feature)
        } catch (error) {
            clearTreeSelection()
            state.selectionError = error?.message || String(error)
            return null
        }

        removeSelectionMarker()
        treeStore.clearNearbyResults()
        treeStore.selectedTreeId = null
        treeStore.showDeleteButton = false

        selectionVersion += 1
        const requestSelectionVersion = selectionVersion
        const requestRuntimeVersion = runtimeVersion

        state.selectionLoading = true
        state.selectedTreeId = metadata.treeId
        state.selectedDiseaseLevel = metadata.diseaseLevel
        state.selectionError = ''

        try {
            const tree = await fetchTreeDetail(metadata.treeId)

            /**
             * 这里要同时校验两个版本：
             * - selectionVersion 保证结果仍属于最后一次点击；
             * - runtimeVersion 保证结果仍属于当前城市。
             */
            if (
                requestSelectionVersion !== selectionVersion ||
                !isRuntimeCurrent(requestRuntimeVersion)
            ) {
                return null
            }

            writeTreeDetailToStore(tree, metadata)
            state.selectedDiseaseLevel = tree.grade ?? metadata.diseaseLevel
            createSelectionMarker(tree, metadata)
            state.selectionLoading = false
            return tree
        } catch (error) {
            if (
                requestSelectionVersion === selectionVersion &&
                isRuntimeCurrent(requestRuntimeVersion)
            ) {
                state.selectionLoading = false
                state.selectionError =
                    `病树详情查询失败：${error?.message || error}`
            }
            return null
        }
    }

    /**
     * 处理 3D Tiles 模式下的左键点击。
     */
    function handleTreeTilesLeftClick(click) {
        const picked = viewer.scene.pick(click.position)

        const businessIdProperty =
            activeConfig?.metadata?.businessIdProperty

        if (
            picked instanceof Cesium.Cesium3DTileFeature &&
            businessIdProperty &&
            picked.hasProperty(businessIdProperty)
        ) {
            selectTreeFeature(picked)
            return
        }

        clearTreeSelection()

        // 没点到病树实例时继续执行原处理器，保证城市、省份和普通 Entity 的点击功能不被 3D Tiles 模式吞掉
        if (originalLeftClick) {
            originalLeftClick(click)
        }
    }

    /**
     * 接管 Viewer 已有的 LEFT_CLICK。
     */
    function ensureTreeTilesPicking() {
        if (
            !state.enabled ||
            !state.loaded ||
            !viewer ||
            viewer.isDestroyed()
        ) {
            return false
        }

        const handler = viewer.screenSpaceEventHandler
        if (!handler || handler.isDestroyed()) {
            throw new Error('Cesium ScreenSpaceEventHandler 不可用')
        }

        const leftClickType = Cesium.ScreenSpaceEventType.LEFT_CLICK
        if (!treeTilesLeftClick) {
            treeTilesLeftClick = handleTreeTilesLeftClick
        }

        const currentLeftClick = handler.getInputAction(leftClickType) || null
        if (currentLeftClick === treeTilesLeftClick) {
            return true
        }

        originalLeftClick = currentLeftClick
        handler.setInputAction(treeTilesLeftClick, leftClickType)
        return true
    }

    /**
     * 释放 Picking 并恢复进入 3D Tiles 模式前的 LEFT_CLICK。
     */
    function removeTreeTilesPicking() {
        if (viewer && !viewer.isDestroyed()) {
            const handler = viewer.screenSpaceEventHandler
            if (handler && !handler.isDestroyed()) {
                const leftClickType =
                    Cesium.ScreenSpaceEventType.LEFT_CLICK
                const currentLeftClick =
                    handler.getInputAction(leftClickType)

                if (currentLeftClick === treeTilesLeftClick) {
                    handler.removeInputAction(leftClickType)
                    if (originalLeftClick) {
                        handler.setInputAction(
                            originalLeftClick,
                            leftClickType
                        )
                    }
                }
            }
        }

        originalLeftClick = null
        treeTilesLeftClick = null
        clearTreeSelection()
    }
    // ★----------- version5新增结束 ------------

    // ★====== version4新增开始 ==========
    /** 判断异步结果是否仍属于当前城市运行环境。 */
    function isRuntimeCurrent(version) {
        return (
            version === runtimeVersion &&
            viewer !== null &&
            !viewer.isDestroyed()
        )
    }

    /** 增加版本号，让旧 fetch 和旧 Tileset 请求失去写入资格。 */
    function invalidateRuntime() {
        runtimeVersion += 1
        pendingCityGbCode = null
        pendingCityPromise = null
    }

    /** 清空当前城市相关的响应式状态，但不修改 enabled。 */
    function resetCityState() {
        state.loading = false
        state.loaded = false
        state.tilesetUrl = ''
        state.error = ''
        state.cityGbCode = null
        state.cityName = null
        state.totalInstances = 0
        state.cellCount = 0
        state.loadedCellCount = 0
        state.loadedLowCount = 0
        state.loadedHighCount = 0

        // ★====== version5新增开始 ==========
        state.selectionLoading = false
        state.selectedTreeId = null
        state.selectedDiseaseLevel = null
        state.selectionError = ''
        // ★----------- version5新增结束 ------------
    }

    /** 隐藏旧病树图层，并保存进入模式前的真实 show 值。 */
    function hideLegacyTreeLayer() {
        if (treeState.dataSource) {
            if (previousDataSourceShow === null) {
                previousDataSourceShow = treeState.dataSource.show
            }
            treeState.dataSource.show = false
        }

        if (treeState.pointPrimitiveCollection) {
            if (previousPrimitiveShow === null) {
                previousPrimitiveShow =
                    treeState.pointPrimitiveCollection.show
            }
            treeState.pointPrimitiveCollection.show = false
        }

        if (treeState.sharedLabelEntity?.label) {
            if (previousSharedLabelShow === null) {
                previousSharedLabelShow =
                    treeState.sharedLabelEntity.label.show
            }
            treeState.sharedLabelEntity.label.show = false
        }
    }

    /** 恢复旧图层进入 3D Tiles 模式前的显示状态。 */
    function restoreLegacyTreeLayer() {
        if (treeState.dataSource && previousDataSourceShow !== null) {
            treeState.dataSource.show = previousDataSourceShow
        }
        if (
            treeState.pointPrimitiveCollection &&
            previousPrimitiveShow !== null
        ) {
            treeState.pointPrimitiveCollection.show = previousPrimitiveShow
        }
        if (
            treeState.sharedLabelEntity?.label &&
            previousSharedLabelShow !== null
        ) {
            treeState.sharedLabelEntity.label.show = previousSharedLabelShow
        }

        previousDataSourceShow = null
        previousPrimitiveShow = null
        previousSharedLabelShow = null
    }

    /**
     * 只释放 Cesium 资源，不改变 enabled，也不恢复旧病树图层。
     * 城市 A 切换到城市 B 时要使用它，因为 3D Tiles 模式仍然开启。
     */
    function releaseCurrentResources() {
        // ★====== version4修改开始 ==========
        /**
         * Version 5 增加 Picking，所以它必须最先释放：此时 Viewer 仍有效，
         * 可以安全移除选择标记并恢复原 LEFT_CLICK。
         */
        removeTreeTilesPicking()
        // ★----------- version4修改结束 ------------

        removeLodCameraListeners()
        removeClusterEntities()
        removeCellTilesets()

        if (tileset && viewer && !viewer.isDestroyed()) {
            viewer.scene.primitives.remove(tileset)
        }
        tileset = null
    }

    /**
     * 停止当前城市并恢复普通病树模式。
     * 释放顺序是：异步令牌 → 事件 → Entity → Tileset → 旧图层恢复。
     */
    function unloadCurrentCity() {
        invalidateRuntime()
        releaseCurrentResources()
        viewer = null
        resetCityState()
        restoreLegacyTreeLayer()
        state.enabled = false
    }

    /** 执行 manifest 请求；拆出后可让重复调用复用同一个 Promise。 */
    async function performCityLoad(config, city, loadVersion) {
        try {
            const manifestData = await fetchCityManifest(config)

            if (!isRuntimeCurrent(loadVersion)) {
                return null
            }

            validateManifest(manifestData, config, city)
            manifest = manifestData
            activeConfig = config
            state.totalInstances = manifestData.totalInstances
            initializeCellRuntimes(manifestData, config)
            createClusterEntities()

            state.loading = false
            state.loaded = true
            setupLodCameraListeners()

            // ★====== version4修改开始 ==========
            /**
             * LOD 和场景对象初始化完成后才能安装 Picking；
             * 如果提前安装，用户可能点击到尚未准备好的旧场景对象。
             */
            ensureTreeTilesPicking()
            // ★----------- version4修改结束 ------------

            return cellRuntimes
        } catch (error) {
            if (!isRuntimeCurrent(loadVersion)) {
                return null
            }

            const message =
                `城市病树 3D Tiles 加载失败：${error?.message || error}`
            invalidateRuntime()
            releaseCurrentResources()
            viewer = null
            resetCityState()
            restoreLegacyTreeLayer()
            state.enabled = false
            state.error = message
            console.error('[useCityTreeTiles:Version4]', error)
            return null
        } finally {
            if (loadVersion === runtimeVersion) {
                pendingCityGbCode = null
                pendingCityPromise = null
            }
        }
    }

    /**
     * 加载或切换城市。
     *
     * 三种分支：
     * 1. 当前城市已经加载：直接返回现有 runtime；
     * 2. 相同城市正在加载：返回同一个 pending Promise；
     * 3. 新城市：旧版本失效、释放旧资源，再开始新请求。
     */
    async function loadCity(targetViewer, city) {
        validateViewer(targetViewer)

        if (!city || !city.gbCode) {
            state.error = '缺少城市对象或 city.gbCode'
            return null
        }

        const cityGbCode = String(city.gbCode)
        const config = getCityTreeTilesConfig(cityGbCode)
        if (!config) {
            state.error = `城市 ${cityGbCode} 暂无病树 3D Tiles 数据`
            return null
        }

        if (
            state.loaded &&
            state.cityGbCode === cityGbCode &&
            viewer === targetViewer
        ) {
            return cellRuntimes
        }

        if (
            pendingCityGbCode === cityGbCode &&
            pendingCityPromise &&
            viewer === targetViewer
        ) {
            return pendingCityPromise
        }

        invalidateRuntime()
        releaseCurrentResources()
        resetCityState()

        viewer = targetViewer
        activeConfig = config
        // 先读取全局筛选状态，保证第一批异步加载的 Tileset 不会短暂显示错等级。
        activeGradeFilter = normalizeGradeFilter(treeStore.selectedGrade)
        state.enabled = true
        state.loading = true
        state.cityGbCode = cityGbCode
        state.cityName = city.name || config.name
        state.tilesetUrl = config.manifestUrl
        hideLegacyTreeLayer()

        const loadVersion = runtimeVersion
        pendingCityGbCode = cityGbCode
        pendingCityPromise = performCityLoad(config, city, loadVersion)
        return pendingCityPromise
    }

    /**
     * 根据行政区 Store 当前状态同步 3D Tiles。
     */
    async function syncCityTreeTiles(targetViewer, viewLevel, city) {
        if (!state.enabled) {
            return null
        }

        if (viewLevel !== 'city' || !city) {
            suspendCurrentCity('请选择城市后加载病树 3D Tiles')
            return null
        }
        if (!supportsCityTreeTiles(city.gbCode)) {
            suspendCurrentCity(
                `${city.name || '当前城市'}暂无病树 3D Tiles 数据`
            )
            return null
        }
        return loadCity(targetViewer, city)
    }

    /**
     * 用户点击树木按钮时调用：已开启则关闭，未开启则加载当前城市。
     * 返回布尔值，true 表示最终处于开启状态，false 表示关闭或加载失败。
     */
    async function toggleCityTreeTiles(targetViewer, viewLevel, city) {
        if (state.enabled) {
            disableCityTreeTiles()
            return false
        }

        validateViewer(targetViewer)
        state.enabled = true
        state.error = ''

        if (viewLevel !== 'city' || !city) {
            state.error = '请选择城市后加载病树 3D Tiles'
            return true
        }
        if (!supportsCityTreeTiles(city.gbCode)) {
            state.error = `${city.name || '当前城市'}暂无病树 3D Tiles 数据`
            return true
        }

        const result = await loadCity(targetViewer, city)
        return result !== null && state.enabled
    }

    /**
     * 暂停当前城市资源，但保留 enabled=true。
     * 这样用户可以先开按钮再选青岛，也可以离开市级后再进入其他城市。
     */
    function suspendCurrentCity(message = '') {
        invalidateRuntime()
        releaseCurrentResources()
        viewer = null
        resetCityState()
        restoreLegacyTreeLayer()
        state.enabled = true
        state.error = message
    }

    /** 明确关闭城市 3D Tiles 模式。 */
    function disableCityTreeTiles() {
        unloadCurrentCity()
    }
    // ★----------- version4新增结束 ------------

    // ★====== version3修改开始 ==========
    /** Version 1 Demo 加载仍保留，但也接入 Version 4 的统一失效与释放。 */
    async function loadTreeTiles(
        targetViewer,
        tilesetUrl = DEFAULT_TILESET_URL
    ) {
        validateViewer(targetViewer)
        unloadCurrentCity()

        viewer = targetViewer
        state.loading = true
        state.tilesetUrl = tilesetUrl
        const loadVersion = runtimeVersion

        try {
            const loadedTileset =
                await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
                    maximumScreenSpaceError: 32,
                })
            if (!isRuntimeCurrent(loadVersion)) {
                loadedTileset.destroy()
                return null
            }
            tileset = loadedTileset
            viewer.scene.primitives.add(tileset)
            state.loading = false
            state.loaded = true
            viewer.flyTo(tileset, { duration: 2 })
            return tileset
        } catch (error) {
            if (isRuntimeCurrent(loadVersion)) {
                state.loading = false
                state.error =
                    `病树 3D Tiles 加载失败：${error?.message || error}`
                console.error('[useCityTreeTiles:Version1]', error)
            }
            return null
        }
    }

    function unloadTreeTiles() {
        unloadCurrentCity()
    }

    function destroyCityTreeTiles() {
        disableCityTreeTiles()
    }
    // ★----------- version3修改结束 ------------

    return {
        state: readonly(state),
        loadTreeTiles,
        unloadTreeTiles,
        destroyCityTreeTiles,
        supportsCityTreeTiles,
        loadCity,
        unloadCurrentCity,
        updateLodByCamera,
        applyGradeFilter,
        ensureTreeTilesPicking,

        // ★====== version4新增开始 ==========
        syncCityTreeTiles,
        toggleCityTreeTiles,
        disableCityTreeTiles,
        // ★----------- version4新增结束 ------------

        // ★====== version5新增开始 ==========
        /**
         * selectTreeFeature 主要供自动测试或调试直接传入 Feature；
         * 正常页面操作由 LEFT_CLICK 自动调用。
         */
        selectTreeFeature,
        clearTreeSelection,
        // ★----------- version5新增结束 ------------
    }
}
