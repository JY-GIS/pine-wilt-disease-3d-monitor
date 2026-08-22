import { reactive, readonly } from 'vue'

const Cesium = window.Cesium

// Version 1：单 Tileset Demo 的默认地址。
const DEFAULT_TILESET_URL = '/tree-tiles/high/tileset.json'

// ★====== version2新增开始 ==========
import {
    getCityTreeTilesConfig,
    supportsCityTreeTiles,
} from '../config/treeTiles.config.js'
// ★----------- version2新增结束 ------------

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
})

export function useCityTreeTiles() {
    let viewer = null
    let tileset = null

    // ★====== version2新增开始 ==========
    let activeConfig = null
    let manifest = null
    let cellRuntimes = []
    // ★----------- version2新增结束 ------------

    // ★====== version3新增开始 ==========
    /**
     * clusterEntities 保存远景聚合树 Entity
     */
    let clusterEntities = []

    /**
     * Cesium.Event.addEventListener() 会返回一个“取消监听函数”。
     * 把它保存下来，卸载城市时调用，防止重复进入城市后监听器越来越多。
     */
    let removeCameraChanged = null
    let removeCameraMoveEnd = null

    // 保存 Cesium 相机原来的触发阈值，退出病树模式时必须恢复。
    let previousPercentageChanged = null

    /**
     * Scratch 对象是可重复使用的临时计算容器。
     *
     * 相机移动会多次执行 LOD 计算。如果每次都 new Cartesian2/Cartesian3，
     * 会不断产生短命对象并增加垃圾回收压力；复用对象可减少这类开销。
     */
    const scratchToCluster = new Cesium.Cartesian3()
    const scratchWindowPosition = new Cesium.Cartesian2()
    const scratchCellGround = new Cesium.Cartesian3()
    // ★----------- version3新增结束 ------------

    function validateViewer(targetViewer) {
        if (!targetViewer || targetViewer.isDestroyed()) {
            throw new Error('Cesium Viewer 尚未初始化或已经销毁')
        }
    }

    // ★====== version2新增开始 ==========
    /**
     * 校验 manifest 的城市、cell 结构和树木总数。
     * 外部 JSON 必须先校验，再交给 Cesium 使用。
     */
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

    /**
     * cell URL 必须以 manifest 文件地址为基准进行解析，不能直接拼接网站根路径。
     */
    function resolveManifestUrl(relativeUrl) {
        const manifestAbsoluteUrl = new URL(
            activeConfig.manifestUrl,
            window.location.origin
        )
        return new URL(relativeUrl, manifestAbsoluteUrl).toString()
    }

    /**
     * fetch() 对 404/500 不会自动抛错，所以必须主动检查 response.ok。
     */
    async function fetchCityManifest() {
        const response = await fetch(activeConfig.manifestUrl)
        if (!response.ok) {
            throw new Error(
                `manifest 请求失败：HTTP ${response.status} ` +
                `${response.statusText}`
            )
        }
        return response.json()
    }
    // ★----------- version2新增结束 ------------

    // ★====== version2修改开始 ==========
    /**
     * Version 2 仍负责把 manifest cell 转换成前端 runtime cell；
     * 但不再只保存一个 High Tileset，而是为 Version 3 准备 Low/High URL。
     */
    function initializeCellRuntimes() {
        cellRuntimes = manifest.cells.map((cell) => {
            const runtime = {
                id: cell.id,
                treeCount: cell.treeCount,
                center: cell.center,
                region: cell.region,
                lowTilesetUrl: resolveManifestUrl(cell.lowTilesetUrl),
                highTilesetUrl: resolveManifestUrl(cell.highTilesetUrl),

                // ★====== version3新增开始 ==========
                /**
                 * centerCartesian 是 cell 中心经纬度转换后的地心笛卡尔坐标
                 */
                centerCartesian: Cesium.Cartesian3.fromDegrees(
                    cell.center[0],  // 经度
                    cell.center[1],  // 纬度
                    cell.center[2]   // 高度
                ),

                // Low 与 High 各自保存 Tileset、加载 Promise 和内容就绪状态。
                lowTileset: null,
                lowLoadingPromise: null,
                lowReady: false,
                highTileset: null,
                highLoadingPromise: null,
                highReady: false,

                /**
                 * desiredLevel 表示调度系统“希望显示”的层级：
                 * cluster = 远景聚合树；low = 低精度；high = 高精度。
                 */
                desiredLevel: 'cluster',

                /**
                 * 这两个布尔值记录上一次距离判断结果。
                 * 它们是实现“迟滞区间”的记忆状态，不能只用当前距离临时计算。
                 */
                isWithinLowRange: false,
                isWithinHighRange: false,

                // 每个 cell 对应一个远景聚合 Entity。
                clusterEntity: null,
                error: '',
                // ★----------- version3新增结束 ------------
            }

            return runtime
        })

        state.cellCount = cellRuntimes.length
        state.loadedCellCount = 0
        state.loadedLowCount = 0
        state.loadedHighCount = 0
    }
    // ★----------- version2修改结束 ------------

    // ★====== version3新增开始 ==========
    /**
     * 为每个非空 cell 创建一个远景聚合树
     */
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

    /**
     * 根据 level 找出 runtime cell 中对应的属性名。
     *
     * cell[tilesetKey] 称为“方括号动态属性访问”：
     * 当属性名保存在变量里时使用。例如 tilesetKey 是 'lowTileset'，
     * cell[tilesetKey] 就等价于 cell.lowTileset。
     */
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

    /**
     * 判断某一级 Tileset 当前是否应该显示。
     * 除了直接匹配 desiredLevel，还保留“无空白兜底”：
     * 这能避免网络加载期间树木突然消失。
     */
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

    /**
     * 重新统计已加载的 Low/High Tileset。
     */
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

    /**
     * 首次进入某个距离范围时，懒加载指定 cell 的 Low 或 High Tileset
     */
    async function loadLodTileset(cell, level) {
        const keys = getLodPropertyKeys(level)

        /**
         * 如果 Tileset 已存在，说明加载完成；如果 loadingPromise 存在，说明相同请求正在进行
         */
        if (cell[keys.tilesetKey]) {
            return cell[keys.tilesetKey]
        }
        if (cell[keys.loadingKey]) {
            return cell[keys.loadingKey]
        }

        cell.error = ''

        try {
            cell[keys.loadingKey] = Cesium.Cesium3DTileset.fromUrl(
                cell[keys.urlKey],
                {
                    maximumScreenSpaceError:
                        activeConfig.tileset?.maximumScreenSpaceError ?? 32,

                    /**
                     * dynamicScreenSpaceError 会根据相机和场景状态动态放宽
                     * 远处瓦片误差，减少远处瓦片请求。
                     */
                    dynamicScreenSpaceError:
                        activeConfig.tileset?.dynamicScreenSpaceError ?? true,

                    shadows: activeConfig.tileset?.disableShadows
                        ? Cesium.ShadowMode.DISABLED
                        : Cesium.ShadowMode.ENABLED,
                }
            )

            const loadedTileset = await cell[keys.loadingKey]

            /**
             * 异步请求完成时页面可能已经卸载。
             * isDestroyed() 用于判断 Cesium Viewer 是否仍可使用；如果不可用，
             * 必须销毁刚创建但尚未加入场景的 Tileset。
             */
            if (!viewer || viewer.isDestroyed()) {
                loadedTileset.destroy()
                return null
            }

            loadedTileset.show = shouldShowLodTileset(cell, level)
            cell[keys.tilesetKey] = loadedTileset

            /**
             * tileLoad 在某个瓦片内容下载并处理完成时触发。
             * fromUrl() 完成只代表 tileset.json 已解析，不代表 GLB 已经显示，
             * 因此不能过早把 cluster 或旧层级隐藏。
             */
            loadedTileset.tileLoad.addEventListener(() => {
                if (cell[keys.readyKey]) {
                    return
                }

                cell[keys.readyKey] = true

                /**
                 * setTimeout(callback, 0) 把更新推迟到当前 Cesium 事件结束后。
                 * 这样不会在 tileLoad 回调执行过程中立即修改显示调度状态。
                 */
                setTimeout(() => {
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
            cell.error = error?.message || String(error)
            console.error(
                `[useCityTreeTiles:Version3] cell ${cell.id} ` +
                `${keys.levelName} Tileset 加载失败`,
                error
            )
            return null
        } finally {
            cell[keys.loadingKey] = null
        }
    }

    /**
     * 判断 cluster 的世界坐标是否位于当前屏幕附近。
     * 远景时只显示镜头前方、投影到画布范围内的聚合树。
     */
    function isClusterOnScreen(position) {
        /**
         * Cartesian3.subtract(A, B, result) 计算 A-B，并把结果写进 result。
         * 这里得到“从相机指向 cluster”的向量。
         */
        Cesium.Cartesian3.subtract(
            position,
            viewer.camera.positionWC,
            scratchToCluster
        )

        /**
         * dot() 是向量点积。相机方向与目标方向点积 <= 0，
         * 表示目标位于相机侧面之后，无需继续做屏幕投影。
         */
        if (
            Cesium.Cartesian3.dot(
                viewer.camera.directionWC,
                scratchToCluster
            ) <= 0
        ) {
            return false
        }

        /**
         * worldToWindowCoordinates() 把三维世界坐标转换为二维屏幕像素。
         */
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

    /**
     * 计算相机到 cell 地表矩形的最近距离，单位为米。
     */
    function getCameraDistanceToCell(camera, cell) {
        /**
         * 数组解构：按顺序把 region 前四项取出。
         * manifest.region 使用 3D Tiles 标准：[west,south,east,north,minH,maxH]
         */
        const [west, south, east, north] = cell.region
        const cameraPosition = camera.positionCartographic

        /**
         * Cesium.Math.clamp(value,min,max) 把值限制在闭区间内。
         * 相机经纬度在矩形外时取最近边界；在矩形内时保持原值。
         */
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

        /**
         * fromRadians() 接收弧度；高度设为 0 表示 cell 的地表参考点。
         * 最后一个参数是复用的 scratch 结果对象。
         */
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
     * ★ - 按当前相机位置更新所有 cell 的目标 LOD - ★
     */
    function updateLodByCamera() {
        if (!viewer || viewer.isDestroyed() || !activeConfig) {
            return
        }

        const camera = viewer.camera
        const distanceConfig = activeConfig.lodDistance

        cellRuntimes.forEach((cell) => {
            const distance = getCameraDistanceToCell(camera, cell)

            /**
             * 迟滞判断：进入阈值和退出阈值不同
             */
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

        /**
         * requestRender() 请求 Cesium 再渲染一帧。
         * 项目如果启用了按需渲染，直接修改 show 后必须通知场景刷新。
         */
        viewer.scene.requestRender()
    }

    /**
     * 注册相机事件，驱动 LOD 更新。
     *
     * camera.changed：相机变化达到 percentageChanged 阈值时触发；
     * camera.moveEnd：拖动、缩放或飞行结束时再执行一次最终校正。
     */
    function setupLodCameraListeners() {
        previousPercentageChanged = viewer.camera.percentageChanged
        viewer.camera.percentageChanged =
            activeConfig.camera.percentageChanged

        /**
         * 注意这里没有写 updateLodByCamera()：
         * addEventListener 需要接收“函数本身”，由 Cesium 在事件发生时调用。
         * 如果加括号，就会在注册时立刻执行并把返回值传进去。
         */
        removeCameraChanged = viewer.camera.changed.addEventListener(
            updateLodByCamera
        )
        removeCameraMoveEnd = viewer.camera.moveEnd.addEventListener(
            updateLodByCamera
        )

        // 注册后立即计算一次，不能等用户第一次移动相机才显示内容。
        updateLodByCamera()
    }

    /**
     * 移除相机监听并恢复 Cesium 原有 percentageChanged。
     * addEventListener() 返回的取消函数不需要参数，直接调用即可。
     */
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

    // ★====== version2修改开始 ==========
    /**
     * Version 2 的释放逻辑改为同时移除 Low 和 High Tileset。
     * PrimitiveCollection.remove() 默认会销毁已加入集合的 Primitive。
     */
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
    // ★----------- version2修改结束 ------------

    // ★====== version1修改开始 ==========
    function unloadTreeTiles() {
        // Version 3 的释放顺序：事件 → Entity → Tileset → 基础状态。
        removeLodCameraListeners()
        removeClusterEntities()
        removeCellTilesets()

        if (tileset && viewer && !viewer.isDestroyed()) {
            viewer.scene.primitives.remove(tileset)
        }

        tileset = null
        viewer = null
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

    async function loadTreeTiles(
        targetViewer,
        tilesetUrl = DEFAULT_TILESET_URL
    ) {
        validateViewer(targetViewer)
        if (state.loading) {
            return null
        }

        unloadTreeTiles()
        viewer = targetViewer
        state.loading = true
        state.tilesetUrl = tilesetUrl

        try {
            tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
                maximumScreenSpaceError: 32,
            })
            viewer.scene.primitives.add(tileset)
            state.loading = false
            state.loaded = true
            viewer.flyTo(tileset, { duration: 2 })
            return tileset
        } catch (error) {
            state.loading = false
            state.loaded = false
            state.error = `病树 3D Tiles 加载失败：${error?.message || error}`
            console.error('[useCityTreeTiles:Version1]', error)
            return null
        }
    }
    // ★----------- version1修改结束 ------------

    // ★====== version2修改开始 ==========
    /**
     * Version 2 的城市加载流程仍是“配置 → manifest → runtime”；
     * Version 3 修改了最后一步：不再 Promise.all() 加载全部 High，
     * 而是创建 cluster，并由相机监听决定何时懒加载 Low/High。
     *
     * @returns {Promise<object[]|null>} 成功时返回 cellRuntimes
     */
    async function loadCity(targetViewer, city) {
        validateViewer(targetViewer)

        if (state.loading) {
            return null
        }
        if (!city || !city.gbCode) {
            state.error = '缺少城市对象或 city.gbCode'
            return null
        }

        const config = getCityTreeTilesConfig(city.gbCode)
        if (!config) {
            state.error = `城市 ${city.gbCode} 暂无病树 3D Tiles 数据`
            return null
        }

        unloadTreeTiles()
        viewer = targetViewer
        activeConfig = config
        state.loading = true
        state.cityGbCode = String(city.gbCode)
        state.cityName = city.name || config.name
        state.tilesetUrl = config.manifestUrl

        try {
            manifest = await fetchCityManifest()
            validateManifest(manifest, activeConfig, city)

            state.totalInstances = manifest.totalInstances
            initializeCellRuntimes()

            // ★====== version3新增开始 ==========
            createClusterEntities()

            /**
             * loaded=true 表示“城市 LOD 系统初始化完成”，
             * 不表示所有 Low/High Tileset 已下载。它们会随相机按需加载。
             */
            state.loading = false
            state.loaded = true
            setupLodCameraListeners()
            // ★----------- version3新增结束 ------------

            return cellRuntimes
        } catch (error) {
            const message =
                `城市病树 3D Tiles 加载失败：${error?.message || error}`
            unloadTreeTiles()
            state.error = message
            console.error('[useCityTreeTiles:Version3]', error)
            return null
        }
    }

    function unloadCurrentCity() {
        unloadTreeTiles()
    }
    // ★----------- version2修改结束 ------------

    function destroyCityTreeTiles() {
        unloadTreeTiles()
    }

    return {
        // readonly() 防止页面绕过本模块直接修改内部状态。
        state: readonly(state),
        loadTreeTiles,
        unloadTreeTiles,
        destroyCityTreeTiles,
        supportsCityTreeTiles,
        loadCity,
        unloadCurrentCity,
        updateLodByCamera,
        // ★----------- version3新增结束 ------------
    }
}
