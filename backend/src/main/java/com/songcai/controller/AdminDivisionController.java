package com.songcai.controller;

import com.songcai.mapper.AdminDivisionMapper;
import com.songcai.pojo.ProvinceStats;
import com.songcai.pojo.Result;
import com.songcai.service.AdminDivisionService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/admin-division")
public class AdminDivisionController {
    @Autowired
    private AdminDivisionService adminDivisionService;

    // ========== 接口 1：所有省级行政区统计 ==========
    /**
     * 查询所有省级行政区的病树统计 + 多边形 GeoJSON
     *
     * 返回数据示例：
     * {
     *   "code": 1,
     *   "data": [
     *     {
     *       "id": 1,
     *       "name": "安徽省",
     *       "gbCode": "156340000",
     *       "treeCount": 287,
     *       "severity": "moderate",
     *       "grade1": 120, "grade2": 80, "grade3": 50, "grade4": 30, "grade5": 7,
     *       "geojson": "{\"type\":\"MultiPolygon\",\"coordinates\":[...]}"
     *     },
     *     ...其余 33 个省
     *   ]
     * }
     */
    @GetMapping("/provinces")
    public Result listProvinces() {
        log.info("查询所有省级行政区病树统计");
        List<ProvinceStats> list = adminDivisionService.findAllProvincesWithStats();
        log.info("返回省级行政区数量:{}",list.size());
        return Result.success(list);
    }

    // ========== 接口 2：某省内所有病树 ID ==========
    /**
     * 查询某个省内所有病树的 treeId
     *
     * 前端拿到后放进 Set，遍历所有病树 Entity：
     *   entity.show = idSet.has(entity.treeId)
     *
     * @param gbCode 天地图行政区划代码，如 "156340000"（安徽省）
     *               @PathVariable：URL 路径中的变量，Spring 自动绑定
     * @return 病树 ID 字符串数组，如 ["SC-20240101-1", "SC-20240105-3"]
     */
    @GetMapping("/provinces/{gbCode}/treeIds")
    public Result getTreeIdsByProvince(@PathVariable String gbCode) {
        log.info("查询省内病树ID列表,gbCode:{}",gbCode);
        List<String> treeIds = adminDivisionService.findTreeIdsByGbCode(gbCode);
        log.info("该省病树数量: {}", treeIds.size());
        return Result.success(treeIds);
    }

    // ==================== 接口 3：某省全部城市统计（第 4 步） ====================
    /**
     * 查询某个省内所有城市的病树统计 + 多边形 GeoJSON + 边界线
     *
     * URL 示例：
     *   GET /admin-division/provinces/156340000/cities
     *   → 返回安徽省下 16 个城市的统计数据
     *
     * ★ 为什么不会和接口 2 冲突：
     *   接口 2: /provinces/{gbCode}/treeIds  ← 末尾是 "treeIds"
     *   接口 3: /provinces/{provinceGbCode}/cities ← 末尾是 "cities"
     *   Spring MVC 靠完整路径区分，两个路径不同，不会冲突
     *
     * @param provinceGbCode 省 gbCode，如 "156340000"（安徽省）
     *                       注意：参数名不能和接口 2 的 {gbCode} 重名，
     *                       这里写成 {provinceGbCode}，和接口 2 区分
     * @return 该省所有城市的 ProvinceStats 列表（字段与省完全一致）
     */
    @GetMapping("/provinces/{provinceGbCode}/cities")
    public Result getCitiesByProvince(@PathVariable String provinceGbCode) {
        log.info("查询省内城市统计, provinceGbCode:{}", provinceGbCode);
        List<ProvinceStats> list = adminDivisionService.findCitiesByProvinceGbCode(provinceGbCode);
        log.info("该省城市数量: {}", list.size());
        return Result.success(list);
    }
    // ==================== 接口 4：某市所有病树 ID（第 4 步） ====================
    /**
     * 查询某个市内所有病树的 treeId
     *
     * URL 示例：
     *   GET /admin-division/cities/156340100/treeIds
     *   → 返回合肥市所有病树的 ID 列表
     *
     * 前端拿到后放进 Set，遍历所有病树 Entity：
     *   entity.show = idSet.has(entity.treeId)
     *
     * @param cityGbCode 市 gbCode，如 "156340100"（合肥市）
     * @return 病树 ID 字符串数组
     */
    @GetMapping("/cities/{cityGbCode}/treeIds")
    public Result getTreeIdsByCity(@PathVariable String cityGbCode) {
        log.info("查询市内病树ID列表, cityGbCode:{}", cityGbCode);
        List<String> treeIds = adminDivisionService.findTreeIdsByCityGbCode(cityGbCode);
        log.info("该市病树数量: {}", treeIds.size());
        return Result.success(treeIds);
    }

}
