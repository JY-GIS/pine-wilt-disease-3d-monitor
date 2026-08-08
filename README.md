# 松材线虫病三维监测与管理平台

基于 Cesium 的松材线虫病三维监测可视化全栈项目，包含前端三维可视化与后端数据服务。

## 功能特性

- 病树三维可视化：Cesium 三维场景展示病树点位，支持视角飞行、点位点选与交互
- 行政区划联动：按省 / 市 / 区逐级筛选，区域信息卡片展示
- 病树分级筛选与统计：按等级筛选病树，ECharts 环形图展示分级统计
- 病树搜索与附近搜索：按名称 / 属性检索，支持以点位为中心的附近查询
- 缓冲区分析：对选中的树或点进行缓冲范围分析
- 多边形绘制与空间选择：在地图上绘制多边形进行空间范围查询
- 路径规划：病树巡查 / 路线规划

## 项目结构

```
pine-wilt-disease-3d-monitor/
├── frontend/   # 前端：Vue 3 + Vite + Cesium 三维可视化
└── backend/    # 后端：Spring Boot + MyBatis + PostgreSQL/PostGIS
```

## 技术栈

- 前端：Vue 3、Vite、Cesium、Pinia、ECharts、Turf.js
- 后端：Spring Boot 3.5、MyBatis、PostgreSQL + PostGIS

## 本地运行

### 后端

1. 用 IDEA 打开 `backend` 目录
2. 在运行配置的环境变量里设置：`DB_PASSWORD=数据库密码`
3. 运行 `SongcaiNematodeBackendApplication`

### 前端

1. 进入 `frontend` 目录
2. 创建 `.env.local` 文件，写入一行：`VITE_CESIUM_TOKEN=你的Cesium Ion Token`
3. 执行 `pnpm install`
4. 执行 `pnpm dev`，浏览器打开提示的地址