package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class RoutePlanResponse {
    private double totalDistance;
    private int pointCount;
    private List<RoutePoint> route;
    private Object lineGeometry;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RoutePoint {
        private int seq;
        private String treeId;
        private String species;
        private int grade;
        private double lng;
        private double lat;
        private boolean isStart;
    }

}
