package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.postgis.Geometry;

@Slf4j
@Data
@AllArgsConstructor
@NoArgsConstructor
public class DiseasedTressSearchParam {
    private double longitude;
    private double latitude;
    private double radius;
}
