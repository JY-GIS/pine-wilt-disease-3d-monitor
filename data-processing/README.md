# 病树 GPU Instancing、空间 LOD 与 DEM 高程处理

本文是 `data-processing` 的主操作说明，供开发人员、学习者和接手项目的 AI 使用。
执行任何数据脚本前，请先阅读“安全约束”和“常见误区”。

## 1. 当前完成状态

当前已经完成：

- 10,205 棵树使用 3D Tiles 1.1 与 GPU Instancing 加载；
- 数据切分为64个空间小块；
- 1千米内显示High，1～8千米显示Low，远处显示聚合树；
- GPU Instance可以被 `Cesium3DTileFeature` 单独Picking；
- 山东GeoTIFF DEM已为10,205棵树补充地面高程；
- 原始无高程基线和DEM版本分别保存，没有互相覆盖。

当前实测性能基线：

```text
约10,000棵Low

Entity/旧方案：约8 FPS
3D Tiles + GPU Instancing：约23 FPS
```

FPS与电脑、相机、窗口大小和场景有关。后续测试必须保持相同条件，不能通过修改测试
场景来人为提高数值。

## 2. 最重要的目录

```text
data-processing/
├── README.md
├── requirements-dem.txt
├── split_tree_tiles_spatial_lod.mjs
├── test_dem_height_cell.py
├── apply_dem_height_spatial_tiles.py
├── DEM_263_TREE_TEST.md
├── DEM_10205_TREE_TEST.md
├── dem/
│   ├── sample_dem.py
│   └── .venv/                         # 本机Python环境，不应提交
├── tiles/
│   ├── model/                         # High模型
│   ├── tree-models-lod/low/           # Low模型
│   └── generate_data/                 # 旧测试数据脚本
└── tree-tiles-lod-output/
    ├── high/                          # 原始High导出结果
    ├── low/                           # 原始Low导出结果
    ├── spatial/                       # 10,205棵无DEM高程稳定基线
    ├── spatial-dem-test/              # 263棵DEM试验结果
    └── spatial-dem/                   # 10,205棵DEM正式试验结果
```

DEM源文件默认位于：

```text
downloads/DEM/shandong-dem-12.5.tif
```

它当前是 `EPSG:32650`，像元约12.5米，NoData为 `-32768`。

## 3. 三套空间数据的区别

| 目录 | 数量 | 高程 | 用途 |
|---|---:|---|---|
| `spatial` | 10,205 | 原始高度约0 | 性能和位置基线，禁止覆盖 |
| `spatial-dem-test` | 263 | DEM高度 | 小范围算法与人工贴地验证 |
| `spatial-dem` | 10,205 | DEM高度 | 当前全量DEM测试数据 |

前端实验页当前加载：

```text
tree-tiles-lod-output/spatial-dem
```

配置位置：

```text
frontend/src/views/DemoTestView.vue
```

对应常量：

```js
const SPATIAL_MANIFEST_URI = '/tree-tiles/spatial-dem/manifest.json'
const SPATIAL_TILESET_BASE_URI = '/tree-tiles/spatial-dem'
```

如需回到无高程基线，只把这两个路径改回 `/tree-tiles/spatial`。不要删除或覆盖任何
数据目录。

## 4. 数据技术结构

树木瓦片使用：

```text
3D Tiles 1.1
+ GLB
+ EXT_mesh_gpu_instancing
+ EXT_instance_features
+ EXT_structural_metadata
```

这不是传统 `.i3dm` 文件。每个GLB用少量模型几何和大量实例变换绘制树木。

当前Metadata只有：

```text
id
disease_level
```

当前测试数据的 `id` 为1～10,205且全局唯一，但还不是正式数据库 `tree_id`。Feature ID
只在一个Property Table内局部有效，不能当作业务主键。

## 5. 安全约束

1. `tree-tiles-lod-output/spatial` 是已确认的性能基线，不允许覆盖。
2. DEM输出只能写入 `spatial-dem-test` 或 `spatial-dem`。
3. 不得把10,205棵树重新创建为10,205个Entity。
4. 不得把 `disease_level` 再次作为High/Low模型选择条件。
5. High/Low只表示几何精度，实例顺序、Feature ID和位置必须一致。
6. 不要修改模型几何来“修复”DEM高程；高程只应修改实例 `TRANSLATION`。
7. 未确认输入、输出目录前，不要运行空间切分脚本。

## 6. 安装DEM处理环境

建议使用Python 3.11或更高版本。在项目根目录执行：

