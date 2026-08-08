package com.songcai.service;

import com.songcai.pojo.*;

import java.util.List;
import java.util.Map;

public interface DiseasedTreeService {

    List<DiseasedTree> findAll();

    void deleteById(String treeId);

    void addInfo(DiseasedTree diseasedTree);

    List<DiseasedTree> getInfo(String surveyId);

    PageResult<DiseasedTree> findByParam(DiseasedTreeQueryParam param);
    List<DiseasedTree> listByUser(String surveyId);
    List<DiseasedTree> searchTreeById(String treeId);

    void deleteBySurveyId(String userId);

    List<DiseasedTree> findBySearchParam(DiseasedTressSearchParam param);

//    List<DiseasedTreesGradeStatistics> statisticsByGrade();
    List<Map<String,Integer>> statisticsByGrade();
    List<Map<String,Integer>> statisticsBySpecies();
    Map<String,Object> overview();

    String sitePolygon();
    String showAllBuffer(Integer radius);

    List<DiseasedTree> findByPolygon(String polygonGeoJson);
}
