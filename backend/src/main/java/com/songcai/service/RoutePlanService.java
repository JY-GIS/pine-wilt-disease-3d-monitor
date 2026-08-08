package com.songcai.service;

import com.songcai.pojo.RoutePlanRequest;
import com.songcai.pojo.RoutePlanResponse;

public interface RoutePlanService {
    RoutePlanResponse plan(RoutePlanRequest request);
}
