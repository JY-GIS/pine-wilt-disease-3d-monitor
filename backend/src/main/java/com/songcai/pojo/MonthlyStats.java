package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 月度趋势统计 POJO
 *
 * 对应 SQL：
 *   SELECT TO_CHAR(DATE_TRUNC('month', survey_date), 'YYYY-MM') AS month,
 *          COUNT(*) AS new_count,
 *          SUM(COUNT(*)) OVER (ORDER BY ...) AS cumulative_count,
 *          AVG(longitude) AS center_lng,
 *          AVG(latitude) AS center_lat
 *   FROM diseased_trees ...
 *
 * 使用场景：
 *   前端月度趋势图（ECharts）+ 疫情重心迁移线（Cesium）
 */

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MonthlyStats {
    /** 月份，格式 yyyy-MM，如 "2026-06" */
    private String month;
    /** 当月新增病树数量 */
    private Integer newCount;
    /** 截至当月累计病树数量（窗口函数累加） */
    private Long cumulativeCount;
    /** 当月新增病树重心经度 AVG(longitude)，无新增时为 null */
    private Double centerLng;
    /** 当月新增病树重心纬度 AVG(latitude)，无新增时为 null */
    private Double centerLat;
}
