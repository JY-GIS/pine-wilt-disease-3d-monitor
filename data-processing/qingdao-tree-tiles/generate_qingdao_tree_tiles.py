"""生成并验证青岛市级 High/Low GPU Instancing 3D Tiles。

真实数据链路：Spring Boot REST -> 青岛 1055 棵病树 -> GeoTIFF DEM ->
8x8 空间网格 -> High/Low GLB -> tileset/manifest/validation-report。

本脚本不会修改数据库，也不会覆盖既有输出。只有显式传入 ``--replace`` 时，
才会把旧输出改名为带时间戳的备份，再原子切换到新输出。
"""

from __future__ import annotations

# ★====== 新增：青岛真实业务数据到 3D Tiles 的单文件生成器

import argparse
import copy
import hashlib
import json
import math
import shutil
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

# 第三方库延迟报错，让 ``--help`` 在尚未安装依赖时仍可使用。
# 真正生成前由 require_runtime_dependencies 一次性阻断。（★常见，标准 CLI 写法）
DEPENDENCY_IMPORT_ERROR: ModuleNotFoundError | None = None
try:
    import numpy as np
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import Window
except ModuleNotFoundError as error:
    DEPENDENCY_IMPORT_ERROR = error
    np = None  # type: ignore[assignment]
    rasterio = None  # type: ignore[assignment]
    Transformer = None  # type: ignore[assignment,misc]
    Window = None  # type: ignore[assignment,misc]


GLB_MAGIC = 0x46546C67
GLB_VERSION = 2
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

BYTE = 5120
UNSIGNED_BYTE = 5121
SHORT = 5122
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125
FLOAT = 5126

COMPONENT_FORMATS: dict[int, tuple[str, int]] = {
    BYTE: ("b", 1),
    UNSIGNED_BYTE: ("B", 1),
    SHORT: ("h", 2),
    UNSIGNED_SHORT: ("H", 2),
    UNSIGNED_INT: ("I", 4),
    FLOAT: ("f", 4),
}
TYPE_COMPONENT_COUNTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}

CITY_GB_CODE = "156370200"
CITY_NAME = "青岛市"
EXPECTED_TREE_COUNT = 1055
GRID_DIVISIONS = 8
INSTANCE_SCALE = 15.0
GROUND_MARGIN_METERS = 5.0
TREE_MARGIN_METERS = 60.0
ROOT_HORIZONTAL_PADDING_DEGREES = 0.001
MAX_MODEL_BOUNDS_DIFFERENCE = 1e-5
MAX_COORDINATE_ERROR_METERS = 0.1

MODEL_GROUP_ORDER = ("green", "yellow", "dry")
GRADE_TO_MODEL_GROUP = {1: "green", 2: "green", 3: "yellow", 4: "yellow", 5: "dry"}


@dataclass(frozen=True)
class TreeRecord:
    """一棵树在 High/Low 中共享的标准实例数据。"""

    tree_id: str
    longitude: float
    latitude: float
    disease_level: int
    dem_height: float
    dem_sample_status: str
    model_group: str
    yaw_radians: float
    cell_x: int = -1
    cell_y: int = -1


@dataclass
class GlbDocument:
    json_data: dict[str, Any]
    binary_data: bytearray


@dataclass(frozen=True)
class ModelSource:
    level: str
    group: str
    path: Path
    document: GlbDocument
    bounds: tuple[tuple[float, float, float], tuple[float, float, float]]
    sha256: str


@dataclass(frozen=True)
class GeneratedInstance:
    model_group: str
    tree_id: str
    disease_level: int
    feature_id: int
    translation: tuple[float, float, float]
    rotation: tuple[float, float, float, float]
    scale: tuple[float, float, float]
    longitude: float
    latitude: float
    height: float


def parse_args() -> argparse.Namespace:
    """命令行参数集中声明，避免把本机路径散落在业务逻辑中。"""
    script_dir = Path(__file__).resolve().parent
    repo_dir = script_dir.parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", default="http://localhost:8080")
    parser.add_argument("--city-gb-code", default=CITY_GB_CODE)
    parser.add_argument("--expected-count", type=int, default=EXPECTED_TREE_COUNT)
    parser.add_argument("--grid-divisions", type=int, default=GRID_DIVISIONS)
    parser.add_argument("--scale", type=float, default=INSTANCE_SCALE)
    parser.add_argument("--http-timeout", type=float, default=20.0)
    parser.add_argument(
        "--dem",
        type=Path,
        default=repo_dir / "downloads" / "DEM" / "qingdao-dem-12.5.tif",
    )
    parser.add_argument(
        "--high-model-dir",
        type=Path,
        default=repo_dir / "data-processing" / "tiles" / "model",
    )
    parser.add_argument(
        "--low-model-dir",
        type=Path,
        default=repo_dir / "data-processing" / "tree-tiles-lod-output" / "low",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=(
            repo_dir
            / "data-processing"
            / "tree-tiles-lod-output"
            / "cities"
            / CITY_GB_CODE
        ),
    )
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="只验证 REST、DEM、模型和 1055 棵实例，不写输出",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="保留旧目录为时间戳备份后，用新结果替换 output",
    )
    return parser.parse_args()


def align4(value: int) -> int:
    return (value + 3) & ~3


def require_runtime_dependencies() -> None:
    if DEPENDENCY_IMPORT_ERROR is not None:
        missing_name = DEPENDENCY_IMPORT_ERROR.name or "未知依赖"
        raise RuntimeError(
            f"缺少 Python 依赖 {missing_name!r}。请按照 "
            "data-processing/requirements-dem.txt 安装 numpy、rasterio、pyproj。"
        ) from DEPENDENCY_IMPORT_ERROR


