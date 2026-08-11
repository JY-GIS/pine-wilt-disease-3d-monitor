/**
 * 疫情重心迁移线 —— Cesium 图层
 *
 * 【职责】
 *   1. 读取 spatioTemporalStore.centroidPoints
 *   2. 在 Cesium 中渲染重心点（Point + Label）+ 迁移线（Polyline）
 *   3. 数据更新时自动清除旧图元并重建
 *
 * 【渲染方式选择】
 *   用 Cesium Entity API 而非 Primitive：
 *     - 重心点通常 ≤ 30 个（3 年 × 12 月）
 *     - Entity 支持 Label 直接关联位置，Primitive 需要额外处理
 *     - 数量少，Entity 性能完全没问题
 *
 * 【调用时机】
 *   - MainView onMounted 中初始化后调用
 *   - watch centroidPoints 变化时自动重绘
 */
import { ref, watch } from 'vue'
import { useSpatioTemporalStore } from '../stores/spatioTemporalStore.js'
import { getViewer } from './useCesiumViewer.js'
const Cesium = window.Cesium
// ==================== 模块级变量（不对外暴露） ====================
// 重心点和迁移线的引用，用于清除
let centroidPointEntities = []
let migrationLineEntities = []
let centroidLabelEntities = []
// ==================== Hook 入口 ====================
export function useCentroidMigration() {
    const store = useSpatioTemporalStore()
    /**
     * 清除所有重心相关图元（点 + 线 + 标签）
     */
    function clearAll() {
        const viewer = getViewer()
        if (!viewer) return
        // [修改] 合并遍历 + try/catch：viewer 销毁后旧 entity 引用已失效，remove 可能抛错
        const allEntities = [
            ...centroidPointEntities,
            ...migrationLineEntities,
            ...centroidLabelEntities,
        ]
        allEntities.forEach((e) => {
            try {
                viewer.entities.remove(e)
            } catch (err) {
                // 旧引用已随 viewer 销毁，忽略即可
            }
        })
        centroidPointEntities = []
        migrationLineEntities = []
        centroidLabelEntities = []
    }
    /**
     * 渲染重心迁移线
     * @param {Array} points - centroidPoints 数组
     *   [{ month: "2026-06", centerLng: 117.82, centerLat: 31.24, ... }, ...]
     */
    function render(points) {
        const viewer = getViewer()
        if (!viewer) {
            console.warn('viewer 未初始化，跳过重心迁移线渲染')
            return
        }
        clearAll()
        if (!points || points.length === 0) {
            console.log('无重心数据，跳过渲染')
            return
        }
        // ----- 第 1 步：渲染重心点 + 月份标签 -----
        points.forEach(item => {
            const position = Cesium.Cartesian3.fromDegrees(
                item.centerLng, item.centerLat
            )
            // 重心点：橙色圆点，稍大一些与普通病树区分
            const pointEntity = viewer.entities.add({
                position: position,
                point: {
                    color: Cesium.Color.YELLOW,
                    pixelSize: 15,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    // 距离缩放
                    scaleByDistance: new Cesium.NearFarScalar(500, 1, 5000000, 1.5),
                },
            })
            centroidPointEntities.push(pointEntity)
            const labelEntity = viewer.entities.add({
                position: position,
                label: {
                    text: item.month,
                    font: 'bold 12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.fromCssColorString('#333333'),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.TOP,
                    pixelOffset: new Cesium.Cartesian2(0, -14), // 向上偏移，避免遮挡点
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    // 距离显示条件：太远时隐藏文字避免拥挤
                    // distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1000000),
                }
            })
            centroidLabelEntities.push(labelEntity)
        })
        // ----- 第 2 步：渲染相邻月之间的迁移线 -----
        if (points.length < 2) {
            console.log('重心点不足 2 个，跳过迁移线')
            return
        }
        for (let i = 0; i < points.length - 1; i++) {
            const from = points[i]
            const to = points[i + 1]
            const lineEntity = viewer.entities.add({
                polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray([
                        from.centerLng, from.centerLat,
                        to.centerLng, to.centerLat,
                    ]),
                    width: 2.5,
                    material: Cesium.Color.fromCssColorString('#ff8c00').withAlpha(0.7),
                    clampToGround: false,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
            migrationLineEntities.push(lineEntity)
        }
        console.log(
            `重心迁移线渲染完成: ${points.length} 个重心点, ${points.length - 1} 条迁移线`
        )
    }
    /**
     * 监听数据变化 → 自动重绘
     *
     * ★ 为什么用 watch：
     *   centroidPoints 是 computed，依赖 monthlyData。
     *   当用户切换省/市或加载新数据后，centroidPoints 自动变化，
     *   watch 回调中重新渲染 Cesium 图元。
     */
    watch(
        () => store.centroidPoints,
        (newPoints) => {
            render(newPoints)
        },
        { deep: true }
    )

    return {
        render,
        clearAll,
    }
}