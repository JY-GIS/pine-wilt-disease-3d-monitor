/**
 * 缓冲区分析 Hook
 *
 * 职责：
 * 1. 管理三级缓冲区配置（低危/中危/高危）
 * 2. 调后端 PostGIS 获取合并后的缓冲区 GeoJSON
 * 3. 构建贴地 Primitive 并添加到场景
 * 4. 一键显示/隐藏全部 & 单独切换某个等级
 */
import { ref } from 'vue'
import { API } from '../config/api.config.js'
import { sampleTerrainHeight } from '../utils/cesiumUtils.js'

const Cesium = window.Cesium

// ==================== 并发锁 ====================
// 防止快速点击导致多次请求
let isLoadingBuffer = false

// ==================== 共享状态（模块级） ====================
// RightSidePanel 和 hook 函数共用同一份引用

/** 三级缓冲区配置 */
export const bufferConfigList = [
    {
        key: 'low',
        radius: 500,
        label: '低危病树缓冲区',
        fillColor: Cesium.Color.GREENYELLOW.withAlpha(0.3),
        btnColor: Cesium.Color.GREEN.toCssColorString(),
        visibleRef: ref(false),
        primitive: null,
    },
    {
        key: 'mid',
        radius: 200,
        label: '中危病树缓冲区',
        fillColor: Cesium.Color.PALEVIOLETRED.withAlpha(0.4),
        btnColor: Cesium.Color.PALEVIOLETRED.toCssColorString(),
        visibleRef: ref(false),
        primitive: null,
    },
    {
        key: 'high',
        radius: 80,
        label: '高危病树缓冲区',
        fillColor: Cesium.Color.RED.withAlpha(0.5),
        btnColor: Cesium.Color.RED.toCssColorString(),
        visibleRef: ref(false),
        primitive: null,
    },
]

/** 是否全部可见 */
export const bufferVisibleAll = ref(false)

// ==================== Hook 入口 ====================
export function useBufferAnalysis() {

    // ========== 请求后端：获取合并后的缓冲区 GeoJSON ==========
    async function loadAllBuffer(radius) {
        const response = await fetch(API.allBuffer(radius), {
            method: 'GET',
            headers: API.getHeaders(),
        })
        const result = await response.json()
        const buffered = JSON.parse(result.data)
        return {
            type: 'Feature',
            geometry: buffered,
            properties: { name: '病树缓冲区' },
        }
    }

    // ========== 创建贴地缓冲区 Primitive ==========
    async function createMergedBufferPrimitiveHeight(radius, fillColor, viewer) {
        const feature = await loadAllBuffer(radius)
        const geometry = feature.geometry
        const instances = []

        const addPolygon = async (coords) => {
            // 外环 → 采样地形高度 → Cartesian3 数组
            const outerRing = await sampleTerrainHeight(coords[0], viewer)

            // 孔洞（如果有）
            const holes = []
            for (let h = 1; h < coords.length; h++) {
                const holeRing = await sampleTerrainHeight(coords[h], viewer)
                holes.push(new Cesium.PolygonHierarchy(holeRing))
            }

            instances.push(
                new Cesium.GeometryInstance({
                    geometry: new Cesium.PolygonGeometry({
                        polygonHierarchy: new Cesium.PolygonHierarchy(outerRing, holes),
                        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                    }),
                    id: `merged-buffer-${radius}`,
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(fillColor),
                    },
                })
            )
        }

        // 处理 Polygon 和 MultiPolygon 两种情况
        if (geometry.type === 'Polygon') {
            await addPolygon(geometry.coordinates)
        } else if (geometry.type === 'MultiPolygon') {
            for (const polygon of geometry.coordinates) {
                await addPolygon(polygon)
            }
        }

        return new Cesium.Primitive({
            geometryInstances: instances,
            appearance: new Cesium.PerInstanceColorAppearance({
                flat: true,
                translucent: true,
            }),
        })
    }

    // ========== 一键显示/隐藏全部缓冲区 ==========
    async function toggleAllBuffered(viewer) {
        if (isLoadingBuffer) return
        isLoadingBuffer = true

        if (bufferVisibleAll.value) {
            // → 隐藏全部
            bufferConfigList.forEach((cfg) => {
                if (cfg.primitive) {
                    viewer.scene.primitives.remove(cfg.primitive)
                    cfg.primitive = null
                }
                cfg.visibleRef.value = false
            })
            bufferVisibleAll.value = false
        } else {
            // → 显示全部（先清旧图层，避免重复添加）
            bufferConfigList.forEach((cfg) => {
                if (cfg.primitive) {
                    viewer.scene.primitives.remove(cfg.primitive)
                    cfg.primitive = null
                }
            })
            // 由大到小加载：大的先添加 → 在底层；小的后添加 → 在上层
            await Promise.all(
                bufferConfigList.map(async (cfg) => {
                    cfg.primitive = await createMergedBufferPrimitiveHeight(
                        cfg.radius,
                        cfg.fillColor,
                        viewer
                    )
                    viewer.scene.primitives.add(cfg.primitive)
                    cfg.visibleRef.value = true
                })
            )
            bufferVisibleAll.value = true
        }

        isLoadingBuffer = false
    }

    // ========== 单独切换某个等级 ==========
    async function toggleSingleBuffer(viewer, key) {
        if (isLoadingBuffer) return
        isLoadingBuffer = true

        const cfg = bufferConfigList.find((item) => item.key === key)
        if (!cfg) {
            isLoadingBuffer = false
            return
        }

        if (cfg.visibleRef.value) {
            // → 隐藏
            if (cfg.primitive) {
                viewer.scene.primitives.remove(cfg.primitive)
                cfg.primitive = null
            }
            cfg.visibleRef.value = false
        } else {
            // → 显示
            if (cfg.primitive) {
                viewer.scene.primitives.remove(cfg.primitive)
                cfg.primitive = null
            }
            cfg.primitive = await createMergedBufferPrimitiveHeight(
                cfg.radius,
                cfg.fillColor,
                viewer
            )
            viewer.scene.primitives.add(cfg.primitive)
            cfg.visibleRef.value = true
        }

        isLoadingBuffer = false
    }

    return {
        toggleAllBuffered,
        toggleSingleBuffer,
    }
}