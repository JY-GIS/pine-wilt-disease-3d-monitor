package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class DiseasedTreesGradeStatistics {
    private int grade;         //感染等级（1–5）
    Integer count;
}
