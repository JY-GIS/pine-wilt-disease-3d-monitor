package com.songcai.service.impl;

import com.songcai.mapper.DiseasedTreeMapper;
import com.songcai.pojo.DiseasedTree;
import com.songcai.pojo.RoutePlanRequest;
import com.songcai.pojo.RoutePlanResponse;
import com.songcai.service.DiseasedTreeService;
import com.songcai.service.RoutePlanService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;

@Slf4j
@Service
public class RoutePlanServiceImpl implements RoutePlanService {

    private static final double EARTH_RADIUS = 6371000.0;

    @Autowired
    private DiseasedTreeMapper diseasedTreeMapper;

    @Override
    public RoutePlanResponse plan(RoutePlanRequest request){
        List<String> pointIds = request.getPointIds();
        log.info("路径规划请求,点位数量:{}",pointIds.size());
        // ------------------- 第 1 步：查数据库 -------------------
        List<DiseasedTree> treeList = diseasedTreeMapper.findByIds(pointIds);
        if(treeList == null || treeList.size() < 2){
            log.warn("有效点位不足2个,无法规划路径");
            //返回结果为空，前端处理
            RoutePlanResponse empty = new RoutePlanResponse();
            empty.setPointCount(0);
            empty.setTotalDistance(0);
            empty.setRoute(Collections.emptyList());
            empty.setLineGeometry(null);
            return empty;
        }
        Map<String,DiseasedTree> treeMap = new HashMap<>();
        for(DiseasedTree t : treeList){
            treeMap.put(t.getTreeId(),t);
        }
        // ------------------- 第 2 步：贪心排序 -------------------
        String startId = pointIds.get(0);          // 用户第一个点击的 = 起点
        Set<String> unvisited = new LinkedHashSet<>(pointIds);
        unvisited.remove(startId);
        List<String> orderedIds = new ArrayList<>();
        orderedIds.add(startId);                    // 起点排第一
        String currentId = startId;
        double totalDistance = 0.0;
        while (!unvisited.isEmpty()) {
            // 在未访问点中找离 currentId 最近的那个
            String nearestId = null;
            double minDist = Double.MAX_VALUE;
            DiseasedTree currentTree = treeMap.get(currentId);
            for (String candidateId : unvisited) {
                DiseasedTree candidateTree = treeMap.get(candidateId);
                // Haversine 计算两点距离
                double dist = haversine(
                        currentTree.getLatitude(), currentTree.getLongitude(),
                        candidateTree.getLatitude(), candidateTree.getLongitude()
                );
                if (dist < minDist) {
                    minDist = dist;
                    nearestId = candidateId;
                }
            }
            // 走过去
            totalDistance += minDist;
            orderedIds.add(nearestId);
            unvisited.remove(nearestId);
            currentId = nearestId;
        }
        log.info("贪心排序完成，总距离：{} 米", String.format("%.1f", totalDistance));
        // ------------------- 第 3 步：组装返回结果 -------------------
        RoutePlanResponse response = new RoutePlanResponse();
        response.setTotalDistance(totalDistance);
        response.setPointCount(orderedIds.size());
        // 路径点列表
        List<RoutePlanResponse.RoutePoint> route = new ArrayList<>();
        for (int i = 0; i < orderedIds.size(); i++) {
            String id = orderedIds.get(i);
            DiseasedTree tree = treeMap.get(id);
            RoutePlanResponse.RoutePoint rp = new RoutePlanResponse.RoutePoint();
            rp.setSeq(i + 1);
            rp.setTreeId(tree.getTreeId());
            rp.setSpecies(tree.getSpecies());
            rp.setGrade(tree.getGrade());
            rp.setLng(tree.getLongitude());
            rp.setLat(tree.getLatitude());
            rp.setStart(i == 0);   // 第一个 = 起点
            route.add(rp);
        }
        response.setRoute(route);
        // GeoJSON LineString 连线几何
        response.setLineGeometry(buildLineGeometry(route));
        return response;
    }

    // ================================================================
    //                       Haversine 距离公式
    // ================================================================
    /**
     * 计算两个经纬度坐标之间的球面距离（米）
     *
     * Haversine 公式：适合短距离计算，误差在 0.5% 以内
     *
     * @param lat1 点 1 纬度
     * @param lng1 点 1 经度
     * @param lat2 点 2 纬度
     * @param lng2 点 2 经度
     * @return 两点距离（米）
     */
    private double haversine(double lat1, double lng1,
                             double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1))
                * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS * c;
    }
    // ================================================================
    //                     GeoJSON LineString 构建
    // ================================================================
    /**
     * 根据排序后的路径点，构建 GeoJSON LineString
     *
     * 输出格式：
     * {
     *   "type": "LineString",
     *   "coordinates": [[118.032, 30.121], [118.045, 30.128], ...]
     * }
     */
    private Map<String, Object> buildLineGeometry(
            List<RoutePlanResponse.RoutePoint> route) {
        List<double[]> coords = new ArrayList<>();
        for (RoutePlanResponse.RoutePoint p : route) {
            // GeoJSON 规范：[经度, 纬度]
            coords.add(new double[]{p.getLng(), p.getLat()});
        }
        Map<String, Object> geo = new LinkedHashMap<>();
        geo.put("type", "LineString");
        geo.put("coordinates", coords);
        return geo;
    }

}
