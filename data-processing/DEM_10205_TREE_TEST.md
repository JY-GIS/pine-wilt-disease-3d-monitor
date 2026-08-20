# 10,205 棵树 DEM 高程批处理记录

## 1. 本阶段目标

把现有64个空间块中的10,205个GPU Instance全部写入山东DEM高程，同时满足：

- 不覆盖原来的 `spatial` 性能基线；
- High和Low使用相同位置和高程；
- 不改变模型几何、旋转、缩放、Feature ID和Metadata；
- 先完成全量预检，再写输出，避免产生半套数据；
- 结果可以通过同一条命令重复生成。

## 2. 输入和输出

输入：

```text
data-processing/tree-tiles-lod-output/spatial
downloads/DEM/shandong-dem-12.5.tif
```

独立输出：

```text
data-processing/tree-tiles-lod-output/spatial-dem
```

原来的 `spatial` 目录保持只读。

## 3. 批处理过程

脚本对每个空间块执行以下流程：

1. 读取Low和High GLB。
2. 解码 `EXT_mesh_gpu_instancing.TRANSLATION`。
3. 检查Low/High的实例数量、顺序、Feature ID和Metadata是否一致。
4. 把实例局部坐标还原成ECEF坐标。
5. 把ECEF转换为经度、纬度和原椭球高。
6. 把经纬度转换到DEM的 `EPSG:32650` 坐标。
7. 使用周围2×2个像元做双线性高程插值。
8. 保持经纬度不变，用DEM高程重新计算ECEF和实例局部坐标。
9. 只写回实例 `TRANSLATION`，更新accessor的 `min/max`。
10. 根据每块实际DEM高程重新计算3D Tiles包围体高度。
11. 重新读取输出GLB，反向验证实际写入坐标。

64块全部预检成功后才会进入第8～11步。任何实例遇到DEM NoData、ID重复或
High/Low不对应，脚本都会先停止，不写入半套 `spatial-dem`。

## 4. 重新生成命令

在项目根目录执行：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe `
  .\data-processing\apply_dem_height_spatial_tiles.py
```

## 5. 输出结构

```text
spatial-dem/
├── manifest.json
├── dem-height-report.json
├── dem-height-samples.csv
├── validation-low.json
├── validation-high.json
├── low/
│   ├── tileset.json
│   ├── regions/        # 64个区域tileset
│   └── content/        # 64个Low GLB
└── high/
    ├── tileset.json
    ├── regions/        # 64个区域tileset
    └── content/        # 64个High GLB
```

`manifest.json` 供现有按区域LOD代码读取。`low/high/tileset.json` 是额外生成的
普通整套tileset，主要用于规范校验或临时直载。

## 6. 全量验证结果

- 空间块：64。
- GPU Instance：10,205。
- Low GLB：64个。
- High GLB：64个。
- DEM有效采样：10,205/10,205。
- 采样方式：全部为完整双线性插值。
- NoData失败：0。
- Metadata字段：`id`、`disease_level`。
- `id`：1～10,205连续，无缺号、无重复。
- DEM高程范围：约1.202～1074.222米。
- High/Low写回后最大水平差：0米。
- 输出GLB最大水平误差：约0.0027米。
- 输出GLB最大高程误差：约0.0019米。

疾病等级数量：

| disease_level | 数量 |
|---|---:|
| 1 | 2,029 |
| 2 | 2,049 |
| 3 | 1,994 |
| 4 | 2,031 |
| 5 | 2,102 |

## 7. 3D Tiles校验

使用本地 `3d-tiles-validator 0.6.1` 验证整套Low和High：

| 数据 | Errors | Warnings | Infos |
|---|---:|---:|---:|
| Low | 0 | 0 | 64 |
| High | 0 | 0 | 64 |

Info来自校验器不支持以下扩展，以及Low自带的未使用UV：

- `EXT_mesh_gpu_instancing`
- `EXT_instance_features`
- `EXT_structural_metadata`

它们不是本次DEM处理产生的新错误。

## 8. 基线保护和可重复性

完整批处理连续执行两次，并对输入和输出计算SHA-256：

- 原 `spatial`：257个文件，前后哈希差异0。
- 新 `spatial-dem`：261个生成文件，前后哈希差异0。

这说明脚本没有修改原始基线，并且新数据可以稳定重复生成。

## 9. 当前结论和下一步

本阶段已经证明10,205个实例都能取得有效DEM高程，并且可以安全写回High/Low
GPU Instancing数据。

当前尚未修改 `DemoTestView.vue`，页面仍加载原来的 `spatial`。下一步应增加一个
最小的数据集选择开关，让同一套聚合和High/Low LOD算法分别加载：

```text
spatial       # 原性能基线
spatial-dem   # 新DEM版本
```

然后在相同电脑、相同相机位置和相同场景下检查贴地效果、LOD切换以及FPS。

DEM垂直基准仍未从源文件元数据中确认。263棵人工观察高度正常，但扩大到全区域后，
仍应分别抽查低海拔、山区和边界区域，避免只观察一个空间块。
