# 263 棵树 DEM 高程试验记录

## 1. 试验目的

本试验只回答一个问题：能否把现有 GPU Instancing 树木的平面位置保留不变，
再从山东 DEM 读取每棵树的地面高程，并写回 High/Low 3D Tiles。

本次使用空间块 `3_4_4`，其中正好有 263 棵树。原来的 10,205 棵
`spatial` 数据没有被覆盖，试验结果单独写入 `spatial-dem-test`。

## 2. 输入数据

- 原始空间块：`tree-tiles-lod-output/spatial`
- Low：`spatial/low/content/3_4_4.glb`
- High：`spatial/high/content/3_4_4.glb`
- DEM：`downloads/DEM/shandong-dem-12.5.tif`
- DEM 坐标系：`EPSG:32650`
- DEM 像元大小：约 12.5 米
- 实例数量：263

这 263 棵来自当前 10,205 棵测试数据中的一个小空间块，不是真实业务数据库表的
一次重新导出。因此本次先验证“高程处理流程”，不验证后端业务数据链路。

## 3. 实际处理流程

每棵树按以下顺序处理：

1. 从 GLB 的 `EXT_mesh_gpu_instancing.TRANSLATION` 读取实例局部坐标。
2. 结合 GLB 节点矩阵，还原实例的 ECEF 世界坐标。
3. 把 ECEF 转换为经度、纬度和原椭球高。
4. 把经纬度投影到 DEM 的 `EPSG:32650` 坐标。
5. 读取点周围 2×2 个 DEM 像元，使用双线性插值计算高程。
6. 保持经纬度不变，用 DEM 高程重新计算 ECEF 坐标。
7. 把新 ECEF 坐标转换回 glTF Y-up 局部坐标。
8. 只写回实例 `TRANSLATION`，并更新该 accessor 的 `min/max`。
9. High 和 Low 使用完全相同的经纬度及 DEM 高程，避免 LOD 切换时跳位。
10. 按 DEM 最低/最高值重新设置 tileset 高程包围范围。

模型几何、实例旋转、实例缩放、Feature ID、`id`、`disease_level` 都没有修改。

## 4. 如何重新生成

在项目根目录执行：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe `
  .\data-processing\test_dem_height_cell.py `
  --cell-id 3_4_4
```

脚本默认输出到：

```text
data-processing/tree-tiles-lod-output/spatial-dem-test
```

脚本可以重复执行，只会更新这个独立试验目录，不会写入原来的 `spatial` 目录。

## 5. 生成结果

```text
spatial-dem-test/
├── manifest.json
├── dem-height-report.json
├── dem-height-samples.csv
├── low/
│   ├── tileset.json
│   ├── regions/3_4_4.json
│   └── content/3_4_4.glb
└── high/
    ├── tileset.json
    ├── regions/3_4_4.json
    └── content/3_4_4.glb
```

- `dem-height-report.json`：机器可读的完整验证结果。
- `dem-height-samples.csv`：263 棵树逐棵的经纬度、原高程、DEM 高程和变化量。
- `low/high/tileset.json`：可单独加载的单空间块 tileset。
- `low/high/regions/3_4_4.json`：供现有 Demo 的按区域 LOD 逻辑加载。

## 6. 本次自动验证结果

- GLB 实例数：263，与 manifest 的 `treeCount` 一致。
- 有效 DEM 采样：263/263。
- 采样方式：263 个点全部为完整双线性插值，没有 NoData 回退。
- 原实例椭球高：约 -0.045 ～ -0.043 米。
- 写入的 DEM 高程：约 207.236 ～ 585.287 米。
- High/Low 写入前最大水平位置差：0 米。
- High/Low 写入后最大水平位置差：0 米。
- GLB 反向解析后的最大水平误差：约 0.0011 米。
- GLB 反向解析后的最大高程误差：约 0.0006 米。
- Low/High 各有 2407 个二进制字节变化，全部位于实例 `TRANSLATION`。
- Metadata 字段仍为 `id`、`disease_level`，263 个 `id` 在该块内均唯一。
- 3D Tiles Validator 对 Low/High 都给出 0 error、0 warning。

Validator 的 info 是因为 0.6.1 版不认识
`EXT_mesh_gpu_instancing`、`EXT_instance_features`、
`EXT_structural_metadata`，以及 Low 自带未使用的 UV；这些不是本次产生的新错误。

## 7. Cesium 人工验证记录

验证时曾在 `DemoTestView.vue` 中临时直接加载：

```text
/tree-tiles/spatial-dem-test/low/tileset.json
```

该临时入口没有创建聚合树，也没有执行 High/Low 切换，只用于观察 DEM 高程写回后的
Low 实例。人工观察确认树木高度正常，因此263棵小范围验证通过。

验证完成后，`DemoTestView.vue` 已恢复为原来的10,205棵稳定LOD版本；测试脚本、
输出数据和本记录继续保留。当前页面不再提供 `dem263=1` 临时入口。

## 8. 已完成的人工检查

1. 263 棵 Low 保持 GPU Instancing。
2. 页面能够显示真实树实例，而不是用263个 Entity 代替。
3. 树木使用写入后的 DEM 高程，人工观察高度正常。
4. 原 Metadata 和实例级 Picking 结构没有被处理脚本修改。

需要注意：当前 Viewer 使用 Cesium World Terrain，而树高程来自本地 TIFF。
两套地形数据的分辨率和垂直基准可能不同，所以局部偏差不能仅凭肉眼直接归因于脚本。

## 9. 当前限制

DEM 文件的垂直基准尚未从元数据中确认。本试验暂时把 DEM 数值直接当作 Cesium
椭球高使用。如果 DEM 实际保存的是正常高（海拔），生产处理前必须确认是否需要做
高程基准转换，否则可能出现整体一致的上下偏移。

本次 263 棵只验证流程正确性，不能替代 10,205 棵的 FPS 基准测试，也没有把 DEM
转换成 Cesium Terrain。确认这批树的贴地效果后，下一步才应该扩展到 10,205 棵。
