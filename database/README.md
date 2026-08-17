# 数据库初始化说明

> SQL 阅读提示：`--` 开头的内容都是注释，不会被数据库执行；每条 SQL 语句通常以分号 `;` 结束。

## 1. 环境要求

- PostgreSQL 14.23（当前生产数据源版本）
- PostGIS 3.6.1
- 可创建扩展的数据库账号；当前库还使用 `postgis_sfcgal`、`cube` 和 `earthdistance`。

空间字段均采用 WGS 84 / EPSG:4326：病树为 `geometry(Point,4326)`，行政区为 `geometry(MultiPolygon,4326)`。

## 2. 初始化步骤

1. 创建空数据库（建议数据库名为 `songcai`）。
2. 执行 `schema.sql`，创建扩展、序列、业务表、约束，并恢复当前序列状态。
3. 执行 `index.sql`，创建当前数据库已有的普通与空间索引。
4. 执行 `data.sql`，恢复 `users` 和 `diseased_trees` 的完整当前数据。
5. 通过 QGIS 导入 `admin_region` 和 `city` 的原始空间数据（数据来源天地图）。

执行顺序不可交换：空间字段依赖 PostGIS，数据依赖表结构，空间查询依赖行政区数据。

## 3. 行政区划数据导入说明

`admin_region`（当前 34 条省级记录）与 `city`（当前 370 条市级记录）的几何数据未写入 `data.sql`，以避免将大规模 MultiPolygon 文本纳入工程脚本。

当前数据库没有原始数据文件、导入日志或来源元数据，因此无法确认具体来源；只能确认其来自外部 GIS 数据导入。推荐使用 QGIS 或其他 GIS 工具，将原始数据按真实字段结构导入：

- `admin_region`：`id`、`name`、`gb_code`、`level`、`geom`、`area_km2`
- `city`：`id`、`geom`、`name`、`gb_code`

导入目标几何类型均为 `MultiPolygon`，SRID 必须为 4326。该数据集当前存在 1 个无效省级面和 72 个无效市级面；本工程不修复或改变它们。

## 4. 空间索引说明

项目当前保留：

- 三张空间表 `geom` 上的 GiST 索引；病树表保留两个实际存在的重复 `geom` GiST 索引。
- `idx_diseased_trees_geom_geog`：`(geom::geography)` 的 GiST 表达式索引。

后端使用 `ST_DWithin`、`ST_Distance` 及 `geom::geography` 进行米制距离查询；同时以 `ST_Within` 将病树与省、市面进行空间归属和统计。

主键与唯一约束生成的 B-Tree 索引定义在 `schema.sql` 中，避免与 `index.sql` 重复创建。