def finite_float(value: Any, field_name: str, tree_id: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{tree_id} 的 {field_name} 不是数字：{value!r}") from error
    if not math.isfinite(result):
        raise ValueError(f"{tree_id} 的 {field_name} 不是有限数：{result}")
    return result


def http_get_json(url: str, timeout: float) -> Any:
    """urllib 是标准库，无需额外引入 requests。（★常见，建议理解超时与错误处理）"""
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "qingdao-tree-tiles-generator/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return json.loads(response.read().decode(charset))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {error.code}：{url}\n{body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"无法访问后端：{url}\n{error.reason}") from error


def unwrap_result(payload: Any, url: str) -> Any:
    if not isinstance(payload, dict):
        raise ValueError(f"后端返回不是 Result 对象：{url}")
    if payload.get("code") != 1:
        raise ValueError(f"后端接口失败：{url}，msg={payload.get('msg')!r}")
    return payload.get("data")


def fetch_city_trees(
    backend_url: str,
    city_gb_code: str,
    expected_count: int,
    timeout: float,
) -> list[dict[str, Any]]:
    """通过两个真实接口取交集，禁止把全国数据误打进青岛瓦片。"""
    base_url = backend_url.rstrip("/")
    ids_url = f"{base_url}/admin-division/cities/{urllib.parse.quote(city_gb_code)}/treeIds"
    city_ids_raw = unwrap_result(http_get_json(ids_url, timeout), ids_url)
    if not isinstance(city_ids_raw, list):
        raise ValueError("城市 treeIds 接口 data 必须是数组")
    city_ids = [str(value) for value in city_ids_raw]
    id_counts = Counter(city_ids)
    duplicate_city_ids = sorted(tree_id for tree_id, count in id_counts.items() if count > 1)
    if duplicate_city_ids:
        raise ValueError(f"城市 treeIds 接口存在重复值：{duplicate_city_ids[:10]}")
    if len(city_ids) != expected_count:
        raise ValueError(
            f"{CITY_NAME}树数与确认设计不一致：接口={len(city_ids)}，预期={expected_count}。"
            "请先确认数据库变更，不要带病生成。"
        )

    query = urllib.parse.urlencode({"page": 1, "pageSize": max(5000, expected_count * 2)})
    trees_url = f"{base_url}/diseasedTrees?{query}"
    page_data = unwrap_result(http_get_json(trees_url, timeout), trees_url)
    if isinstance(page_data, dict):
        all_rows = page_data.get("rows")
    else:
        all_rows = page_data
    if not isinstance(all_rows, list):
        raise ValueError("病树接口 data.rows 必须是数组")

    rows_by_id: dict[str, dict[str, Any]] = {}
    duplicate_rows: list[str] = []
    for row in all_rows:
        if not isinstance(row, dict) or row.get("treeId") is None:
            raise ValueError("病树接口存在缺少 treeId 的记录")
        tree_id = str(row["treeId"])
        if tree_id in rows_by_id:
            duplicate_rows.append(tree_id)
        rows_by_id[tree_id] = row
    if duplicate_rows:
        raise ValueError(f"病树接口存在重复 treeId：{sorted(set(duplicate_rows))[:10]}")

    missing_ids = sorted(set(city_ids) - rows_by_id.keys())
    if missing_ids:
        raise ValueError(f"分页病树接口缺少 {len(missing_ids)} 个青岛 treeId：{missing_ids[:10]}")
    return [rows_by_id[tree_id] for tree_id in sorted(city_ids)]


def deterministic_yaw(tree_id: str) -> float:
    """稳定散列保证重复生成时树冠朝向不漂移。（★常见：可复现随机）"""
    integer = int.from_bytes(hashlib.sha256(tree_id.encode("utf-8")).digest()[:8], "little")
    return integer / float(1 << 64) * math.tau


def sample_dem_bilinear(
    dataset: rasterio.io.DatasetReader,
    x: float,
    y: float,
) -> tuple[float, str]:
    """双线性插值；边缘有部分 NoData 时只对有效像元重新归一化。"""
    inverse_transform = ~dataset.transform
    pixel_column, pixel_row = inverse_transform * (x, y)
    center_column = pixel_column - 0.5
    center_row = pixel_row - 0.5
    column0 = math.floor(center_column)
    row0 = math.floor(center_row)
    column_fraction = center_column - column0
    row_fraction = center_row - row0
    weights = np.array(
        [
            [(1 - column_fraction) * (1 - row_fraction), column_fraction * (1 - row_fraction)],
            [(1 - column_fraction) * row_fraction, column_fraction * row_fraction],
        ],
        dtype=np.float64,
    )
    values = dataset.read(
        1,
        window=Window(column0, row0, 2, 2),
        boundless=True,
        masked=True,
    )
    valid = ~np.ma.getmaskarray(values)
    valid_weights = weights * valid
    weight_sum = float(valid_weights.sum())
    if weight_sum <= 0:
        raise ValueError(f"DEM 无有效像元：x={x}, y={y}")
    elevation = float(
        (np.asarray(values.filled(0), dtype=np.float64) * valid_weights).sum()
        / weight_sum
    )
    return elevation, "bilinear" if bool(valid.all()) else "partial_bilinear"


def prepare_tree_records(
    rows: Sequence[dict[str, Any]],
    dem_path: Path,
    grid_divisions: int,
) -> tuple[list[TreeRecord], dict[str, Any], tuple[float, float, float, float]]:
    if grid_divisions < 1:
        raise ValueError("grid-divisions 必须 >= 1")
    if not dem_path.is_file():
        raise FileNotFoundError(dem_path)

    canonical: list[dict[str, Any]] = []
    for row in rows:
        tree_id = str(row["treeId"])
        longitude = finite_float(row.get("longitude"), "longitude", tree_id)
        latitude = finite_float(row.get("latitude"), "latitude", tree_id)
        try:
            disease_level = int(row.get("grade"))
        except (TypeError, ValueError) as error:
            raise ValueError(f"{tree_id} 的 grade 非法：{row.get('grade')!r}") from error
        if disease_level not in GRADE_TO_MODEL_GROUP:
            raise ValueError(f"{tree_id} 的 grade 必须是 1～5，实际为 {disease_level}")
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ValueError(f"{tree_id} 经纬度超出 WGS84 范围")
        canonical.append(
            {
                "tree_id": tree_id,
                "longitude": longitude,
                "latitude": latitude,
                "disease_level": disease_level,
            }
        )

    longitudes = [item["longitude"] for item in canonical]
    latitudes = [item["latitude"] for item in canonical]
    west, east = min(longitudes), max(longitudes)
    south, north = min(latitudes), max(latitudes)
    if east <= west or north <= south:
        raise ValueError("青岛树点范围退化，不能建立空间网格")

    records: list[TreeRecord] = []
    sample_status_counts: Counter[str] = Counter()
    failures: list[str] = []
    # rasterio.open 保证同一个 GeoTIFF 只打开一次。（★常见，标准写法）
    with rasterio.open(dem_path) as dem:
        if dem.crs is None:
            raise ValueError(f"DEM 缺少 CRS：{dem_path}")
        wgs84_to_dem = Transformer.from_crs("EPSG:4326", dem.crs, always_xy=True)
        for item in canonical:
            dem_x, dem_y = wgs84_to_dem.transform(item["longitude"], item["latitude"])
            try:
                dem_height, status = sample_dem_bilinear(dem, dem_x, dem_y)
            except ValueError as error:
                failures.append(f"{item['tree_id']}: {error}")
                continue
            if not math.isfinite(dem_height):
                failures.append(f"{item['tree_id']}: DEM 高程不是有限数")
                continue
            cell_x = min(
                grid_divisions - 1,
                max(0, math.floor((item["longitude"] - west) / (east - west) * grid_divisions)),
            )
            cell_y = min(
                grid_divisions - 1,
                max(0, math.floor((item["latitude"] - south) / (north - south) * grid_divisions)),
            )
            sample_status_counts[status] += 1
            records.append(
                TreeRecord(
                    tree_id=item["tree_id"],
                    longitude=item["longitude"],
                    latitude=item["latitude"],
                    disease_level=item["disease_level"],
                    dem_height=dem_height,
                    dem_sample_status=status,
                    model_group=GRADE_TO_MODEL_GROUP[item["disease_level"]],
                    yaw_radians=deterministic_yaw(item["tree_id"]),
                    cell_x=cell_x,
                    cell_y=cell_y,
                )
            )
        dem_info = {
            "path": str(dem_path),
            "crs": str(dem.crs),
            "pixelSize": [abs(dem.transform.a), abs(dem.transform.e)],
            "nodata": dem.nodata,
            "sampleStatusCounts": dict(sorted(sample_status_counts.items())),
        }
    if failures:
        raise ValueError(
            f"有 {len(failures)} 棵树无法取得 DEM 高程，未生成任何输出：\n"
            + "\n".join(failures[:20])
        )
    return records, dem_info, (west, south, east, north)


def read_glb(path: Path) -> GlbDocument:
    raw = path.read_bytes()
    if len(raw) < 20:
        raise ValueError(f"GLB 文件过短：{path}")
    magic, version, total_length = struct.unpack_from("<III", raw, 0)
    if magic != GLB_MAGIC or version != GLB_VERSION or total_length != len(raw):
        raise ValueError(f"不是有效的 glTF 2.0 GLB：{path}")
    json_data: dict[str, Any] | None = None
    binary_data: bytearray | None = None
    offset = 12
    while offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        chunk = raw[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            json_data = json.loads(chunk.rstrip(b" \t\r\n\0").decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            binary_data = bytearray(chunk)
    if json_data is None or binary_data is None:
        raise ValueError(f"GLB 缺少 JSON 或 BIN chunk：{path}")
    if len(json_data.get("buffers", [])) != 1:
        raise ValueError(f"当前生成器要求源模型只有一个内嵌 buffer：{path}")
    return GlbDocument(json_data, binary_data)


def write_glb(document: GlbDocument, path: Path) -> None:
    document.json_data["buffers"] = [{"byteLength": len(document.binary_data)}]
    json_bytes = json.dumps(
        document.json_data,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary_bytes = bytes(document.binary_data)
    binary_bytes += b"\0" * ((-len(binary_bytes)) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    result = bytearray(struct.pack("<III", GLB_MAGIC, GLB_VERSION, total_length))
    result += struct.pack("<II", len(json_bytes), JSON_CHUNK)
    result += json_bytes
    result += struct.pack("<II", len(binary_bytes), BIN_CHUNK)
    result += binary_bytes
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(result)


def accessor_layout(document: GlbDocument, accessor_index: int) -> tuple[int, int, int, int, int]:
    accessor = document.json_data["accessors"][accessor_index]
    if "sparse" in accessor:
        raise ValueError(f"暂不支持 sparse accessor：{accessor_index}")
    view = document.json_data["bufferViews"][accessor["bufferView"]]
    component_type = accessor["componentType"]
    if component_type not in COMPONENT_FORMATS or accessor["type"] not in TYPE_COMPONENT_COUNTS:
        raise ValueError(f"不支持的 accessor：{accessor_index}")
    component_count = TYPE_COMPONENT_COUNTS[accessor["type"]]
    element_size = COMPONENT_FORMATS[component_type][1] * component_count
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", element_size)
    return start, stride, accessor["count"], component_type, component_count


def read_accessor(document: GlbDocument, accessor_index: int) -> list[tuple[Any, ...]]:
    start, stride, count, component_type, component_count = accessor_layout(
        document, accessor_index
    )
    code, _ = COMPONENT_FORMATS[component_type]
    fmt = "<" + code * component_count
    return [
        struct.unpack_from(fmt, document.binary_data, start + index * stride)
        for index in range(count)
    ]


def model_position_bounds(document: GlbDocument, path: Path) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    if document.json_data.get("images") or document.json_data.get("textures"):
        raise ValueError(f"当前树模型不应依赖纹理图片：{path}")
    scene_index = document.json_data.get("scene", 0)
    scenes = document.json_data.get("scenes", [])
    if len(scenes) != 1 or scene_index != 0 or len(scenes[0].get("nodes", [])) != 1:
        raise ValueError(f"源模型必须是单场景、单根节点：{path}")
    node_index = scenes[0]["nodes"][0]
    node = document.json_data.get("nodes", [])[node_index]
    if node.get("children") or "mesh" not in node:
        raise ValueError(f"源模型根节点必须直接引用 mesh 且没有 children：{path}")
    if any(key in node for key in ("matrix", "translation", "rotation", "scale")):
        raise ValueError(
            f"源模型节点仍有未烘焙变换：{path}。必须使用已按 High AABB 归一化的 Low 模型。"
        )
    mesh = document.json_data["meshes"][node["mesh"]]
    positions: list[tuple[float, float, float]] = []
    for primitive in mesh["primitives"]:
        position_accessor = primitive.get("attributes", {}).get("POSITION")
        if position_accessor is None:
            raise ValueError(f"模型 primitive 缺少 POSITION：{path}")
        values = read_accessor(document, position_accessor)
        positions.extend((float(x), float(y), float(z)) for x, y, z in values)
    if not positions:
        raise ValueError(f"模型没有顶点：{path}")
    minimum = tuple(min(value[axis] for value in positions) for axis in range(3))
    maximum = tuple(max(value[axis] for value in positions) for axis in range(3))
    return minimum, maximum  # type: ignore[return-value]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_models(high_dir: Path, low_dir: Path) -> dict[str, dict[str, ModelSource]]:
    paths = {
        "high": {
            "green": high_dir / "pine-green.glb",
            "yellow": high_dir / "pine-yellow.glb",
            "dry": high_dir / "pine-dry.glb",
        },
        "low": {
            "green": low_dir / "pine-green-low.glb",
            "yellow": low_dir / "pine-yellow-low.glb",
            "dry": low_dir / "pine-dry-low.glb",
        },
    }
    result: dict[str, dict[str, ModelSource]] = {"high": {}, "low": {}}
    for level, level_paths in paths.items():
        for group, path in level_paths.items():
            resolved = path.resolve()
            if not resolved.is_file():
                raise FileNotFoundError(resolved)
            document = read_glb(resolved)
            bounds = model_position_bounds(document, resolved)
            result[level][group] = ModelSource(
                level=level,
                group=group,
                path=resolved,
                document=document,
                bounds=bounds,
                sha256=sha256_file(resolved),
            )
    for group in MODEL_GROUP_ORDER:
        high_bounds = result["high"][group].bounds
        low_bounds = result["low"][group].bounds
        maximum_difference = max(
            abs(high_bounds[side][axis] - low_bounds[side][axis])
            for side in range(2)
            for axis in range(3)
        )
        if maximum_difference > MAX_MODEL_BOUNDS_DIFFERENCE:
            raise ValueError(
                f"{group} High/Low AABB 未归一化：最大差 {maximum_difference:.9f} m"
            )
    return result


def pack_vectors(values: Sequence[Sequence[float]], width: int) -> bytes:
    if any(len(value) != width for value in values):
        raise ValueError(f"向量宽度必须为 {width}")
    flat = [float(component) for value in values for component in value]
    return struct.pack("<" + "f" * len(flat), *flat)


def pack_uint32(values: Sequence[int]) -> bytes:
    if any(value < 0 or value > 0xFFFFFFFF for value in values):
        raise ValueError("UINT32 数值越界")
    return struct.pack("<" + "I" * len(values), *values)


def encode_strings(values: Sequence[str]) -> tuple[bytes, bytes]:
    encoded = [value.encode("utf-8") for value in values]
    offsets = [0]
    for value in encoded:
        offsets.append(offsets[-1] + len(value))
    return b"".join(encoded), pack_uint32(offsets)


def ecef_to_gltf(vector: Sequence[float]) -> tuple[float, float, float]:
    """与现有 DEM 脚本保持相同坐标约定：glTF(X,Y,Z)=ECEF(X,Z,-Y)。"""
    return float(vector[0]), float(vector[2]), -float(vector[1])


def gltf_to_ecef(vector: Sequence[float]) -> tuple[float, float, float]:
    return float(vector[0]), -float(vector[2]), float(vector[1])


def quaternion_from_rotation_matrix(matrix: np.ndarray) -> tuple[float, float, float, float]:
    """3x3 旋转矩阵转 glTF 四元数 [x,y,z,w]。（★重要，建议能解释而非默写公式）"""
    if matrix.shape != (3, 3):
        raise ValueError("旋转矩阵必须是 3x3")
    trace = float(np.trace(matrix))
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2
        w = 0.25 * s
        x = (matrix[2, 1] - matrix[1, 2]) / s
        y = (matrix[0, 2] - matrix[2, 0]) / s
        z = (matrix[1, 0] - matrix[0, 1]) / s
    else:
        diagonal_index = int(np.argmax(np.diag(matrix)))
        if diagonal_index == 0:
            s = math.sqrt(1.0 + matrix[0, 0] - matrix[1, 1] - matrix[2, 2]) * 2
            w = (matrix[2, 1] - matrix[1, 2]) / s
            x = 0.25 * s
            y = (matrix[0, 1] + matrix[1, 0]) / s
            z = (matrix[0, 2] + matrix[2, 0]) / s
        elif diagonal_index == 1:
            s = math.sqrt(1.0 + matrix[1, 1] - matrix[0, 0] - matrix[2, 2]) * 2
            w = (matrix[0, 2] - matrix[2, 0]) / s
            x = (matrix[0, 1] + matrix[1, 0]) / s
            y = 0.25 * s
            z = (matrix[1, 2] + matrix[2, 1]) / s
        else:
            s = math.sqrt(1.0 + matrix[2, 2] - matrix[0, 0] - matrix[1, 1]) * 2
            w = (matrix[1, 0] - matrix[0, 1]) / s
            x = (matrix[0, 2] + matrix[2, 0]) / s
            y = (matrix[1, 2] + matrix[2, 1]) / s
            z = 0.25 * s
    quaternion = np.array([x, y, z, w], dtype=np.float64)
    norm = float(np.linalg.norm(quaternion))
    if norm <= 0:
        raise ValueError("无法从旋转矩阵得到有效四元数")
    quaternion /= norm
    if quaternion[3] < 0:
        quaternion *= -1
    return tuple(float(value) for value in quaternion)  # type: ignore[return-value]


def instance_rotation(longitude: float, latitude: float, yaw: float) -> tuple[float, float, float, float]:
    """让模型 Y 轴沿地表法线，同时围绕树干加入可复现的随机朝向。"""
    lon = math.radians(longitude)
    lat = math.radians(latitude)
    east_ecef = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north_ecef = np.array(
        [-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)]
    )
    up_ecef = np.array(
        [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
    )
    cosine = math.cos(yaw)
    sine = math.sin(yaw)
    # 模型局部轴采用 X=东、Y=上、Z=-北，再绕局部 Y 轴旋转。
    x_ecef = east_ecef * cosine + north_ecef * sine
    y_ecef = up_ecef
    z_ecef = east_ecef * sine - north_ecef * cosine
    rotation = np.column_stack(
        [ecef_to_gltf(x_ecef), ecef_to_gltf(y_ecef), ecef_to_gltf(z_ecef)]
    )
    orthogonality_error = float(np.max(np.abs(rotation.T @ rotation - np.identity(3))))
    determinant = float(np.linalg.det(rotation))
    if orthogonality_error > 1e-10 or abs(determinant - 1.0) > 1e-10:
        raise ValueError("实例 ENU 旋转矩阵不是正交右手系")
    return quaternion_from_rotation_matrix(rotation)


class GltfBuilder:
    """把一个源树模型和同等级实例数组组装进同一个 GLB。"""

    def __init__(self, generator_name: str) -> None:
        self.binary = bytearray()
        self.gltf: dict[str, Any] = {
            "asset": {"version": "2.0", "generator": generator_name},
            "scene": 0,
            "scenes": [{"name": "Qingdao tree cell", "nodes": []}],
            "nodes": [],
            "meshes": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [{"byteLength": 0}],
            "materials": [],
            "extensionsUsed": [
                "EXT_mesh_gpu_instancing",
                "EXT_instance_features",
                "EXT_structural_metadata",
            ],
            "extensionsRequired": [
                "EXT_mesh_gpu_instancing",
                "EXT_instance_features",
                "EXT_structural_metadata",
            ],
            "extensions": {
                "EXT_structural_metadata": {
                    "schema": {
                        "id": "qingdao_tree_schema",
                        "classes": {
                            "tree": {
                                "properties": {
                                    "tree_id": {"type": "STRING"},
                                    "disease_level": {"type": "STRING"},
                                }
                            }
                        },
                    },
                    "propertyTables": [],
                }
            },
        }

    def append_binary(self, data: bytes | bytearray) -> int:
        aligned_offset = align4(len(self.binary))
        if aligned_offset > len(self.binary):
            self.binary.extend(b"\0" * (aligned_offset - len(self.binary)))
        start = len(self.binary)
        self.binary.extend(data)
        return start

    def append_buffer_view(
        self,
        data: bytes | bytearray,
        *,
        target: int | None = None,
        byte_stride: int | None = None,
    ) -> int:
        byte_offset = self.append_binary(data)
        view: dict[str, Any] = {
            "buffer": 0,
            "byteOffset": byte_offset,
            "byteLength": len(data),
        }
        if target is not None:
            view["target"] = target
        if byte_stride is not None:
            view["byteStride"] = byte_stride
        self.gltf["bufferViews"].append(view)
        return len(self.gltf["bufferViews"]) - 1

    def append_accessor(
        self,
        data: bytes,
        component_type: int,
        accessor_type: str,
        count: int,
        *,
        minimum: Sequence[float] | None = None,
        maximum: Sequence[float] | None = None,
    ) -> int:
        view_index = self.append_buffer_view(data)
        accessor: dict[str, Any] = {
            "bufferView": view_index,
            "byteOffset": 0,
            "componentType": component_type,
            "count": count,
            "type": accessor_type,
        }
        if minimum is not None:
            accessor["min"] = [float(value) for value in minimum]
        if maximum is not None:
            accessor["max"] = [float(value) for value in maximum]
        self.gltf["accessors"].append(accessor)
        return len(self.gltf["accessors"]) - 1

    def import_mesh(self, source: ModelSource) -> int:
        """复制源几何并重定位所有 glTF 索引；源文件保持只读。"""
        source_json = source.document.json_data
        if source_json.get("skins") or source_json.get("animations") or source_json.get("cameras"):
            raise ValueError(f"树模型不应包含蒙皮、动画或相机：{source.path}")
        if source_json.get("images") or source_json.get("textures") or source_json.get("samplers"):
            raise ValueError(f"当前生成器只接受无外部纹理的树模型：{source.path}")

        binary_base = self.append_binary(source.document.binary_data)
        buffer_view_base = len(self.gltf["bufferViews"])
        accessor_base = len(self.gltf["accessors"])
        material_base = len(self.gltf["materials"])

        for source_view in source_json.get("bufferViews", []):
            if source_view.get("buffer", 0) != 0:
                raise ValueError(f"源模型 bufferView 不引用 buffer 0：{source.path}")
            view = copy.deepcopy(source_view)
            view["buffer"] = 0
            view["byteOffset"] = binary_base + source_view.get("byteOffset", 0)
            self.gltf["bufferViews"].append(view)

        for source_accessor in source_json.get("accessors", []):
            accessor = copy.deepcopy(source_accessor)
            if "bufferView" in accessor:
                accessor["bufferView"] += buffer_view_base
            self.gltf["accessors"].append(accessor)

        self.gltf["materials"].extend(copy.deepcopy(source_json.get("materials", [])))
        source_scene = source_json["scenes"][source_json.get("scene", 0)]
        source_node = source_json["nodes"][source_scene["nodes"][0]]
        source_mesh = copy.deepcopy(source_json["meshes"][source_node["mesh"]])
        source_mesh["name"] = f"{source.level}-{source.group}-{source_mesh.get('name', 'tree')}"
        for primitive in source_mesh["primitives"]:
            primitive["attributes"] = {
                semantic: accessor_index + accessor_base
                for semantic, accessor_index in primitive["attributes"].items()
            }
            if "indices" in primitive:
                primitive["indices"] += accessor_base
            if "material" in primitive:
                primitive["material"] += material_base
            if "targets" in primitive:
                primitive["targets"] = [
                    {
                        semantic: accessor_index + accessor_base
                        for semantic, accessor_index in target.items()
                    }
                    for target in primitive["targets"]
                ]
        self.gltf["meshes"].append(source_mesh)
        return len(self.gltf["meshes"]) - 1

    def add_instanced_model(
        self,
        source: ModelSource,
        records: Sequence[TreeRecord],
        node_origin_gltf: tuple[float, float, float],
        wgs84_to_ecef: Transformer,
        scale: float,
    ) -> None:
        if not records:
            return
        mesh_index = self.import_mesh(source)
        translations: list[tuple[float, float, float]] = []
        rotations: list[tuple[float, float, float, float]] = []
        scales: list[tuple[float, float, float]] = []
        for record in records:
            ecef = wgs84_to_ecef.transform(
                record.longitude, record.latitude, record.dem_height
            )
            gltf_position = ecef_to_gltf(ecef)
            translations.append(
                tuple(gltf_position[axis] - node_origin_gltf[axis] for axis in range(3))
            )
            rotations.append(
                instance_rotation(record.longitude, record.latitude, record.yaw_radians)
            )
            scales.append((scale, scale, scale))

        translation_array = np.asarray(translations, dtype=np.float32)
        rotation_array = np.asarray(rotations, dtype=np.float32)
        scale_array = np.asarray(scales, dtype=np.float32)
        translation_accessor = self.append_accessor(
            translation_array.tobytes(),
            FLOAT,
            "VEC3",
            len(records),
            minimum=translation_array.min(axis=0),
            maximum=translation_array.max(axis=0),
        )
        rotation_accessor = self.append_accessor(
            rotation_array.tobytes(), FLOAT, "VEC4", len(records)
        )
        scale_accessor = self.append_accessor(
            scale_array.tobytes(),
            FLOAT,
            "VEC3",
            len(records),
            minimum=scale_array.min(axis=0),
            maximum=scale_array.max(axis=0),
        )
        feature_ids = list(range(len(records)))
        feature_accessor = self.append_accessor(
            pack_uint32(feature_ids), UNSIGNED_INT, "SCALAR", len(records)
        )

        tree_values, tree_offsets = encode_strings([record.tree_id for record in records])
        level_values, level_offsets = encode_strings(
            [str(record.disease_level) for record in records]
        )
        tree_values_view = self.append_buffer_view(tree_values)
        tree_offsets_view = self.append_buffer_view(tree_offsets)
        level_values_view = self.append_buffer_view(level_values)
        level_offsets_view = self.append_buffer_view(level_offsets)
        property_tables = self.gltf["extensions"]["EXT_structural_metadata"]["propertyTables"]
        property_table_index = len(property_tables)
        property_tables.append(
            {
                "name": f"{source.group} trees",
                "class": "tree",
                "count": len(records),
                "properties": {
                    "tree_id": {
                        "values": tree_values_view,
                        "stringOffsets": tree_offsets_view,
                        "stringOffsetType": "UINT32",
                    },
                    "disease_level": {
                        "values": level_values_view,
                        "stringOffsets": level_offsets_view,
                        "stringOffsetType": "UINT32",
                    },
                },
            }
        )

        node_index = len(self.gltf["nodes"])
        self.gltf["nodes"].append(
            {
                "name": f"{source.level}-{source.group}-instances",
                "mesh": mesh_index,
                "matrix": [
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    *node_origin_gltf, 1,
                ],
                "extras": {"modelGroup": source.group, "lodLevel": source.level},
                "extensions": {
                    "EXT_mesh_gpu_instancing": {
                        "attributes": {
                            "TRANSLATION": translation_accessor,
                            "ROTATION": rotation_accessor,
                            "SCALE": scale_accessor,
                            "_FEATURE_ID_0": feature_accessor,
                        }
                    },
                    "EXT_instance_features": {
                        "featureIds": [
                            {
                                "featureCount": len(records),
                                "attribute": 0,
                                "propertyTable": property_table_index,
                            }
                        ]
                    },
                },
            }
        )
        self.gltf["scenes"][0]["nodes"].append(node_index)

    def build(self) -> GlbDocument:
        if not self.gltf["nodes"]:
            raise ValueError("不能生成没有实例节点的 GLB")
        if not self.gltf["materials"]:
            self.gltf.pop("materials")
        self.gltf["buffers"][0]["byteLength"] = len(self.binary)
        return GlbDocument(self.gltf, self.binary)


def read_buffer_view(document: GlbDocument, buffer_view_index: int) -> bytes:
    view = document.json_data["bufferViews"][buffer_view_index]
    start = view.get("byteOffset", 0)
    return bytes(document.binary_data[start : start + view["byteLength"]])


def read_string_property(
    document: GlbDocument,
    definition: dict[str, Any],
    count: int,
) -> list[str]:
    values = read_buffer_view(document, definition["values"])
    offsets_raw = read_buffer_view(document, definition["stringOffsets"])
    offset_type = definition.get("stringOffsetType", "UINT32")
    formats = {"UINT8": ("<B", 1), "UINT16": ("<H", 2), "UINT32": ("<I", 4)}
    if offset_type not in formats:
        raise ValueError(f"不支持的 stringOffsetType：{offset_type}")
    fmt, size = formats[offset_type]
    offsets = [struct.unpack_from(fmt, offsets_raw, index * size)[0] for index in range(count + 1)]
    if offsets != sorted(offsets) or offsets[-1] > len(values):
        raise ValueError("字符串 Metadata offset 非法")
    return [values[offsets[index] : offsets[index + 1]].decode("utf-8") for index in range(count)]


def node_origin(node: dict[str, Any]) -> tuple[float, float, float]:
    matrix = node.get("matrix")
    if not isinstance(matrix, list) or len(matrix) != 16:
        raise ValueError("生成的实例节点必须使用 4x4 matrix")
    identity_rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    actual_rotation = [
        matrix[0], matrix[1], matrix[2],
        matrix[4], matrix[5], matrix[6],
        matrix[8], matrix[9], matrix[10],
    ]
    if any(abs(float(actual) - expected) > 1e-12 for actual, expected in zip(actual_rotation, identity_rotation)):
        raise ValueError("实例节点 matrix 不应再包含旋转或缩放")
    return float(matrix[12]), float(matrix[13]), float(matrix[14])


def inspect_generated_glb(
    path: Path,
    ecef_to_wgs84: Transformer,
) -> list[GeneratedInstance]:
    """重新读取落盘 GLB，验证真实字节而不是只相信内存对象。"""
    document = read_glb(path)
    gltf = document.json_data
    required = {
        "EXT_mesh_gpu_instancing",
        "EXT_instance_features",
        "EXT_structural_metadata",
    }
    if set(gltf.get("extensionsRequired", [])) != required:
        raise ValueError(f"扩展声明不完整：{path}")
    metadata = gltf.get("extensions", {}).get("EXT_structural_metadata")
    if not isinstance(metadata, dict):
        raise ValueError(f"缺少 EXT_structural_metadata：{path}")
    schema_properties = (
        metadata.get("schema", {})
        .get("classes", {})
        .get("tree", {})
        .get("properties", {})
    )
    if set(schema_properties) != {"tree_id", "disease_level"}:
        raise ValueError(f"Metadata schema 只能包含 tree_id、disease_level：{path}")

    records: list[GeneratedInstance] = []
    property_tables = metadata.get("propertyTables", [])
    for node in gltf.get("nodes", []):
        extensions = node.get("extensions", {})
        if "EXT_mesh_gpu_instancing" not in extensions:
            continue
        group = node.get("extras", {}).get("modelGroup")
        if group not in MODEL_GROUP_ORDER:
            raise ValueError(f"实例节点 modelGroup 非法：{path}")
        attributes = extensions["EXT_mesh_gpu_instancing"]["attributes"]
        if set(attributes) != {"TRANSLATION", "ROTATION", "SCALE", "_FEATURE_ID_0"}:
            raise ValueError(f"实例属性不完整：{path}")
        translations = read_accessor(document, attributes["TRANSLATION"])
        rotations = read_accessor(document, attributes["ROTATION"])
        scales = read_accessor(document, attributes["SCALE"])
        feature_ids = [int(value[0]) for value in read_accessor(document, attributes["_FEATURE_ID_0"])]
        count = len(translations)
        if not (len(rotations) == len(scales) == len(feature_ids) == count):
            raise ValueError(f"实例属性 count 不一致：{path}")
        if feature_ids != list(range(count)):
            raise ValueError(f"Feature ID 必须在每个节点内从 0 连续编号：{path}")

        feature_definitions = extensions.get("EXT_instance_features", {}).get("featureIds", [])
        if len(feature_definitions) != 1:
            raise ValueError(f"每个节点必须有一个 Feature ID 定义：{path}")
        feature_definition = feature_definitions[0]
        if feature_definition.get("featureCount") != count:
            raise ValueError(f"featureCount 与实例数不一致：{path}")
        table_index = feature_definition.get("propertyTable")
        if not isinstance(table_index, int) or not (0 <= table_index < len(property_tables)):
            raise ValueError(f"propertyTable 索引非法：{path}")
        table = property_tables[table_index]
        if table.get("count") != count or set(table.get("properties", {})) != {
            "tree_id",
            "disease_level",
        }:
            raise ValueError(f"Property Table 字段或 count 非法：{path}")
        tree_ids = read_string_property(document, table["properties"]["tree_id"], count)
        disease_levels = read_string_property(
            document, table["properties"]["disease_level"], count
        )
        origin = node_origin(node)
        for index in range(count):
            translation = tuple(float(value) for value in translations[index])
            rotation = tuple(float(value) for value in rotations[index])
            scale = tuple(float(value) for value in scales[index])
            if abs(math.sqrt(sum(value * value for value in rotation)) - 1.0) > 1e-5:
                raise ValueError(f"实例四元数未归一化：{path}#{index}")
            gltf_position = tuple(origin[axis] + translation[axis] for axis in range(3))
            ecef = gltf_to_ecef(gltf_position)
            longitude, latitude, height = ecef_to_wgs84.transform(*ecef)
            try:
                disease_level = int(disease_levels[index])
            except ValueError as error:
                raise ValueError(f"disease_level 不是整数字符串：{path}#{index}") from error
            records.append(
                GeneratedInstance(
                    model_group=group,
                    tree_id=tree_ids[index],
                    disease_level=disease_level,
                    feature_id=feature_ids[index],
                    translation=translation,
                    rotation=rotation,
                    scale=scale,
                    longitude=float(longitude),
                    latitude=float(latitude),
                    height=float(height),
                )
            )
    if not records:
        raise ValueError(f"GLB 没有 GPU Instance：{path}")
    return records


def horizontal_error_meters(expected: TreeRecord, actual: GeneratedInstance) -> float:
    return math.hypot(
        (expected.longitude - actual.longitude)
        * 111_320
        * math.cos(math.radians(expected.latitude)),
        (expected.latitude - actual.latitude) * 110_540,
    )


def validate_generated_level(
    expected_records: Sequence[TreeRecord],
    actual_records: Sequence[GeneratedInstance],
    scale: float,
    path: Path,
) -> dict[str, float]:
    expected_order = [
        record
        for group in MODEL_GROUP_ORDER
        for record in sorted(
            (item for item in expected_records if item.model_group == group),
            key=lambda item: item.tree_id,
        )
    ]
    if len(expected_order) != len(actual_records):
        raise ValueError(f"实例数不一致：{path}，{len(actual_records)} != {len(expected_order)}")
    maximum_horizontal_error = 0.0
    maximum_height_error = 0.0
    for expected, actual in zip(expected_order, actual_records):
        if (
            expected.tree_id != actual.tree_id
            or expected.disease_level != actual.disease_level
            or expected.model_group != actual.model_group
        ):
            raise ValueError(f"实例顺序、Metadata 或等级模型映射不一致：{path}")
        if any(abs(value - scale) > 1e-5 for value in actual.scale):
            raise ValueError(f"scale 不是 {scale}：{path}#{actual.tree_id}")
        maximum_horizontal_error = max(
            maximum_horizontal_error,
            horizontal_error_meters(expected, actual),
        )
        maximum_height_error = max(
            maximum_height_error,
            abs(expected.dem_height - actual.height),
        )
    if (
        maximum_horizontal_error > MAX_COORDINATE_ERROR_METERS
        or maximum_height_error > MAX_COORDINATE_ERROR_METERS
    ):
        raise ValueError(
            f"坐标误差超过 {MAX_COORDINATE_ERROR_METERS} m：{path}，"
            f"horizontal={maximum_horizontal_error}，height={maximum_height_error}"
        )
    return {
        "maximumHorizontalErrorMeters": maximum_horizontal_error,
        "maximumHeightErrorMeters": maximum_height_error,
    }


def validate_high_low_alignment(
    low_records: Sequence[GeneratedInstance],
    high_records: Sequence[GeneratedInstance],
    cell_id: str,
) -> float:
    if len(low_records) != len(high_records):
        raise ValueError(f"{cell_id} High/Low 实例数不一致")
    maximum_position_difference = 0.0
    for low, high in zip(low_records, high_records):
        if (
            low.model_group != high.model_group
            or low.tree_id != high.tree_id
            or low.disease_level != high.disease_level
            or low.feature_id != high.feature_id
            or low.rotation != high.rotation
            or low.scale != high.scale
        ):
            raise ValueError(f"{cell_id} High/Low 实例顺序、Metadata、旋转或缩放不一致")
        difference = math.sqrt(
            (low.longitude - high.longitude) ** 2
            + (low.latitude - high.latitude) ** 2
            + ((low.height - high.height) / 111_320) ** 2
        ) * 111_320
        maximum_position_difference = max(maximum_position_difference, difference)
    if maximum_position_difference > MAX_COORDINATE_ERROR_METERS:
        raise ValueError(f"{cell_id} High/Low 位置差超过 0.1 m")
    return maximum_position_difference


def cell_region(
    cell_x: int,
    cell_y: int,
    divisions: int,
    root_bounds: tuple[float, float, float, float],
    records: Sequence[TreeRecord],
) -> list[float]:
    west, south, east, north = root_bounds
    width = (east - west) / divisions
    height = (north - south) / divisions
    cell_west = west + cell_x * width
    cell_south = south + cell_y * height
    cell_east = west + (cell_x + 1) * width
    cell_north = south + (cell_y + 1) * height
    minimum_height = math.floor(min(record.dem_height for record in records) - GROUND_MARGIN_METERS)
    maximum_height = math.ceil(max(record.dem_height for record in records) + TREE_MARGIN_METERS)
    return [
        math.radians(cell_west),
        math.radians(cell_south),
        math.radians(cell_east),
        math.radians(cell_north),
        minimum_height,
        maximum_height,
    ]


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_region_tileset(path: Path, region: Sequence[float], content_uri: str) -> None:
    write_json(
        path,
        {
            "asset": {"version": "1.1"},
            "geometricError": 1000,
            "root": {
                "boundingVolume": {"region": list(region)},
                "geometricError": 0,
                "refine": "ADD",
                "content": {"uri": content_uri},
            },
        },
    )


def write_combined_tileset(path: Path, root_region: Sequence[float], cells: Sequence[dict[str, Any]]) -> None:
    write_json(
        path,
        {
            "asset": {"version": "1.1"},
            "geometricError": 1000,
            "root": {
                "boundingVolume": {"region": list(root_region)},
                "geometricError": 1000,
                "refine": "ADD",
                "children": [
                    {
                        "boundingVolume": {"region": cell["region"]},
                        "geometricError": 0,
                        "refine": "ADD",
                        "content": {"uri": f"content/{cell['id']}.glb"},
                    }
                    for cell in cells
                ],
            },
        },
    )


def generate_cell_glb(
    level: str,
    cell_records: Sequence[TreeRecord],
    models: dict[str, dict[str, ModelSource]],
    wgs84_to_ecef: Transformer,
    scale: float,
) -> GlbDocument:
    ecef_positions = np.asarray(
        [
            wgs84_to_ecef.transform(record.longitude, record.latitude, record.dem_height)
            for record in cell_records
        ],
        dtype=np.float64,
    )
    mean_ecef = tuple(float(value) for value in ecef_positions.mean(axis=0))
    origin_gltf = ecef_to_gltf(mean_ecef)
    builder = GltfBuilder("Qingdao tree tiles generator 1.0")
    for group in MODEL_GROUP_ORDER:
        group_records = sorted(
            (record for record in cell_records if record.model_group == group),
            key=lambda record: record.tree_id,
        )
        builder.add_instanced_model(
            models[level][group],
            group_records,
            origin_gltf,
            wgs84_to_ecef,
            scale,
        )
    return builder.build()


def group_cells(records: Sequence[TreeRecord]) -> dict[tuple[int, int], list[TreeRecord]]:
    cells: dict[tuple[int, int], list[TreeRecord]] = defaultdict(list)
    for record in records:
        cells[(record.cell_x, record.cell_y)].append(record)
    return {
        key: sorted(value, key=lambda record: record.tree_id)
        for key, value in sorted(cells.items())
    }


def model_summary(models: dict[str, dict[str, ModelSource]]) -> dict[str, Any]:
    return {
        level: {
            group: {
                "path": str(source.path),
                "sha256": source.sha256,
                "bounds": [list(source.bounds[0]), list(source.bounds[1])],
            }
            for group, source in level_models.items()
        }
        for level, level_models in models.items()
    }


def generate_dataset(
    staging_root: Path,
    records: Sequence[TreeRecord],
    dem_info: dict[str, Any],
    root_bounds: tuple[float, float, float, float],
    models: dict[str, dict[str, ModelSource]],
    city_gb_code: str,
    divisions: int,
    scale: float,
) -> dict[str, Any]:
    cells = group_cells(records)
    wgs84_to_ecef = Transformer.from_crs("EPSG:4979", "EPSG:4978", always_xy=True)
    ecef_to_wgs84 = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)
    manifest_cells: list[dict[str, Any]] = []
    validation_cells: list[dict[str, Any]] = []
    maximum_horizontal_error = 0.0
    maximum_height_error = 0.0
    maximum_high_low_difference = 0.0

    for cell_number, ((cell_x, cell_y), cell_records) in enumerate(cells.items(), start=1):
        cell_id = f"3_{cell_x}_{cell_y}"
        region = cell_region(cell_x, cell_y, divisions, root_bounds, cell_records)
        actual_by_level: dict[str, list[GeneratedInstance]] = {}
        errors_by_level: dict[str, dict[str, float]] = {}

        for level in ("low", "high"):
            output_glb = staging_root / level / "content" / f"{cell_id}.glb"
            document = generate_cell_glb(
                level,
                cell_records,
                models,
                wgs84_to_ecef,
                scale,
            )
            write_glb(document, output_glb)
            write_region_tileset(
                staging_root / level / "regions" / f"{cell_id}.json",
                region,
                f"../content/{cell_id}.glb",
            )
            actual_records = inspect_generated_glb(output_glb, ecef_to_wgs84)
            level_errors = validate_generated_level(
                cell_records,
                actual_records,
                scale,
                output_glb,
            )
            actual_by_level[level] = actual_records
            errors_by_level[level] = level_errors
            maximum_horizontal_error = max(
                maximum_horizontal_error,
                level_errors["maximumHorizontalErrorMeters"],
            )
            maximum_height_error = max(
                maximum_height_error,
                level_errors["maximumHeightErrorMeters"],
            )

        level_difference = validate_high_low_alignment(
            actual_by_level["low"], actual_by_level["high"], cell_id
        )
        maximum_high_low_difference = max(maximum_high_low_difference, level_difference)
        grade_counts = Counter(record.disease_level for record in cell_records)
        model_counts = Counter(record.model_group for record in cell_records)
        manifest_cells.append(
            {
                "id": cell_id,
                "grid": [cell_x, cell_y],
                "treeCount": len(cell_records),
                "center": [
                    sum(record.longitude for record in cell_records) / len(cell_records),
                    sum(record.latitude for record in cell_records) / len(cell_records),
                    sum(record.dem_height for record in cell_records) / len(cell_records),
                ],
                "region": region,
                "gradeCounts": {
                    str(grade): grade_counts.get(grade, 0) for grade in range(1, 6)
                },
                "modelCounts": {
                    group: model_counts.get(group, 0) for group in MODEL_GROUP_ORDER
                },
                "lowTilesetUrl": f"low/regions/{cell_id}.json",
                "highTilesetUrl": f"high/regions/{cell_id}.json",
            }
        )
        validation_cells.append(
            {
                "id": cell_id,
                "treeCount": len(cell_records),
                "coordinateErrors": errors_by_level,
                "maximumHighLowPositionDifferenceMeters": level_difference,
            }
        )
        print(f"生成并校验 {cell_number:02d}/{len(cells):02d}：{cell_id}，{len(cell_records)} 棵")

    minimum_height = math.floor(min(record.dem_height for record in records) - GROUND_MARGIN_METERS)
    maximum_height = math.ceil(max(record.dem_height for record in records) + TREE_MARGIN_METERS)
    west, south, east, north = root_bounds
    root_region = [
        math.radians(west - ROOT_HORIZONTAL_PADDING_DEGREES),
        math.radians(south - ROOT_HORIZONTAL_PADDING_DEGREES),
        math.radians(east + ROOT_HORIZONTAL_PADDING_DEGREES),
        math.radians(north + ROOT_HORIZONTAL_PADDING_DEGREES),
        minimum_height,
        maximum_height,
    ]
    for level in ("low", "high"):
        write_combined_tileset(
            staging_root / level / "tileset.json",
            root_region,
            manifest_cells,
        )

    grade_counts = Counter(record.disease_level for record in records)
    model_counts = Counter(record.model_group for record in records)
    business_ids = [record.tree_id for record in records]
    manifest = {
        "version": 1,
        "city": {"name": CITY_NAME, "gbCode": city_gb_code},
        "divisions": divisions,
        "rootRegion": root_region,
        "totalInstances": len(records),
        "nonEmptyCellCount": len(manifest_cells),
        "scale": scale,
        "metadataProperties": ["tree_id", "disease_level"],
        "gradeModelMapping": {
            "1-2": "pine-green",
            "3-4": "pine-yellow",
            "5": "pine-dry",
        },
        "dem": dem_info,
        "verticalDatumAssumption": (
            "DEM values are currently used as Cesium ellipsoid heights; "
            "the source DEM vertical datum still needs independent confirmation."
        ),
        "combinedTilesets": {
            "low": "low/tileset.json",
            "high": "high/tileset.json",
        },
        "cells": manifest_cells,
    }
    write_json(staging_root / "manifest.json", manifest)

    validation_report = {
        "status": "passed",
        "generatedAt": datetime.now().astimezone().isoformat(),
        "cityGbCode": city_gb_code,
        "expectedInstanceCount": len(records),
        "outputInstanceCount": sum(cell["treeCount"] for cell in manifest_cells),
        "uniqueTreeIdCount": len(set(business_ids)),
        "duplicateTreeIds": sorted(
            tree_id for tree_id, count in Counter(business_ids).items() if count > 1
        ),
        "metadataProperties": ["tree_id", "disease_level"],
        "gradeCounts": {str(grade): grade_counts.get(grade, 0) for grade in range(1, 6)},
        "modelCounts": {group: model_counts.get(group, 0) for group in MODEL_GROUP_ORDER},
        "scale": scale,
        "demHeightRange": [
            min(record.dem_height for record in records),
            max(record.dem_height for record in records),
        ],
        "maximumOutputHorizontalErrorMeters": maximum_horizontal_error,
        "maximumOutputHeightErrorMeters": maximum_height_error,
        "maximumHighLowPositionDifferenceMeters": maximum_high_low_difference,
        "modelSources": model_summary(models),
        "checks": {
            "instanceCountMatches": len(records)
            == sum(cell["treeCount"] for cell in manifest_cells),
            "treeIdsGloballyUnique": len(business_ids) == len(set(business_ids)),
            "demCoverageComplete": sum(dem_info["sampleStatusCounts"].values()) == len(records),
            "metadataExact": True,
            "gradeModelMappingValid": True,
            "scaleValid": True,
            "highLowAligned": True,
            "coordinateErrorWithinTolerance": (
                maximum_horizontal_error <= MAX_COORDINATE_ERROR_METERS
                and maximum_height_error <= MAX_COORDINATE_ERROR_METERS
            ),
        },
        "cells": validation_cells,
    }
    failed_checks = [
        name for name, passed in validation_report["checks"].items() if not passed
    ]
    if failed_checks:
        raise ValueError(f"内部校验失败：{failed_checks}")
    write_json(staging_root / "validation-report.json", validation_report)
    return validation_report


def validate_output_target(output_root: Path, repo_dir: Path) -> None:
    resolved = output_root.resolve()
    forbidden = {
        repo_dir.resolve(),
        (repo_dir / "data-processing").resolve(),
        (repo_dir / "data-processing" / "qingdao-tree-tiles").resolve(),
    }
    if resolved in forbidden:
        raise ValueError(f"output-root 过宽，拒绝写入：{resolved}")


def publish_staging(staging_root: Path, output_root: Path, replace: bool) -> Path | None:
    """先完整生成到临时目录，全部通过后再原子改名。（★重要，标准生产写法）"""
    backup_path: Path | None = None
    if output_root.exists():
        if not replace:
            raise FileExistsError(
                f"输出目录已存在：{output_root}。为避免覆盖，请检查后显式使用 --replace。"
            )
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = output_root.with_name(f"{output_root.name}.backup-{timestamp}")
        if backup_path.exists():
            backup_path = output_root.with_name(
                f"{output_root.name}.backup-{timestamp}-{uuid.uuid4().hex[:8]}"
            )
        output_root.rename(backup_path)
    try:
        staging_root.rename(output_root)
    except Exception:
        if backup_path is not None and backup_path.exists() and not output_root.exists():
            backup_path.rename(output_root)
        raise
    return backup_path


def print_preflight_summary(
    records: Sequence[TreeRecord],
    dem_info: dict[str, Any],
    models: dict[str, dict[str, ModelSource]],
    cells: dict[tuple[int, int], list[TreeRecord]],
    divisions: int,
) -> None:
    print("预检通过")
    print(f"  青岛实例：{len(records)} 棵，tree_id 唯一：{len({record.tree_id for record in records})}")
    print(f"  非空网格：{len(cells)} / {divisions * divisions}")
    print(
        "  DEM 高程："
        f"{min(record.dem_height for record in records):.3f} ~ "
        f"{max(record.dem_height for record in records):.3f} m，"
        f"采样={dem_info['sampleStatusCounts']}"
    )
    print(
        "  等级："
        + str(dict(sorted(Counter(record.disease_level for record in records).items())))
    )
    print("  High/Low AABB：green、yellow、dry 全部一致")
    for level in ("low", "high"):
        print(
            f"  {level}: "
            + ", ".join(
                f"{group}={models[level][group].path.name}" for group in MODEL_GROUP_ORDER
            )
        )


def main() -> int:
    args = parse_args()
    require_runtime_dependencies()
    script_dir = Path(__file__).resolve().parent
    repo_dir = script_dir.parent.parent
    dem_path = args.dem.resolve()
    high_model_dir = args.high_model_dir.resolve()
    low_model_dir = args.low_model_dir.resolve()
    output_root = args.output_root.resolve()
    validate_output_target(output_root, repo_dir)
    if args.expected_count < 1:
        raise ValueError("expected-count 必须 >= 1")
    if args.scale <= 0 or not math.isfinite(args.scale):
        raise ValueError("scale 必须是正有限数")

    print("1/4 核对 High/Low 模型及 AABB...")
    models = load_models(high_model_dir, low_model_dir)
    print("2/4 从现有 Spring Boot 接口读取青岛病树...")
    rows = fetch_city_trees(
        args.backend_url,
        args.city_gb_code,
        args.expected_count,
        args.http_timeout,
    )
    print("3/4 采样青岛 DEM，并建立 8x8 空间网格...")
    records, dem_info, root_bounds = prepare_tree_records(
        rows,
        dem_path,
        args.grid_divisions,
    )
    if len(records) != args.expected_count:
        raise ValueError(f"DEM 预检后实例数变化：{len(records)} != {args.expected_count}")
    if len({record.tree_id for record in records}) != len(records):
        raise ValueError("tree_id 全局不唯一")
    cells = group_cells(records)
    print_preflight_summary(records, dem_info, models, cells, args.grid_divisions)
    if args.preflight_only:
        print("preflight-only：未写入任何文件。")
        return 0

    if output_root.exists() and not args.replace:
        raise FileExistsError(
            f"输出目录已存在：{output_root}。未写入；确认后使用 --replace。"
        )
    staging_root = output_root.with_name(f"{output_root.name}.staging-{uuid.uuid4().hex}")
    if staging_root.exists():
        raise FileExistsError(staging_root)
    print("4/4 生成 High/Low GLB、tileset、manifest 并回读校验...")
    try:
        validation_report = generate_dataset(
            staging_root,
            records,
            dem_info,
            root_bounds,
            models,
            args.city_gb_code,
            args.grid_divisions,
            args.scale,
        )
        backup_path = publish_staging(staging_root, output_root, args.replace)
    except Exception:
        # staging 名称由本脚本随机生成且已精确解析，不会误删用户目录。
        if staging_root.exists():
            shutil.rmtree(staging_root)
        raise

    print("生成完成，全部校验通过。")
    print(f"  输出：{output_root}")
    if backup_path is not None:
        print(f"  旧输出备份：{backup_path}")
    print(f"  实例：{validation_report['outputInstanceCount']}")
    print(f"  非空网格：{len(validation_report['cells'])}")
    print(
        "  最大坐标误差："
        f"水平 {validation_report['maximumOutputHorizontalErrorMeters']:.6f} m，"
        f"高程 {validation_report['maximumOutputHeightErrorMeters']:.6f} m"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("已由用户中断。", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"生成失败：{error}", file=sys.stderr)
        raise SystemExit(1)


# ----- 新增结束
