/**
 * 城市级病树 3D Tiles 配置。
 *
 * 当前只注册青岛。以后增加城市时，只需增加配置和对应瓦片数据，
 * 不需要修改LOD核心逻辑。
 */


// ============ 城市病树3D Tiles配置 ============

/**
 * LOD进入和退出使用不同距离，形成“迟滞区间” —> 避免摄像机停在临界距离时High/Low反复闪烁。
 */

const QINGDAO_LOD_DISTANCE = Object.freeze({
    lowEnterMeters: 8000,
    lowExitMeters: 9000,
    highEnterMeters: 1000,
    highExitMeters: 1200
})

/**
 * Object.freeze：阻止运行时意外修改配置。
 */
const QINGDAO_TREE_TILES_CONFIG = Object.freeze({
    gbCode: '156370200',
    name: '青岛市',

    // 与Python生成器默认输出目录及Vite /tree-tiles代理保持一致
    manifestUrl: '/tree-tiles/cities/156370200/manifest.json',
    lodDistance: QINGDAO_LOD_DISTANCE,

    cluster: Object.freeze({
        modelUrl: '/models/pine-green.glb',
        modelScale: 1000,
        labelOffsetY: -42,
    }),

    camera: Object.freeze({
        // 相机变化超过2%时才重新计算LOD，减少无意义的每帧遍历。
        percentageChanged: 0.02,
        // 聚合点允许在屏幕边缘外保留少量缓冲。
        screenMarginPixels: 80,
    }),

    tileset: Object.freeze({
        maximumScreenSpaceError: 32,
        dynamicScreenSpaceError: true,
        disableShadows: true,
    }),

    metadata: Object.freeze({
        businessIdProperty: 'tree_id',
        diseaseLevelProperty: 'disease_level',
    }),
})

/**
 * 按行政区gbCode注册城市数据。
 */
export const TREE_TILES_CITY_CONFIG = Object.freeze({
    '156370200': QINGDAO_TREE_TILES_CONFIG,
})

/**
 * 获取城市3D Tiles配置。
 */
export function getCityTreeTilesConfig(gbCode) {
    if (gbCode === null || gbCode === undefined) {
        return null;
    }
    return TREE_TILES_CITY_CONFIG[String(gbCode)] ?? null
}

/**
 * 判断某个城市是否支持3D Tiles病树模式。
 */
export function supportsCityTreeTiles(gbCode) {
    return getCityTreeTilesConfig(gbCode) !== null
}


