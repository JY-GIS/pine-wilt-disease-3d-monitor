/**
 * useCityTreeTiles.js - Version 1
 *
 * 当前版本只解决一个最基础的问题：
 * “把一整套病树 3D Tiles 加载到 Cesium 场景中。”
 */

// ★====== Version 1：单个病树 Tileset 的最小加载闭环

import { reactive, readonly } from 'vue'

const Cesium = window.Cesium

/**
 * 现有 Demo 的整套 High 病树 tileset。
 *
 * 该地址会经过 frontend/vite.config.js 中的 /tree-tiles 代理，
 * 实际读取 data-processing/tree-tiles-lod-output/high/tileset.json。
 */
const DEFAULT_TILESET_URL = '/tree-tiles/high/tileset.json'

const state = reactive({
    loading: false,
    loaded: false,
    tilesetUrl: '',
    error: '',
})


export function useCityTreeTiles() {
    let viewer = null
    let tileset = null

    function validateViewer(targetViewer) {
        if (!targetViewer || targetViewer.isDestroyed()) {
            throw new Error('Cesium Viewer 尚未初始化或已经销毁')
        }
    }

    function unloadTreeTiles() {
        if (tileset && viewer && !viewer.isDestroyed()) {
            viewer.scene.primitives.remove(tileset)
        }

        tileset = null
        viewer = null
        state.loading = false
        state.loaded = false
        state.tilesetUrl = ''
        state.error = ''
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
        state.loaded = false
        state.tilesetUrl = tilesetUrl
        state.error = ''

        try {
            /**
             * Cesium3DTileset.fromUrl()：异步读取 tileset.json 并创建 Tileset
             */
            const loadedTileset = await Cesium.Cesium3DTileset.fromUrl(
                tilesetUrl,
                {
                    maximumScreenSpaceError: 32,
                }
            )

            tileset = loadedTileset

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

    function destroyCityTreeTiles() {
        unloadTreeTiles()
    }

    return {
        /**
         * readonly()：调用方只能读取状态，不能绕过本模块直接修改。
         * （是 Vue composable 封装状态的标准写法）
         */
        state: readonly(state),
        loadTreeTiles,
        unloadTreeTiles,
        destroyCityTreeTiles,
    }
}
