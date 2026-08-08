package com.songcai.mapper;

import com.songcai.pojo.ProvinceStats;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface AdminDivisionMapper {
    /**
     * 查询所有省级行政区 + 各自的病树统计 + GeoJSON 几何
     *
     * SQL 写在 XML 里
     * 返回 ProvinceStats 列表，每个元素代表一个省
     */
    List<ProvinceStats> findAllProvincesWithStats();

    List<ProvinceStats> findCitiesByProvinceGbCode(
            @Param("provinceGbCode") String provinceGbCode
    );

    /**
     * 查询某个省内所有病树的 treeId
     *
     * 用途：前端点击某省后，拿到这个 ID 列表，
     * 把不在列表里的病树 Entity 设 show = false
     *
     * @param gbCode 天地图行政区划代码，如 "156340000"（安徽省）
     * @return 病树 ID 字符串列表，如 ["SC-20240101-1", "SC-20240105-3"]
     */
    @Select("select d.tree_id from diseased_trees d " +
            "inner join admin_region r on ST_Within(d.geom, r.geom)" +
            "where r.gb_code = #{gbCode}")
    List<String> findTreeIdsByGbCode(@Param("gbCode") String gbCode);

    @Select("select d.tree_id from diseased_trees d " +
            "inner join city c on ST_Within(d.geom, c.geom)" +
            "where c.gb_code = #{cityGbCode}")
    List<String> findTreeIdsByCityGbCode(@Param("cityGbCode") String cityGbCode);
}
