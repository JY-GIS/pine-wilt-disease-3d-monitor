package com.songcai.service.impl;

import com.songcai.mapper.AdminDivisionMapper;
import com.songcai.pojo.ProvinceStats;
import com.songcai.service.AdminDivisionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AdminDivisionServiceImpl implements AdminDivisionService {
    @Autowired
    private AdminDivisionMapper adminDivisionMapper;

    // ==================== 省级查询 ====================

    @Override
    public List<ProvinceStats> findAllProvincesWithStats(){
        List<ProvinceStats> list = adminDivisionMapper.findAllProvincesWithStats();
        for(ProvinceStats p : list){
            p.setSeverity(calcSeverity(p.getTreeCount()));
        }
        return list;
    }

    @Override
    public List<String> findTreeIdsByGbCode(String gbCode) {
        return adminDivisionMapper.findTreeIdsByGbCode(gbCode);
    }

    // ==================== 市级查询 ====================
    @Override
    public List<String> findTreeIdsByCityGbCode(String cityGbCode) {
        return adminDivisionMapper.findTreeIdsByCityGbCode(cityGbCode);
    }

    @Override
    public List<ProvinceStats> findCitiesByProvinceGbCode(String provinceGbCode) {
        List<ProvinceStats> list = adminDivisionMapper.findCitiesByProvinceGbCode(provinceGbCode);
        for (ProvinceStats p : list) {
            p.setSeverity(calcSeverity(p.getTreeCount()));
        }
        return list;
    }


    private String calcSeverity(Long treeCount) {
        if (treeCount == null || treeCount == 0) {
            return "none";
        }if (treeCount <= 50) {
            return "low";
        }if (treeCount <= 500) {
            return "moderate";
        }
        return "high";
    }

}
