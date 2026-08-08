/**
 * Cesium 通用工具函数
 * 坐标转换、地形采样等
 */

const Cesium = window.Cesium

/**
 * 屏幕坐标 → 世界坐标
 * 优先采样真实地形高度，降级使用椭球体表面
 *
 * @param {Cesium.Cartesian2} clickPosition - 屏幕坐标（click.position）
 * @param {Cesium.Viewer} viewer - Cesium Viewer 实例
 * @returns {Cesium.Cartesian3 | undefined}
 */
export function getClickPosition(clickPosition, viewer) {
    // 优先方案：采样真实地形高度
    let cartesian = viewer.scene.pickPosition(clickPosition)

    // 降级方案：椭球体表面（地形未加载时用）
    if (!Cesium.defined(cartesian)) {
        cartesian = viewer.camera.pickEllipsoid(
            clickPosition,
            viewer.scene.globe.ellipsoid
        )
    }

    return cartesian
}

/**
 * 世界坐标 → 经纬度
 *
 * @param {Cesium.Cartesian3} cartesian - 世界坐标
 * @returns {[number, number]} [经度, 纬度]
 */
export function cartesianToLngLat(cartesian) {
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
    return [
        Cesium.Math.toDegrees(cartographic.longitude),
        Cesium.Math.toDegrees(cartographic.latitude),
    ]
}

/**
 * 对多边形外环顶点采样地形高度
 * 用于让缓冲区贴地显示
 *
 * @param {Array<[number, number]>} outerCoords - 外环顶点 [[lng, lat], ...]
 * @param {Cesium.Viewer} viewer
 * @returns {Promise<Cesium.Cartesian3[]>} 带高度的 Cartesian3 数组
 */
export async function sampleTerrainHeight(outerCoords, viewer) {
    // 1. 转为 Cartographic 数组
    const cartographics = outerCoords.map(([lng, lat]) =>
        Cesium.Cartographic.fromDegrees(lng, lat)
    )

    // 2. 采集地形高度
    const updated = await Cesium.sampleTerrainMostDetailed(
        viewer.terrainProvider,
        cartographics
    )

    // 3. 转回带高度的 Cartesian3
    return updated.map((c) =>
        Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height)
    )
}