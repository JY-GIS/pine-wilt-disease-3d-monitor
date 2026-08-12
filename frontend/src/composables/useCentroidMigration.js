/**
 * 疫情重心迁移线 —— Cesium 图层 —— 动态飞线
 *
 * 【职责】
 *   1. 读取 spatioTemporalStore.centroidPoints
 *   2. 在 Cesium 中渲染重心点（Point + Label）+ 迁移线（Polyline）
 *   3. 数据更新时自动清除旧图元并重建
 *
 * 【渲染方式选择】
 *   [新增] 飞线流光材质（参考两位 CSDN 博主的方法，材质文件为
 *          frontend/src/utils/lineFlowMaterialProperty.js）
 *   [修改] 第 2 步：静态 Polyline → 抛物线飞线
 *   [新增] 顺序飞行：线段 i 的流光延迟 startTime = i * staggerDelay，
 *          实现“点1→点2 → 点2→点3 → …”依次飞的效果
 *   [新增] 高度自适应视野：弧高 = f(两点水平距离, 当前相机高度)，
 *          相机 moveEnd 时自动重建，视野宏观弧高放大、视野微观弧高缩小
 *
 * 【调用时机】
 *   - MainView onMounted 中初始化后调用
 *   - watch centroidPoints 变化时自动重绘
 */