```powershell
python -m venv data-processing/dem/.venv
.\data-processing\dem\.venv\Scripts\python.exe -m pip install --upgrade pip
.\data-processing\dem\.venv\Scripts\python.exe -m pip install `
  -r .\data-processing\requirements-dem.txt
```

确认依赖：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe -c `
  "import rasterio, pyproj, numpy; print(rasterio.__version__, pyproj.__version__, numpy.__version__)"
```

## 7. 查看DEM基本信息

可以先运行：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe `
  .\data-processing\dem\sample_dem.py
```

需要确认：

- 文件能正常打开；
- CRS存在；
- 病树经纬度位于DEM覆盖范围内；
- NoData设置正确；
- 高程最大值和最小值符合常识。

GeoServer WMS只能显示DEM颜色图片，不能为Cesium提供真正的三维地形，也不能替代
本地GeoTIFF高程采样。

## 8. 单空间块263棵试验

默认测试空间块是 `3_4_4`，包含263棵树：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe `
  .\data-processing\test_dem_height_cell.py `
  --cell-id 3_4_4
```

默认输入：

```text
tree-tiles-lod-output/spatial
```

默认输出：

```text
tree-tiles-lod-output/spatial-dem-test
```

该脚本适合验证一个小区域，不用于全量生产。详细过程和结果见：

```text
DEM_263_TREE_TEST.md
```

## 9. 全量10,205棵DEM处理

运行：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe `
  .\data-processing\apply_dem_height_spatial_tiles.py
```

也可以明确指定路径：

```powershell
.\data-processing\dem\.venv\Scripts\python.exe `
  .\data-processing\apply_dem_height_spatial_tiles.py `
  --source-root .\data-processing\tree-tiles-lod-output\spatial `
  --output-root .\data-processing\tree-tiles-lod-output\spatial-dem `
  --dem .\downloads\DEM\shandong-dem-12.5.tif
```

脚本分为两个阶段。

### 阶段一：只读预检

对全部64块检查：

- Low/High实例数量；
- 实例顺序；
- Feature ID；
- Metadata；
- ID全局唯一性；
- DEM是否有有效像元。

任何一点失败，脚本都会在写GLB之前停止。

### 阶段二：生成和反向验证

全部预检通过后：

- 把DEM高度写入Low和High实例 `TRANSLATION`；
- 更新accessor `min/max`；
- 更新每个区域的高程包围体；
- 重新读取输出GLB验证经纬度和高度；
- 生成manifest、逐树CSV和汇总报告。

输出：

```text
spatial-dem/
├── manifest.json
├── dem-height-report.json
├── dem-height-samples.csv
├── validation-low.json
├── validation-high.json
├── low/
│   ├── tileset.json
│   ├── regions/                       # 64个JSON
│   └── content/                       # 64个GLB
└── high/
    ├── tileset.json
    ├── regions/                       # 64个JSON
    └── content/                       # 64个GLB
```

详细实测结果见：

```text
DEM_10205_TREE_TEST.md
```

## 10. DEM高程写入原理

每棵树按以下步骤处理：

```text
实例局部TRANSLATION
        ↓ 加上GLB节点原点
glTF Y-up世界坐标
        ↓ 轴向转换
ECEF地心坐标
        ↓ EPSG:4978 → EPSG:4326/4979
经度、纬度、原高度
        ↓ EPSG:4326 → DEM CRS
DEM平面坐标
        ↓ 周围2×2像元双线性插值
DEM地面高程
        ↓ 经度、纬度、DEM高度重新转ECEF
新的实例TRANSLATION
```

脚本不会修改：

- 模型顶点和三角形；
- 实例旋转和缩放；
- Feature ID；
- `id`、`disease_level`；
- GPU Instancing扩展结构。

因此增加DEM高程不会把GPU Instancing退回Entity方案，也不会增加每棵树的独立Draw
Call。

## 11. 当前全量验证结果

```text
空间块：64
实例：10,205
DEM有效采样：10,205/10,205
NoData：0
id：1～10,205，无重复、无缺号
DEM高程：约1.202～1074.222米
High/Low最大水平差：0米
最大写入高程误差：约0.0019米
```

3D Tiles Validator：

| 数据 | Errors | Warnings | Infos |
|---|---:|---:|---:|
| Low | 0 | 0 | 64 |
| High | 0 | 0 | 64 |

Info是因为旧版校验器不支持GPU Instancing和结构化Metadata扩展，不是本次处理错误。

## 12. 启动和查看

终端一：启动3D Tiles静态服务。

```powershell
cd data-processing/tree-tiles-lod-output
python -m http.server 8000
```

终端二：启动前端。

```powershell
cd frontend
npm install
npm run dev
```

