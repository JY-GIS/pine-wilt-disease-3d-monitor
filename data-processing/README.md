# 树木 3D Tiles 数据处理说明

本目录用于松材线虫病三维监测系统的大规模病树模型加载实验。传统 Cesium Entity 方案在万级树木模型下会产生大量 Entity 与 Model 对象，增加 CPU 管理开销并降低帧率。

当前实验页改用 Cesium 3D Tiles 加载预生成的树木瓦片，并在需要时对实例进行拾取。Low LOD 瓦片、关闭阴影和动态屏幕空间误差共同构成当前性能基线：

- Cesium Entity 树木模型：约 8 FPS
- 3D Tiles 树木瓦片：约 28 FPS

> 当前仓库中的瓦片内容是 `.glb`、`tileset.json` 与 `.subtree` 文件；`generate_i3dm.py` 仅用于验证 `py3dtiles` 依赖是否可导入，并不会生成 i3dm 文件。

## 一、目录结构

```text
data-processing/
├── README.md
├── dem/
│   └── sample_dem.py                   # 查看 DEM 坐标系、范围、波段和 NoData
├── tiles/
│   ├── generate_data/
│   │   ├── generate_data.py            # 生成随机坐标 JSON（instances-before.json）
│   │   ├── generate_sql.py             # 生成 10,000 条 INSERT SQL（tree_instances.sql）
│   │   ├── generate_i3dm.py            # 验证 py3dtiles 是否可用
│   │   ├── instances-before.json        # generate_data.py 的输出
│   │   ├── instances.json               # 当前保留的实例数据
│   │   └── tree_instances.sql           # generate_sql.py 的输出
│   ├── model/                           # 高精度 GLB：绿树、黄树、枯树
│   └── tree-models-lod/
│       ├── low/                         # Low LOD GLB：绿树、黄树、枯树
│       ├── source/                      # 源 GLB
│       └── blender/                     # Blender 工程文件
├── tree-tiles-output/                  # 一套普通树木瓦片导出结果
└── tree-tiles-lod-output/              # high、medium、low 三套 LOD 瓦片结果

../database/test_i3dm.sql               # tree_instances 表和 3D Tiles 数据视图
```

模型文件名如下：

```text
tiles/model/pine-green.glb
tiles/model/pine-yellow.glb
tiles/model/pine-dry.glb

tiles/tree-models-lod/low/pine-green-low.glb
tiles/tree-models-lod/low/pine-yellow-low.glb
tiles/tree-models-lod/low/pine-dry-low.glb
```

## 二、当前数据流程

```text
树木 GLB 模型
        ↓
生成随机实例 SQL（generate_sql.py）
        ↓
PostGIS tree_instances 表
        ↓
tree_instances_3dtiles / tree_instances_3dtiles_low 视图
        ↓
3D Tiles 导出结果（本仓库已保留）
        ↓
tileset.json
        ↓
Cesium.Cesium3DTileset 加载
```

仓库目前没有保存从 PostGIS 视图到瓦片目录的自动化导出脚本；如需重新导出，请使用原有导出工具，并确认导出目录完整。

## 三、生成测试实例

进入数据生成目录：

```powershell
cd data-processing/tiles/generate_data
```

### 生成随机坐标 JSON

```powershell
python generate_data.py
```

生成 `instances-before.json`。每条记录的实际字段为：

```json
{
  "id": 0,
  "longitude": 117.5,
  "latitude": 36.2,
  "height": 0,
  "scale": 15
}
```

随机范围为经度 `117.0 ~ 118.5`、纬度 `35.0 ~ 37.0`。

### 生成 PostGIS 导入 SQL

```powershell
python generate_sql.py
```

生成 `tree_instances.sql`，内含 10,000 条 `INSERT INTO tree_instances` 语句。实际字段为 `geom`、`disease_level`、`scale` 和 `model`；病害等级与模型映射为：

| 病害等级 | 模型 |
| --- | --- |
| 1、2 | `pine-green.glb` |
| 3、4 | `pine-yellow.glb` |
| 5 | `pine-dry.glb` |

`generate_data.py` 与 `generate_sql.py` 都独立随机生成数据；后者不会读取 `instances-before.json`。

### 验证 py3dtiles 依赖

```powershell
pip install py3dtiles
python generate_i3dm.py
```

若输出 `py3dtiles正常`，表示该 Python 包可以导入。

## 四、准备 PostGIS 数据

先在项目根目录执行 `database/test_i3dm.sql`，再导入生成的实例 SQL：

```powershell
psql -U postgres -d songcai -f database/test_i3dm.sql
psql -U postgres -d songcai -f data-processing/tiles/generate_data/tree_instances.sql
```

将 `postgres` 和 `songcai` 改为实际的用户名和数据库名。

注意：`database/test_i3dm.sql` 在创建 `tree_instances` 后紧接着包含 `drop table tree_instances;`。首次初始化前，必须先删除或注释这一句，否则新建表会立即被删除，后续视图创建也会失败。

该 SQL 会创建两个视图：

- `tree_instances_3dtiles`：引用 `tiles/model/` 下的高精度模型。
- `tree_instances_3dtiles_low`：将模型映射到 `tiles/tree-models-lod/low/` 下的 Low LOD 模型。

模型路径目前使用 `D:/pine-wilt-disease-3d-monitor/...` 绝对路径；项目换目录或换电脑时，需要更新 SQL 中的路径。

## 五、预览已有的 Low LOD 瓦片

当前前端实验页只加载 `tree-tiles-lod-output/low/tileset.json`，不自动切换到 high 或 medium 瓦片。

在第一个终端中启动静态文件服务：

```powershell
cd data-processing/tree-tiles-lod-output
python -m http.server 8000
```

在第二个终端启动前端：

```powershell
cd frontend
pnpm install
pnpm dev
```

访问前端开发服务器的 `/#/demo-test`。`frontend/vite.config.js` 会将：

```text
/tree-tiles/low/tileset.json
```

代理到：

```text
http://localhost:8000/low/tileset.json
```

页面启用 FPS 显示；单击树木后，可在浏览器控制台查看被拾取要素的属性。

## 六、查看 DEM 元数据（可选）

在 `dem/sample_dem.py` 中修改 `dem_path` 为本机 DEM 文件路径，然后执行：

```powershell
pip install rasterio
python data-processing/dem/sample_dem.py
```

脚本会输出 DEM 的坐标系、空间范围、波段数和 NoData 值。

## 七、重新导出检查项

重新导出瓦片后，应检查以下内容是否完整、路径是否一致：

```text
tileset.json
content/
subtrees/
```

并验证模型路径、坐标系、模型朝向与高程设置。`tree-tiles-output/` 和 `tree-tiles-lod-output/` 是导出产物；`.tmp-npm-cache/` 是本机 npm 缓存，不应提交到 Git。
