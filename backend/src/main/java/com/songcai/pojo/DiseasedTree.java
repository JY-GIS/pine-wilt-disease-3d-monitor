package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.postgis.Geometry;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class DiseasedTree {
    private String treeId;     //系统自动生成，格式 SC-年月日-序号
    private double longitude;  //经度
    private double latitude;   //纬度
    private String species;    //树种（预定义列表中选择）
    private int grade;         //感染等级（1–5）
    private int chest;         //胸径（厘米）
    private String surveyId;   //调查人工号
    private String surveyDate; //调查日期（自动填当天）
    private String username;     //对应调查人信息
    private Double distance;
    private String geomText;   // 对应 ST_AsText(geom) 的返回结果
}
