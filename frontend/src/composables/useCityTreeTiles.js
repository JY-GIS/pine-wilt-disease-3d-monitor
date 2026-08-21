import { reactive, readonly } from 'vue'
const Cesium = window.Cesium
const DEFAULT_TILESET_URL = '/tree-tiles/high/tileset.json'

import {
    getCityTreeTilesConfig,
    supportsCityTreeTiles,
} from '../config/treeTiles.config.js'

const state = reactive({
    loading: false,
    loaded: false,
    tilesetUrl: '',
    error: '',

    // ★====== version2新增开始 ==========
    cityGbCode: null,
    cityName: null,

    // totalInstances 来自 manifest，用于核对城市病树总数。
    totalInstances: 0,

    // cellCount 是 manifest 中非空空间块数量。
    cellCount: 0,

    // loadedCellCount 用于向页面反馈已有多少个 cell 成功加入场景。
    loadedCellCount: 0,
    // ★----------- version2新增结束 ------------
})

export function useCityTreeTiles() {
    let viewer = null
    let tileset = null

    // ★====== version2新增开始 ==========
    /**
     * activeConfig：当前城市的静态前端配置
     */
    let activeConfig = null

    /**
     * manifest：从服务器读取的城市级数据清单
     */
    let manifest = null

    /**
     * cellRuntimes：根据 manifest.cells 创建的运行时数组
     */
    let cellRuntimes = []
    // ★----------- version2新增结束 ------------

    function validateViewer(targetViewer) {
        if (!targetViewer || targetViewer.isDestroyed()) {
            throw new Error('Cesium Viewer 尚未初始化或已经销毁')
        }
    }

    // ★====== version2新增开始 ==========
    /**
     * 校验城市 manifest 的最小数据契约
     */
    function validateManifest(data, config, city) {
        if (!data || !Array.isArray(data.cells)) {
            throw new Error('城市 3D Tiles manifest 缺少 cells 数组')
        }

        const cityGbCode = city.gbCode

        if (String(data.city?.gbCode) !== String(config.gbCode)) {
            throw new Error(
                `manifest 城市编码不一致：` +
                `${data.city?.gbCode} != ${config.gbCode}`
            )
        }

        if (String(data.city?.gbCode) !== String(cityGbCode)) {
            throw new Error(
                `请求城市与 manifest 不一致：` +
                `${cityGbCode} != ${data.city?.gbCode}`
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
                !cell.highTilesetUrl ||
                cell.highTilesetUrl.length === 0
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
     * 把 manifest 中的相对 tileset 地址转换成浏览器可以请求的完整地址。
     *
     * 例如：
     * manifest 地址：/tree-tiles/cities/156370200/manifest.json
     * cell 地址：high/regions/0_0.json
     * 解析结果：/tree-tiles/cities/156370200/high/regions/0_0.json
     *
     * new URL(relative, base)：按照 URL 标准解析相对路径。
     *
     * 这里必须以 manifest 文件本身为 base，而不能只以网站根路径为 base，
     * 否则 high/regions 会被错误解析到整个网站的根目录。
     */
    function resolveManifestUrl(relativeUrl) {
        const manifestAbsoluteUrl = new URL(
            activeConfig.manifestUrl,
            window.location.origin
        )

        /**
         * 第二次 new URL() 把 cell 相对路径放到 manifest 所在目录下。
         * toString() 再把 URL 对象转换为 Cesium.fromUrl() 可以直接使用的字符串。
         */
        return new URL(relativeUrl, manifestAbsoluteUrl).toString()
    }

    /**
     * 请求当前城市的 manifest。
     *
     * fetch()：浏览器原生网络请求 API。
     * response.ok：HTTP 状态码为 200～299 时为 true。
     * response.json()：异步把响应体解析为 JavaScript 对象。
     *
     * fetch() 遇到 404/500 时通常不会自动进入 catch，
     * 所以必须主动检查 response.ok 并抛出错误。
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

    /**
     * 把 manifest.cells 转换为前端可修改的 runtime cell
     */
    function initializeCellRuntimes() {
        cellRuntimes = manifest.cells.map((cell) => ({
            id: cell.id,
            treeCount: cell.treeCount,
            center: cell.center,
            region: cell.region,
            highTilesetUrl: resolveManifestUrl(cell.highTilesetUrl),
            tileset: null,
            loading: false,
            error: '',
        }))

        state.cellCount = cellRuntimes.length
        state.loadedCellCount = 0
    }

    /**
     * 加载一个空间块的 High tileset
     */
    async function loadCellTileset(cell) {
        cell.loading = true
        cell.error = ''

        try {
            /**
             * Cesium3DTileset.fromUrl()：读取 cell 的 tileset.json，
             */
            const cellTileset = await Cesium.Cesium3DTileset.fromUrl(
                cell.highTilesetUrl,
                {
                    maximumScreenSpaceError:
                        activeConfig.tileset?.maximumScreenSpaceError ?? 32,
                }
            )

            viewer.scene.primitives.add(cellTileset)
            cell.tileset = cellTileset
            state.loadedCellCount += 1

            return cellTileset
        } catch (error) {
            cell.error = error?.message || String(error)
            console.error(
                `[useCityTreeTiles:Version2] cell ${cell.id} 加载失败`,
                error
            )
            return null
        } finally {
            cell.loading = false
        }
    }

    /**
     * 移除所有 Version 2 cell Tileset，并清空城市运行时数据。
     *
     * PrimitiveCollection.remove() 默认会销毁移除的 Primitive，
     * 因此不要在 remove() 成功后再次调用 destroy()，避免重复销毁。
     */
    function removeCellTilesets() {
        if (viewer && !viewer.isDestroyed()) {
            cellRuntimes.forEach((cell) => {
                if (cell.tileset) {
                    viewer.scene.primitives.remove(cell.tileset)
                }
            })
        }

        cellRuntimes = []
        manifest = null
        activeConfig = null
    }
    // ★----------- version2新增结束 ------------

    // ★====== version1修改开始 ==========
    function unloadTreeTiles() {
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

    // ★====== version2新增开始 ==========
    /**
     * 加载一个城市的空间分块病树数据。
     *
     * 完整数据流：
     * city.gbCode
     * → 查询 treeTiles.config.js
     * → fetch manifest.json
     * → 校验城市和实例总数
     * → 创建 cellRuntimes
     * → 为每个 cell 加载 High tileset
     * → 加入 Cesium 场景。
     *
     * @param {Cesium.Viewer} targetViewer Cesium Viewer 实例
     * @param {object} city 行政区对象，必须包含 gbCode；可包含 name、treeCount
     * @returns {Promise<Cesium.Cesium3DTileset[]|null>}
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

        const cityGbCode = city.gbCode
        const config = getCityTreeTilesConfig(cityGbCode)

        if (!config) {
            state.error = `城市 ${cityGbCode || '未知'} 暂无病树 3D Tiles 数据`
            return null
        }

        unloadTreeTiles()

        viewer = targetViewer
        activeConfig = config
        state.loading = true
        state.cityGbCode = String(cityGbCode)

        state.cityName = city.name || config.name
        state.tilesetUrl = config.manifestUrl

        try {
            manifest = await fetchCityManifest()
            validateManifest(manifest, activeConfig, city)

            state.totalInstances = manifest.totalInstances
            initializeCellRuntimes()

            /**
             * Promise.all()：并发等待所有 cell 的加载任务完成。
             */
            const results = await Promise.all(
                cellRuntimes.map((cell) => loadCellTileset(cell))
            )
            /**
             * filter() 只保留回调返回 true 的元素，并产生一个新数组。
             * loadCellTileset() 失败时返回 null，所以这里明确排除 null，
             * 得到真正加载成功的 Tileset 数组。
             */
            const loadedTilesets = results.filter(
                (loadedTileset) => loadedTileset !== null
            )

            state.loading = false
            state.loaded = loadedTilesets.length > 0

            const failedCellCount =
                cellRuntimes.length - loadedTilesets.length
            if (failedCellCount > 0) {
                state.error = `${failedCellCount} 个空间块加载失败`
            }

            return loadedTilesets
        } catch (error) {
            const message =
                `城市病树 3D Tiles 加载失败：${error?.message || error}`

            unloadTreeTiles()
            state.error = message
            console.error('[useCityTreeTiles:Version2]', error)
            return null
        }
    }

    /**
     * 使用城市语义包装统一卸载函数。
     * 调用方不需要知道当前加载的是单 Tileset 还是 cell 集合。
     */
    function unloadCurrentCity() {
        unloadTreeTiles()
    }
    // ★----------- version2新增结束 ------------

    function destroyCityTreeTiles() {
        unloadTreeTiles()
    }

    // ★====== version1修改开始 ==========
    return {
        /**
         * readonly(state) 返回只读代理：页面可以读取 state.loading，
         * 但不能在模块外直接赋值。状态只能由本 composable 的方法维护。
         */
        state: readonly(state),
        loadTreeTiles,
        unloadTreeTiles,
        destroyCityTreeTiles,

        // Version 2 对外接口。
        supportsCityTreeTiles,
        loadCity,
        unloadCurrentCity,
    }
    // ★----------- version1修改结束 ------------
}
