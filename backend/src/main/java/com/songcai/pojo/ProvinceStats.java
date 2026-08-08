package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ProvinceStats {
    private Integer id;
    private String name;
    private String gbCode;
    private String severity;//严重程度 —— none / low / moderate / high
    private Long treeCount;
    private Integer grade1;
    private Integer grade2;
    private Integer grade3;
    private Integer grade4;
    private Integer grade5;
    /**
     * ST_AsGeoJSON(geom) 的返回值，即该省多边形 GeoJSON 字符串
     * 前端用 JSON.parse() 还原为 GeoJSON 对象
     */
    private String geojson;

    private String boundary;
}
