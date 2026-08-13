import { reactive } from 'vue'

const Cesium = window.Cesium

let tilesetInstance = null
const state = reactive({
    loaded: false,
    loading: false,
    error: '',
})

export function useTileset3D() {
    async function loadTileset(viewer, url) {
        if (!viewer) return null
        if (tilesetInstance) {
            viewer.scene.primitives.remove(tilesetInstance)
            tilesetInstance.destroy()
            tilesetInstance = null
        }
        state.loading = true
        state.error = ''
        try {
            const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
                maximumScreenSpaceError: 1  // 越小越清晰、越慢;越大越快越糊
            })
            tilesetInstance = tileset
            viewer.scene.primitives.add(tileset)
            state.loaded = true
            state.loading = false
            viewer.flyTo(tileset, { duration: 5 })
            return tileset
        } catch (err) {
            state.loading = false
            state.error = `加载失败：${err?.message || err}`
            console.error('[useTileset3D]', err)
            return null
        }
    }

    function unloadTileset(viewer) {
        if (tilesetInstance) {
            viewer.scene.primitives.remove(tilesetInstance)
            tilesetInstance.destroy()
            tilesetInstance = null
        }
        state.loaded = false
        state.loading = false
    }

    return {
        state,
        loadTileset,
        unloadTileset
    }
}