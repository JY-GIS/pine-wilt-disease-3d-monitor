/**
 * 病树等级 → 样式映射
 * Entity 和 Primitive 共用
 */

const Cesium = window.Cesium

/** 等级 → { color, pixelSize } 映射表 */
const GRADE_STYLE_MAP = {
    5: { color: Cesium.Color.BLACK, pixelSize: 4 },
    4: { color: Cesium.Color.RED, pixelSize: 3.75 },
    3: { color: Cesium.Color.PURPLE, pixelSize: 3.5 },
    2: { color: Cesium.Color.YELLOW, pixelSize: 3.25 },
    1: { color: Cesium.Color.GREEN, pixelSize: 3 },
}

/** 未知等级默认样式 */
const DEFAULT_STYLE = { color: Cesium.Color.WHITE, pixelSize: 3 }

/**
 * 根据病树等级获取颜色和像素大小
 *
 * @param {number} grade - 病树等级 (1-5)
 * @returns {{ color: Cesium.Color, pixelSize: number }}
 */
export function getGradeColorAndSize(grade) {
    return GRADE_STYLE_MAP[grade] || DEFAULT_STYLE
}

/**
 * 获取所有等级的颜色映射（供图例等场景使用）
 */
export const GRADE_COLORS = {
    1: '#00FF00',
    2: '#FFFF00',
    3: '#800080',
    4: '#FF0000',
    5: '#000000',
}