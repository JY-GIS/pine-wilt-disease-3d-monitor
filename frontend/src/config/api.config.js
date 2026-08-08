/**
 * API 接口配置
 * 集中管理所有后端接口地址
 */

// ========== 后端基础地址 ==========
const BASE_URL = 'http://localhost:8080'

// ========== 通用请求头 ==========
function getHeaders() {
    return {
        'Content-Type': 'application/json',
        token: localStorage.getItem('token') || '',
    }
}

// ========== API 路径汇总 ==========
export const API = {
    // 基础地址
    baseURL: BASE_URL,

    // GeoSceneOnline 图层
    geoSceneOnline: {
        featureServer: 'https://www.geosceneonline.cn/server/rest/services/Hosted/diseased_trees/FeatureServer/0',
    },

    // 病树数据 CRUD
    diseasedTrees: {
        list: `${BASE_URL}/diseasedTrees`, // GET 获取全部病树
        delete: (treeId) => `${BASE_URL}/diseasedTrees?treeId=${treeId}`, // DELETE 删除
    },

    // 定位单树位置
    searchTreeById: (treeId) => `${BASE_URL}/diseasedTrees/searchTreeById?treeId=${treeId}`,

    // 疫区边界
    outBounder: `${BASE_URL}/diseasedTrees/outBounder`, // GET 缓冲区分析
    allBuffer: (radius) =>
        `${BASE_URL}/diseasedTrees/AllBuffer?radius=${radius}`, // GET

    // 周边病树查询（空间索引）
    nearbySearch: (lng, lat, radius) =>
        `${BASE_URL}/diseasedTrees/search?longitude=${lng}&latitude=${lat}&radius=${radius}`, // GET

    // 多边形圈选查询（ST_Within）
    within: `${BASE_URL}/diseasedTrees/within`, // POST

    // 巡查路径规划（贪心算法）
    planRoute: `${BASE_URL}/diseasedTrees/planRoute`,

    // 统计病树感染等级的数量
    statisticsByGrade: `${BASE_URL}/diseasedTrees/statistics`,// GET返回所有感染数据

    // 行政区划查询
    adminDivision: {
        provinces: `${BASE_URL}/admin-division/provinces`,     // GET 所有省级统计
        treeIdsByProvince: (gbCode) => `${BASE_URL}/admin-division/provinces/${gbCode}/treeIds`, // GET 某省病树ID列表
        citiesByProvince: (provinceGbCode) =>
            `${BASE_URL}/admin-division/provinces/${provinceGbCode}/cities`,
        treeIdsByCity: (cityGbCode) =>
            `${BASE_URL}/admin-division/cities/${cityGbCode}/treeIds`,
    },

    // 通用请求头
    getHeaders,
}