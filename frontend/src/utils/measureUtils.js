// ★ 引入 turf，测面积用 
import * as turf from '@turf/turf'

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

/**
 * 计算两点高差（有符号，起点高程 - 终点高程）
 */
export function calcHeightDiff(heightA, hrightB) {
    return heightA - hrightB
}
/**
 * 高度格式化
 */
export function formatHeight(meters) {
    if (meters == null || isNaN(meters)) return '0 m'
    return meters.toFixed(1) + ' m'
}
export function formatHeightCompare(heightA, heightB) {
    const diff = calcHeightDiff(heightA, heightB)
    const abs = Math.abs(diff)
    if (abs < 0.05) return '两点高程相同'
    const relation = diff > 0 ? '高' : '低'
    return `A比B${relation} ${formatHeight(abs)}`
}

/**
 * 面积计算与格式化
 */
export function calcArea(positions) {
    if (!positions || positions.length < 3) return { areaM2: 0, centroid: null }
    const ring = positions.map((p) => {
        // Cartographic.fromCartesian：世界坐标 → 经纬度 + 椭球高（这里只取经纬度）
        const c = Cesium.Cartographic.fromCartesian(p)
        return [
            Cesium.Math.toDegrees(c.longitude),
            Cesium.Math.toDegrees(c.latitude)
        ]
    })
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]])
    }
    const polygon = turf.polygon([ring])
    const areaM2 = turf.area(polygon)
    // turf.centroid 返回一个 GeoJSON 的 Point 要素
    // .geometry.coordinates 提取的就是 GeoJSON 标准定义的点坐标数组
    const centroid = turf.centroid(polygon).geometry.coordinates
    return { areaM2, centroid }
}

/**
 * 面积格式化：>= 1 km² 显示 km²，< 1 km² 显示 m²
 */
export function formatArea(m2) {
    if (m2 == null || isNaN(m2)) return '0 m²'
    if (m2 >= 1e6) return (m2 / 1e6).toFixed(2) + ' km²'
    return m2.toFixed(1) + ' m²'
}