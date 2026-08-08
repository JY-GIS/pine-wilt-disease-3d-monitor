package com.songcai.mapper;

import com.songcai.pojo.DiseasedTree;
import com.songcai.pojo.DiseasedTreeQueryParam;
//import com.songcai.pojo.DiseasedTreesGradeStatistics;
import com.songcai.pojo.DiseasedTressSearchParam;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

@Mapper
public interface DiseasedTreeMapper {

    @Delete("delete from diseased_trees where survey_id = #{userId}")
    void deleteBySurveyId(String userId) ;

    @Select("select d.*,u.username from diseased_trees d " +
            "left join users u on d.survey_id = u.user_id " +
            "order by survey_date desc;")
    List<DiseasedTree> findAll();

    @Delete("delete from diseased_trees where tree_id = #{treeId}")
    void deleteById(String treeId);

    @Insert("insert into diseased_trees(tree_id, survey_id, species, grade, chest, longitude, latitude, survey_date)" +
            " VALUES(#{treeId},#{surveyId},#{species},#{grade},#{chest},#{longitude},#{latitude},#{surveyDate}) ")
    void addInfo(DiseasedTree diseasedTree);

    @Select("select d.*,u.username from diseased_trees d  " +
            "left join users u on d.survey_id = u.user_id " +
            "where survey_id = #{surveyId};")
    List<DiseasedTree> getInfo(String surveyId);

    @Select("select tree_id from diseased_trees order by survey_date desc,tree_id desc limit 1")
    String findMaxTreeId();

    public List<DiseasedTree> findByParam(DiseasedTreeQueryParam param);

    @Select("select * from diseased_trees where survey_id = #{surveyId}")
    public List<DiseasedTree> listByUser(String surveyId);

    @Select("select * from diseased_trees where tree_id = #{treeId}")
    public List<DiseasedTree> searchTreeById(String treeId);

    public List<DiseasedTree> findBySearchParam(DiseasedTressSearchParam  searchParam);

    @Select("select grade,count(*) as Numbers from diseased_trees group by grade order by grade")
//    public List<DiseasedTreesGradeStatistics> statisticByGrade();
    public  List<Map<String,Integer>> statisticsByGrade();
    @Select("select species,count(*) as Numbers from diseased_trees group by species order by species")
    public  List<Map<String,Integer>> statisticsBySpecies();

    @Select("SELECT ST_AsGeoJSON(\n" +
            "               ST_Buffer(\n" +
            "                       ST_ConcaveHull(ST_Collect(geom),0.6,false)::geography,\n" +
            "                       2000\n" +
            "               )::geometry\n" +
            "       ) FROM diseased_trees;")
    public String sitePolygon();

//    @Select("SELECT ST_AsGeoJSON(\n" +
//            "               ST_Buffer(\n" +
//            "                       ST_Collect(geom)::geography,\n" +
//            "                       #{radius}\n" +
//            "               )::geometry\n" +
//            "       ) FROM diseased_trees;")
    @Select("SELECT ST_AsGeoJSON(\n" +
            "    ST_SimplifyPreserveTopology(\n" +
            "        ST_Buffer(ST_Collect(geom)::geography, #{radius})::geometry,\n" +
            "        0.0001\n" +
            "    )\n" +
            ") FROM diseased_trees; ")
    public String showAllBuffer(Integer radius);


    // ===== 新增：多边形圈选查询 =====
    @Select("SELECT tree_id, species, grade, chest, survey_id, survey_date, " +
            "longitude, latitude " +
            "FROM diseased_trees " +
            "WHERE ST_Within(geom, ST_SetSRID(ST_GeomFromGeoJSON( " +
            "#{polygonGeoJson}), " +
            " 4326)) ")
    List<DiseasedTree> findByPolygon(@Param("polygonGeoJson") String polygonGeoJson);


    List<DiseasedTree> findByIds(@Param("ids") List<String> ids);



}
