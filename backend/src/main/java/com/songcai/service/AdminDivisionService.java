package com.songcai.service;

import com.songcai.pojo.ProvinceStats;

import java.util.List;

public interface AdminDivisionService {

    List<ProvinceStats> findAllProvincesWithStats();

    List<ProvinceStats> findCitiesByProvinceGbCode(String provinceGbCode);

    List<String> findTreeIdsByGbCode(String gbCode);

    List<String> findTreeIdsByCityGbCode(String cityGbCode);

}
