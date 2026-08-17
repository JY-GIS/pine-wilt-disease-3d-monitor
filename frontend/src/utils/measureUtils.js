/**
 * 测量工具 —— 计算与格式化（纯函数，不依赖 viewer）
 */

const Cesium = window.Cesium

export function calcDistanceSegment(a, b) {
    const c1 = Cesium.Cartographic.fromCartesian(a)
    const c2 = Cesium.Cartographic.fromCartesian(b)
    // EllipsoidGeodesic 是 Cesium 计算「地球表面两点最短路径」的标准类
    const geodesic = new Cesium.EllipsoidGeodesic()
    geodesic.setEndPoints(
        new Cesium.Cartographic(c1.longitude, c1.latitude, 0),
        new Cesium.Cartographic(c2.longitude, c2.latitude, 0)
    )
    // surfaceDistance : 椭球面最短距离，单位米
    const horizontal = geodesic.surfaceDistance
    // Cartesian3.distance : 三维欧氏距离（穿过地表的空间直线），含高差
    const spatial = Cesium.Cartesian3.distance(a, b)
    const vertical = Math.abs(c1.height - c2.height)
    // Math.atan2(垂直, 水平) : 反正切求坡度角，atan2 能避免水平距离为 0 时除零报错
    const slopeAngle = Cesium.Math.toDegrees(Math.atan2(vertical, horizontal))
    return { horizontal, spatial, vertical, slopeAngle }
}

/**
 * 距离格式化：< 1000 显示 m，>= 1000 显示 km
 */
export function formatDistance(meters) {
    if (meters == null || isNaN(meters)) return '0 m'
    if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km'
    return meters.toFixed(1) + ' m'
}

/**
 * 角度格式化
 */
export function formatAngle(deg) {
    if (deg == null || isNaN(deg)) return '0°'
    return deg.toFixed(1) + '°'
}