import { ref, watch } from 'vue'
import { useSpatioTemporalStore } from '../stores/spatioTemporalStore.js'
import { getViewer } from './useCesiumViewer.js'
import LineFlowMaterialProperty from '../utils/lineFlowMaterialProperty.js'
const Cesium = window.Cesium
// ==================== 模块级变量（不对外暴露） ====================
// 重心点和迁移线的引用，用于清除
let centroidPointEntities = []
let migrationLineEntities = []
let centroidLabelEntities = []
let lastPoints = []
const cameraBindedViewers = new WeakSet()
// ================= 飞线效果可调参数 =================
const FLY_CONFIG = {
    // 流光参数（材质见 lineFlowMaterialProperty.js）
    baseColor: '#ff0000', // 线体底色（保留原来的橙色）
    flowColor: '#fffb00', // 流光/亮头颜色
    speed: 15,             // 流光速度
    percent: 0.08,         // 亮头长度比例（0~1，越大亮头越长）
    gradient: 0.08,        // 线体基础透明度
    // 高度自适应视野参数
    heightRatio: 0.28,    // 基础弧高 = 两点水平距离 × 该比例
    viewRefRatio: 2.5,    // 视野适配参考：相机高度 / (距离 × 该值)
    viewScaleMin: 0.4,    // 视野缩放下限（防止缩到很近时弧高过小）
    viewScaleMax: 2.2,    // 视野缩放上限（防止拉到很宏观时弧高爆炸）
    minFlyHeight: 3000,   // 弧高下限（米）
    maxFlyHeight: 1200000, // 弧高上限（米）
    arcPointCount: 64,    // 抛物线采样点数（越多越平滑）
    // 顺序飞行参数
    staggerDelay: 0.2,   // 相邻线段流光错峰间隔（周期比例），0 = 同时飞
    headCount: 3,         // 每条线几个光点同时流动
    glowPower: 2.0,       // 自发光强度（2~5 很亮）
    showTrajectory: true, // 是否保留静态轨迹线（false 则只有流光）
}
// ==================== Hook 入口 ====================
export function useCentroidMigration() {
    const store = useSpatioTemporalStore()
    /**
     * 清除所有重心相关图元（点 + 线 + 标签）
     */
    function clearAll() {
        const viewer = getViewer()
        if (!viewer) return
        // 合并遍历 + try/catch：viewer 销毁后旧 entity 引用已失效，remove 可能抛错
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
        lastPoints = []
    }

    /**
     * 计算某条迁移线的抛物线弧高（米）
     * 规则：
     *   1. 基础弧高与两点水平距离成正比（距离远 → 弧高、距离近 → 弧矮）
     *   2. 再乘上“相机高度 / 两点距离”的视野缩放系数，
     *      实现不同视野范围（全国/省/市、拉近/拉远）弧高自动不同
     */
    function computePeakHeight(from, to, cameraHeight) {
        const a = Cesium.Cartesian3.fromDegrees(from.centerLng, from.centerLat)
        const b = Cesium.Cartesian3.fromDegrees(to.centerLng, to.centerLat)
        const dist = Cesium.Cartesian3.distance(a, b)
        let height = dist * FLY_CONFIG.heightRatio
        const viewScale = Cesium.Math.clamp(  //clamp(值, 最小, 最大)
            cameraHeight / (dist * FLY_CONFIG.viewRefRatio),
            FLY_CONFIG.viewScaleMin,
            FLY_CONFIG.viewScaleMax
        )
        height *= viewScale
        return Cesium.Math.clamp(height, FLY_CONFIG.minFlyHeight, FLY_CONFIG.maxFlyHeight)
    }

    /**
     * 抛物线飞线采样
     * 这里采样 i=0..count（含起点和终点），
     * 高度按 h = 4H·t·(1-t) 计算，H 为顶点弧高、两端为 0。
     */
    function buildFlyLinePositions(from, to, peakHeight, count) {
        const positions = []
        const dLon = to.centerLng - from.centerLng
        const dLat = to.centerLat - from.centerLat
        for (let i = 0; i <= count; i++) { // i从0数到count ; 把弧线分成count段
            const t = i / count  // t表示“走到全程的百分之多少”
            positions.push(
                Cesium.Cartesian3.fromDegrees(
                    from.centerLng + dLon * t,  // 经度：从起点均匀走到终点
                    from.centerLat + dLat * t,  // 纬度：从起点均匀走到终点
                    peakHeight * 4 * t * (1 - t)// 高度：按抛物线公式算
                )
            )
        }
        return positions
    }

    /**
     * 绑定相机视野监听（moveEnd：拖动/飞行结束后触发）
     * 视野范围变化 → 按新相机高度重新计算弧高并重建飞线
     */
    function ensureCameraListener(viewer) {
        if (cameraBindedViewers.has(viewer)) return
        viewer.camera.moveEnd.addEventListener(() => {
            const v = getViewer()
            if (!v || lastPoints.length < 2) return
            renderFlyLines(v, lastPoints)
        })
        cameraBindedViewers.add(viewer)
    }

    /**
     *   只重建迁移飞线（保留重心点/标签，避免相机变化时整层闪烁）
     */
    function renderFlyLines(viewer, points) {
        migrationLineEntities.forEach((e) => {
            try {
                viewer.entities.remove(e)
            } catch (err) {
                // 忽略
            }
        })
        migrationLineEntities = []
        if (!points || points.length < 2) {
            console.log('重心点不足 2 个，跳过迁移飞线')
            return
        }
        // 取当前相机高度，用于视野适配
        const cameraHeight = viewer.camera.positionCartographic.height
        for (let i = 0; i < points.length - 1; i++) {
            const from = points[i]
            const to = points[i + 1]
            // 弧高随视野范围自适应
            const peakHeight = computePeakHeight(from, to, cameraHeight)
            // 静态直线 → 抛物线
            const positions = buildFlyLinePositions(from, to, peakHeight, FLY_CONFIG.arcPointCount)

            // 迁移线改为流光飞线
            const flyEntity = viewer.entities.add({
                polyline: {
                    positions: positions,
                    width: 4,
                    material: new LineFlowMaterialProperty({
                        color: Cesium.Color.fromCssColorString(FLY_CONFIG.baseColor),
                        flowColor: Cesium.Color.fromCssColorString(FLY_CONFIG.flowColor),
                        speed: FLY_CONFIG.speed,
                        percent: FLY_CONFIG.percent,
                        gradient: FLY_CONFIG.gradient,
                        // 错峰起始时间：点1→点2 先飞，点2→点3 随后……
                        startTime: i * FLY_CONFIG.staggerDelay,
                        headCount: FLY_CONFIG.headCount,
                        glowPower: FLY_CONFIG.glowPower,
                    }),
                    clampToGround: false,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
            migrationLineEntities.push(flyEntity)

            // 可选：保留静态轨迹线（弱化的原迁移线，作为路径骨架）
            if (FLY_CONFIG.showTrajectory) {
                const trailEntity = viewer.entities.add({
                    polyline: {
                        positions: positions,
                        width: 2,
                        material: Cesium.Color.fromCssColorString(FLY_CONFIG.baseColor).withAlpha(0.35),
                        clampToGround: false,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                })
                migrationLineEntities.push(trailEntity)
            }
        }
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
        lastPoints = points.slice()
        ensureCameraListener(viewer)
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
        renderFlyLines(viewer, points)
        console.log(
            `重心迁移飞线渲染完成: ${points.length} 个重心点, ${points.length - 1} 条飞线`
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
