package com.songcai.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.songcai.mapper.DiseasedTreeMapper;
import com.songcai.pojo.*;
import com.songcai.service.DiseasedTreeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class DiseasedTreeServiceImpl implements DiseasedTreeService {

    @Autowired
    private DiseasedTreeMapper diseasedTreeMapper;

    @Override
    public List<DiseasedTree> findAll() {
        return diseasedTreeMapper.findAll();
    }

    @Override
    public void deleteById(String treeId){
        diseasedTreeMapper.deleteById(treeId);
    }

    @Override
    public void addInfo(DiseasedTree diseasedTree) {
//===========================================================================================
        // 1、自动生成树编号
        String maxTreeId = diseasedTreeMapper.findMaxTreeId();
        String today = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        int squence = 1;
        if(maxTreeId != null && maxTreeId.startsWith("SC-" + today)){
            String lastPart = maxTreeId.substring(maxTreeId.lastIndexOf("-") + 1);
            squence = Integer.parseInt(lastPart) + 1;
        }
        diseasedTree.setTreeId("SC-" + today + "-" + squence);
        // 2、自动填入当天日期
        diseasedTree.setSurveyDate(LocalDate.now().toString());
//===========================================================================================
        diseasedTreeMapper.addInfo(diseasedTree);
    }

    @Override
    public List<DiseasedTree> getInfo(String surveyId) {
        return diseasedTreeMapper.getInfo(surveyId);
    }

    @Override
    public PageResult<DiseasedTree> findByParam(DiseasedTreeQueryParam param) {
        PageHelper.startPage(param.getPage(), param.getPageSize());
        List<DiseasedTree> list = diseasedTreeMapper.findByParam(param);
        Page<DiseasedTree> p = (Page<DiseasedTree>)  list;
        return new PageResult<>(p.getTotal(), p.getResult());
    }

    @Override
    public List<DiseasedTree> listByUser(String surveyId) {
        return diseasedTreeMapper.listByUser(surveyId);
    }

    @Override
    public List<DiseasedTree> searchTreeById(String treeId) {return diseasedTreeMapper.searchTreeById(treeId);}

    @Override
    public void deleteBySurveyId(String userId) {
        diseasedTreeMapper.deleteBySurveyId(userId);
    }

    @Override
    public List<DiseasedTree> findBySearchParam(DiseasedTressSearchParam param) {
        return diseasedTreeMapper.findBySearchParam(param);
    }

    @Override
    public List<Map<String,Integer>> statisticsByGrade() {
        return diseasedTreeMapper.statisticsByGrade();
    }
    @Override
    public List<Map<String,Integer>> statisticsBySpecies() {
        return diseasedTreeMapper.statisticsBySpecies();
    }
    @Override
    public Map<String, Object> overview() {
        Map<String,Object> result = new HashMap<>();
        result.put("grade",statisticsByGrade());
        result.put("species",statisticsBySpecies());
        result.put("total",diseasedTreeMapper.findAll().size());
        return result;
    }

    @Override
    public String sitePolygon() {
        return diseasedTreeMapper.sitePolygon();
    }
    @Override
    public String showAllBuffer(Integer radius){
        return diseasedTreeMapper.showAllBuffer(radius);
    }
    @Override
    public List<DiseasedTree> findByPolygon(String polygonGeoJson) {
        return diseasedTreeMapper.findByPolygon(polygonGeoJson);
    }


}