打开：

```text
http://localhost:5173/#/demo-test
```

Vite代理关系：

```text
/tree-tiles/spatial-dem/...
        ↓
http://localhost:8000/spatial-dem/...
```

当前页面逻辑：

```text
距离空间块约1千米内       → High
约1～8千米                → Low
约8千米外                 → 聚合树
```

进入/退出阈值略有差异，这是为避免摄像机位于边界时High/Low反复闪烁。

## 13. 页面验收清单

1. 平原、山区、数据边界分别观察树根是否贴地。
2. 拉近、拉远多次，确认聚合、Low、High可以重复切换。
3. 点击树木，确认仍返回 `Cesium3DTileFeature`。
4. 检查Metadata中的 `id` 和 `disease_level`。
5. 相同相机、窗口和场景下记录FPS。
6. 页面销毁后确认没有残留事件监听和tileset引用。

## 14. GeoTIFF与Cesium Terrain

当前状态：

```text
树木高度：本地山东GeoTIFF DEM
地面形状：Cesium World Terrain
```

如果两套数据在某处高度不同，树可能悬空或埋地。把GeoTIFF转换为Cesium Terrain后，
树木和地面可以使用同一高程来源。

Terrain转换不是当前树木高程脚本的一部分，也不是立即必做。以下情况建议实施：

- 山东全范围需要统一高程；
- 山区要求严格贴地；
- 需要本地或离线地形；
- Entity路径、起终点和查询结果需要精确贴地；
- 需要海拔、坡度或地形分析。

WMS只改变地表显示颜色，不会生成三维地形。

## 15. 常见问题

### 页面中的树仍然没有DEM高度

检查 `DemoTestView.vue` 是否仍指向 `/tree-tiles/spatial`。DEM版必须指向：

```text
/tree-tiles/spatial-dem
```

修改后使用 `Ctrl + F5` 强制刷新。

### 聚合树不消失

检查浏览器Network中对应区域JSON和GLB是否返回200，再看控制台是否有
`tileFailed`。不要先修改scale或创建Entity替代实例。

### Validator出现unused accessor或不支持扩展

旧版Validator不理解实例扩展引用，会把扩展使用的accessor提示为可能未使用。必须同时
查看errors、warnings和实际Cesium加载结果。

### 为什么数据库没有高程字段

当前高程在生成3D Tiles时从DEM派生，不要求修改数据库。数据库可以继续只保存
`tree_id`、经纬度和业务字段。是否缓存DEM高程属于后续业务设计，不是当前必要条件。

### `generate_i3dm.py` 能否生成当前瓦片

不能。它只验证 `py3dtiles` 能否导入。当前仓库没有保存最初从PostGIS导出完整GLB
实例瓦片的可复现工具；现有DEM脚本是在已导出的GLB基础上修改实例高程。

## 16. 旧测试数据脚本说明

`tiles/generate_data/generate_data.py` 和 `generate_sql.py` 是早期随机测试脚本。它们没有
固定随机种子，也不是当前10,205棵数据的完整可复现来源。

旧SQL曾把疾病等级映射到绿、黄、枯三种模型。这属于旧测试数据逻辑，不应扩展为正式
LOD规则。正式设计中：

```text
High/Low = 几何精度
disease_level = 业务属性
```

两者必须分开。

## 17. 给接手AI的最小上下文

在修改数据处理或Demo前，至少确认以下事实：

1. 当前实例总数是10,205，不是整数10,000。
2. 当前基线是 `spatial`，DEM版是 `spatial-dem`。
3. 页面使用3D Tiles GPU Instancing，不允许退回万级Entity。
4. Feature ID是瓦片内部编号，不是数据库业务主键。
5. 当前Metadata叫 `id`，未来正式接库时才应稳定映射为 `tree_id`。
6. High/Low实例变换必须逐值一致。
7. 当前Low约18个三角形/树，已经极低，不是主要性能瓶颈。
8. 修改前先保留8→23 FPS基线，并在相同条件下复测。
9. 不要覆盖 `spatial`，所有新实验必须写独立目录。
10. 先阅读 `DEM_263_TREE_TEST.md` 和 `DEM_10205_TREE_TEST.md` 的验证证据。

## 18. Git建议

建议提交：

- Python/Node数据处理脚本；
- README和测试记录；
- manifest、必要验证报告；
- 项目明确要求版本化的GLB/tileset输出。

不建议提交：

- `dem/.venv/`；
- `__pycache__/`；
- `.tmp-npm-cache/`；
- 临时HTTP服务器日志；
- 与本次数据处理无关的个人文件。
