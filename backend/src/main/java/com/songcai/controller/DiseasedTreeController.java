package com.songcai.controller;

import com.songcai.mapper.DiseasedTreeMapper;
import com.songcai.pojo.*;
import com.songcai.service.DiseasedTreeService;
import com.songcai.service.RoutePlanService;
import lombok.extern.slf4j.Slf4j;
import org.apache.ibatis.annotations.Delete;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RequestMapping("/diseasedTrees")
@RestController
public class DiseasedTreeController {

    @Autowired
    private DiseasedTreeService diseasedTreeService;
    @Autowired
    private RoutePlanService routePlanService;

//    @GetMapping
//    public Result list() {
//        log.info("查询所有病树信息:");
//        List<DiseasedTree> diseasedTree = diseasedTreeService.findAll();
//        return Result.success(diseasedTree);
//    }

    @DeleteMapping
    public Result deleteById(String treeId){
        log.info("删除的病树信息的id是:" + treeId);
        diseasedTreeService.deleteById(treeId);
        return Result.success();
    }

    @PostMapping
    public Result addInfo(@RequestBody DiseasedTree diseasedTree){
        log.info("新增的病树信息是:" + diseasedTree);
        diseasedTreeService.addInfo(diseasedTree);
        return Result.success();
    }

//    @GetMapping("/{surveyId}")
//    public Result getInfo(@PathVariable String surveyId){
//        log.info("这批病树的调查人工号是:" + surveyId);
//        List<DiseasedTree> diseasedTree = diseasedTreeService.getInfo(surveyId);
//        return Result.success(diseasedTree);
//    }

    @GetMapping("/searchTreeById")
    public Result searchTreeById(String treeId){
        List<DiseasedTree> searchTree = diseasedTreeService.searchTreeById(treeId);
        return Result.success(searchTree);
    }

    @GetMapping
    public Result page(DiseasedTreeQueryParam  param){
        log.info("分页查询:" + param);
        PageResult<DiseasedTree> pageResult = diseasedTreeService.findByParam(param);
        return Result.success(pageResult);
    }
//    @GetMapping("/surveyId")
//    public Result listByUser(String surveyId){
//        List<DiseasedTree> listByUser = diseasedTreeService.listByUser(surveyId);
//        return Result.success(listByUser);
//    }

//    @GetMapping//添加功能findall，不要分页

    @GetMapping("/search")
    public Result findBySearchParam(DiseasedTressSearchParam  search){
        log.info("查询条件:" + search);
        List<DiseasedTree> list = diseasedTreeService.findBySearchParam(search);
        return Result.success(list);
    }

    @GetMapping("/statistics")
    public Result statisticsByGrade(){
//      List<DiseasedTreesGradeStatistics> list = diseasedTreeService.statisticsByGrade();
        List<Map<String,Integer>> list = diseasedTreeService.statisticsByGrade();
        return Result.success(list);
    }
    @GetMapping("/statistics/overview")
    public Result overview(){
        Map<String,Object> map = diseasedTreeService.overview();
        return Result.success(map);
    }

    @GetMapping("/outBounder")
    public Result sitePolygon(){
        String str = diseasedTreeService.sitePolygon();
        return Result.success(str);
    }

    @GetMapping("/AllBuffer")
    public Result showAllBuffer(Integer radius){
        String str = diseasedTreeService.showAllBuffer(radius);
        return Result.success(str);
    }

    @PostMapping("/within")
    public Result findByPolygon(@RequestBody Map<String,Object> body){
        // 前端传来 { polygon: { type: "Polygon", coordinates: [...] } }
        String polygonGeoJson = null;
        try {
            Object polygonObj = body.get("polygon");
            polygonGeoJson = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(polygonObj);
        }catch (Exception e){
            log.error("解析多边形GeoJSON失败", e);
            return Result.error("多边形数据格式错误");
        }
        log.info("多边形圈选查询,GeoJSON:{}",polygonGeoJson);
        List<DiseasedTree> list = diseasedTreeService.findByPolygon(polygonGeoJson);
        return Result.success(list);
    }

    @PostMapping("/planRoute")
    public Result planRoute(@RequestBody RoutePlanRequest request){
        List<String> pointIds = request.getPointIds();
        if(pointIds == null || pointIds.size() < 2){
            return Result.error("请至少选择 2 个点位");
        }
        if (pointIds.size() > 50) {
            return Result.error("单次最多选择 50 个点位");
        }
        log.info("路径规划请求，点位数量：{}", pointIds.size());
        RoutePlanResponse response = routePlanService.plan(request);
        if(response.getPointCount() < 2){
            return Result.error("有效点位不足，无法规划路径");
        }
        return Result.success(response);
    }





}
