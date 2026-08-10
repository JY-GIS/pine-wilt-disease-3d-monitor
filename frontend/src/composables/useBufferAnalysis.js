/**
 * 缓冲区分析 Hook
 *
 * 职责：
 * 1. 管理三级缓冲区配置（低危/中危/高危）
 * 2. 调后端 PostGIS 获取合并后的缓冲区 GeoJSON
 * 3. 构建贴地 GeoJsonDataSource 并添加到场景    // [修改] Primitive → GeoJsonDataSource
 * 4. 一键显示/隐藏全部 & 单独切换某个等级
 *
 * 【性能优化说明】// [修改] 新增
 *   - 不再对每个顶点采样地形高度（sampleTerrainMostDetailed），
 *     之前 3 个半径合计约 1.46 万个顶点，逐个采样导致加载极慢且不贴地
 *   - 改用 GeoJsonDataSource.load(..., { clampToGround: true })，
 *     Cesium 自带贴地机制，自动贴合地形，加载快
 *   - 图层首次加载后缓存（dataSource），之后显示/隐藏只切 show，不重建
 */
import { ref } from 'vue'
import { API } from '../config/api.config.js'
import { DataSource } from 'cesium'

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
        DataSource: null,
    },
    {
        key: 'mid',
        radius: 200,
        label: '中危病树缓冲区',
        fillColor: Cesium.Color.PALEVIOLETRED.withAlpha(0.4),
        btnColor: Cesium.Color.PALEVIOLETRED.toCssColorString(),
        visibleRef: ref(false),
        DataSource: null,
    },
    {
        key: 'high',
        radius: 80,
        label: '高危病树缓冲区',
        fillColor: Cesium.Color.RED.withAlpha(0.5),
        btnColor: Cesium.Color.RED.toCssColorString(),
        visibleRef: ref(false),
        DataSource: null,
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

    // ================================================================
    // [修改] 创建贴地缓冲区 GeoJsonDataSource
    //   原实现 createMergedBufferPrimitiveHeight：
    //     对每个环 sampleTerrainMostDetailed 采样地形高度 → 慢、且不贴地
    //   新实现：
    //     GeoJsonDataSource.load(feature, { clampToGround: true })
    //     → Cesium 自动生成贴地 GroundPrimitive，无需采样高度
    // ================================================================
    async function createMergedBufferDataSource(radius, fillColor) {
        const feature = await loadAllBuffer(radius)
        return await Cesium.GeoJsonDataSource.load(feature, {
            clampToGround: true,
            fill: fillColor,
            stroke: Cesium.Color.WHITE.withAlpha(0.6),
            strokeWidth: 1,
        })
    }

    // ========== 一键显示/隐藏全部缓冲区 ==========
    // [修改] 重写：不再 remove/重建，改为首次加载缓存 + 切换 show
    async function toggleAllBuffered(viewer) {
        if (isLoadingBuffer) return
        if (!viewer) {
            console.warn('viewer 未初始化，跳过缓冲区显示')
            return
        }
        isLoadingBuffer = true
        try {
            if (bufferVisibleAll.value) {
                // → 隐藏全部
                bufferConfigList.forEach((cfg) => {
                    // [修改] 只隐藏，不删除图层 → 下次显示秒开
                    if (cfg.dataSource) {
                        cfg.dataSource.show = false
                    }
                    cfg.visibleRef.value = false
                })
                bufferVisibleAll.value = false
            } else {
                // → 显示全部（首次才加载，之后直接 show）
                await Promise.all(
                    bufferConfigList.map(async (cfg) => {
                        if (!cfg.dataSource) {
                            cfg.dataSource = await createMergedBufferDataSource(
                                cfg.radius,
                                cfg.fillColor
                            )
                            viewer.dataSources.add(cfg.dataSource)
                        }
                        cfg.dataSource.show = true
                        cfg.visibleRef.value = true
                    })
                )
                bufferVisibleAll.value = true
            }
        } catch (error) {
            console.error('缓冲区显示失败:', error)
            // 失败时全部隐藏并复位状态
            bufferConfigList.forEach((cfg) => {
                if (cfg.dataSource) {
                    cfg.dataSource.show = false
                }
                cfg.visibleRef.value = false
            })
            bufferVisibleAll.value = false
        } finally {
            isLoadingBuffer = false   // 关键：无论成功失败都解锁
        }
    }

    // ========== 单独切换某个等级 ==========
    // [修改] 同样改为缓存 + 切换 show
    async function toggleSingleBuffer(viewer, key) {
        if (isLoadingBuffer) return
        isLoadingBuffer = true
        try {
            const cfg = bufferConfigList.find((item) => item.key === key)
            if (!cfg) return

            if (cfg.visibleRef.value) {
                // → 隐藏
                if (cfg.dataSource) {
                    cfg.dataSource.show = false
                }
                cfg.visibleRef.value = false
            } else {
                // → 显示（首次才加载）
                if (!cfg.dataSource) {
                    cfg.dataSource = await createMergedBufferDataSource(
                        cfg.radius,
                        cfg.fillColor
                    )
                    viewer.dataSources.add(cfg.dataSource)
                }
                cfg.dataSource.show = true
                cfg.visibleRef.value = true
            }
        } catch (error) {
            console.error('缓冲区显示失败:', error)
            // 失败时隐藏对应等级并复位状态
            const cfg = bufferConfigList.find((item) => item.key === key)
            if (cfg) {
                if (cfg.dataSource) {
                    cfg.dataSource.show = false
                }
                cfg.visibleRef.value = false
            }
        } finally {
            isLoadingBuffer = false
        }
    }

    return {
        toggleAllBuffered,
        toggleSingleBuffer,
    }
}