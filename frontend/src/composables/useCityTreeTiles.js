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
})

export function useCityTreeTiles() {
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
     * runtimeVersion 是当前城市运行环境的“版本号令牌”。
     *
     * 每次开始加载、切换城市或卸载时都让它加 1。异步操作开始时保存
     * 自己看到的版本号，await 返回后再次比较：
     * - 相等：结果仍属于当前城市，可以写入场景；
     * - 不相等：用户已经切换或退出，旧结果必须丢弃。
     */
    let runtimeVersion = 0

    /**
     * pendingCityGbCode：正在请求 manifest 的城市编码。
     * pendingCityPromise：这次城市加载任务对应的 Promise。
     *
     * 同一城市被连续触发时，后续调用直接复用已有 Promise，既不重复 fetch，
     * 也不会重复创建 cluster 和相机监听器。
     */
    let pendingCityGbCode = null
    let pendingCityPromise = null

    // 保存原有病树图层的 show 值，退出 3D Tiles 模式时按原样恢复。
    let previousDataSourceShow = null
    let previousPrimitiveShow = null
    let previousSharedLabelShow = null
    // ★----------- version4新增结束 ------------

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
            /**
             * Array.includes(value) 使用严格相等判断数组中是否包含该对象。
             * 这里不仅检查版本号，还检查 cell 对象仍属于当前 cellRuntimes，
             * 防止已被替换的旧 runtime 写回场景。
             */
            if (
                !isRuntimeCurrent(requestVersion) ||
                !cellRuntimes.includes(cell)
            ) {
                loadedTileset.destroy()
                return null
            }
            // ★----------- version4新增结束 ------------

            loadedTileset.show = shouldShowLodTileset(cell, level)
            cell[keys.tilesetKey] = loadedTileset

            loadedTileset.tileLoad.addEventListener(() => {
                if (cell[keys.readyKey]) {
                    return
                }
                cell[keys.readyKey] = true
                setTimeout(() => {
                    // ★====== version4新增开始 ==========
                    // 延迟回调执行前再次核对版本，旧城市不再触发 LOD 更新。
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
            // 旧请求失败不应覆盖新城市的错误信息。
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

    // ★====== version4新增开始 ==========
    /**
     * 判断一个异步结果是否仍属于当前运行环境。
     *
     * && 表示三个条件必须全部成立：版本一致、Viewer 存在、Viewer 未销毁。
     * 把判断集中在一个函数中，可以避免各异步回调写出不同的校验标准。
     */
    function isRuntimeCurrent(version) {
        return (
            version === runtimeVersion &&
            viewer !== null &&
            !viewer.isDestroyed()
        )
    }

    /**
     * 让所有旧异步任务立即失效。
     * JavaScript 无法直接取消已经发出的普通 fetch，但可以让返回结果失去写入资格，这种做法常称为“逻辑取消”或“版本令牌”。
     */
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
    }

    /**
     * 隐藏旧病树图层，并只在第一次隐藏时保存原始 show 值。
     *
     * null 在这里是“尚未备份”的哨兵值。原始 show 可能本来就是 false，
     * 所以不能用 if (!previousDataSourceShow) 判断是否已经备份。
     */
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

    /**
     * 真正执行 manifest 请求和城市运行时初始化。
     * 单独拆出这个函数，loadCity() 才能把 Promise 保存下来供重复调用复用。
     */
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
            return cellRuntimes
        } catch (error) {
            /**
             * 旧请求的失败同样不能覆盖新城市状态。
             * 如果版本已经失效，安静返回 null 即可。
             */
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
        if (
            viewLevel !== 'city' ||
            !city ||
            !supportsCityTreeTiles(city.gbCode)
        ) {
            disableCityTreeTiles()
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
        if (viewLevel !== 'city' || !city) {
            state.error = '只有进入市级视图后才能开启城市病树 3D Tiles'
            return false
        }
        if (!supportsCityTreeTiles(city.gbCode)) {
            state.error = `${city.name || '当前城市'}暂无病树 3D Tiles 数据`
            return false
        }

        const result = await loadCity(targetViewer, city)
        return result !== null && state.enabled
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

        // ★====== version4新增开始 ==========
        syncCityTreeTiles,
        toggleCityTreeTiles,
        disableCityTreeTiles,
        // ★----------- version4新增结束 ------------
    }
}
