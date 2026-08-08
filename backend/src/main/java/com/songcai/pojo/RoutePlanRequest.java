package com.songcai.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.apache.logging.log4j.message.Message;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class RoutePlanRequest {
    private List<String> pointIds;
}

