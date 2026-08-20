"""为一个空间块生成带 DEM 高程的 High/Low 3D Tiles 试验数据。

本脚本只修改 EXT_mesh_gpu_instancing 的 TRANSLATION 数据，不修改模型几何、
Feature ID、Metadata、旋转或缩放。输出位于独立目录，不覆盖现有 spatial 基线。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import Window


GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
FLOAT = 5126

# 包围体除了地面高程，还要容纳树根误差和放大后的树冠。
GROUND_MARGIN_METERS = 5.0
TREE_MARGIN_METERS = 60.0


@dataclass
class GlbDocument:
    json_data: dict[str, Any]
    binary_data: bytearray


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_dir = script_dir.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cell-id", default="3_4_4", help="空间块 ID，默认 3_4_4")
    parser.add_argument(
        "--source-root",
        type=Path,
        default=script_dir / "tree-tiles-lod-output" / "spatial",
        help="现有稳定 spatial 数据目录",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=script_dir / "tree-tiles-lod-output" / "spatial-dem-test",
        help="独立试验输出目录",
    )
    parser.add_argument(
        "--dem",
        type=Path,
        default=repo_dir / "downloads" / "DEM" / "shandong-dem-12.5.tif",
        help="本地 DEM GeoTIFF",
    )
    return parser.parse_args()


def read_glb(path: Path) -> GlbDocument:
    raw = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<III", raw, 0)
    if magic != GLB_MAGIC or version != 2 or total_length != len(raw):
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
    return GlbDocument(json_data, binary_data)


def write_glb(document: GlbDocument, path: Path) -> None:
    document.json_data["buffers"][0]["byteLength"] = len(document.binary_data)
    json_bytes = json.dumps(
        document.json_data, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary_bytes = bytes(document.binary_data)
    binary_bytes += b"\0" * ((-len(binary_bytes)) % 4)

    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    result = bytearray(struct.pack("<III", GLB_MAGIC, 2, total_length))
    result += struct.pack("<II", len(json_bytes), JSON_CHUNK)
    result += json_bytes
    result += struct.pack("<II", len(binary_bytes), BIN_CHUNK)
    result += binary_bytes
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(result)


def accessor_layout(document: GlbDocument, accessor_index: int) -> tuple[int, int, int]:
    accessor = document.json_data["accessors"][accessor_index]
    view = document.json_data["bufferViews"][accessor["bufferView"]]
    component_sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    component_counts = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    component_size = component_sizes[accessor["componentType"]]
    component_count = component_counts[accessor["type"]]
    element_size = component_size * component_count
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", element_size)
    return start, stride, accessor["count"]


def read_vec3_f32(document: GlbDocument, accessor_index: int) -> list[tuple[float, float, float]]:
    accessor = document.json_data["accessors"][accessor_index]
    if accessor["componentType"] != FLOAT or accessor["type"] != "VEC3":
        raise ValueError(f"Accessor {accessor_index} 不是 FLOAT VEC3")
    start, stride, count = accessor_layout(document, accessor_index)
    return [struct.unpack_from("<fff", document.binary_data, start + i * stride) for i in range(count)]


def write_vec3_f32(
    document: GlbDocument, accessor_index: int, values: list[tuple[float, float, float]]
) -> None:
    start, stride, count = accessor_layout(document, accessor_index)
    if len(values) != count:
        raise ValueError(f"Accessor {accessor_index} 数量不一致：{len(values)} != {count}")
    stored_values: list[tuple[float, float, float]] = []
    for index, value in enumerate(values):
        struct.pack_into("<fff", document.binary_data, start + index * stride, *value)
        stored_values.append(struct.unpack_from("<fff", document.binary_data, start + index * stride))

    accessor = document.json_data["accessors"][accessor_index]
    accessor["min"] = [min(value[axis] for value in stored_values) for axis in range(3)]
    accessor["max"] = [max(value[axis] for value in stored_values) for axis in range(3)]


def read_scalar_uint(document: GlbDocument, accessor_index: int) -> list[int]:
    accessor = document.json_data["accessors"][accessor_index]
    formats = {5121: "<B", 5123: "<H", 5125: "<I"}
    if accessor["type"] != "SCALAR" or accessor["componentType"] not in formats:
        raise ValueError(f"Accessor {accessor_index} 不是无符号整数 SCALAR")
    start, stride, count = accessor_layout(document, accessor_index)
    fmt = formats[accessor["componentType"]]
    return [struct.unpack_from(fmt, document.binary_data, start + i * stride)[0] for i in range(count)]


def read_buffer_view(document: GlbDocument, buffer_view_index: int) -> bytes:
    view = document.json_data["bufferViews"][buffer_view_index]
    start = view.get("byteOffset", 0)
    return bytes(document.binary_data[start : start + view["byteLength"]])


def read_string_property(document: GlbDocument, property_definition: dict[str, Any], count: int) -> list[str]:
    values = read_buffer_view(document, property_definition["values"])
    offsets_raw = read_buffer_view(document, property_definition["stringOffsets"])
    offset_type = property_definition.get("stringOffsetType", "UINT32")
    formats = {"UINT8": ("<B", 1), "UINT16": ("<H", 2), "UINT32": ("<I", 4)}
    if offset_type not in formats:
        raise ValueError(f"暂不支持 stringOffsetType={offset_type}")
    fmt, size = formats[offset_type]
    offsets = [struct.unpack_from(fmt, offsets_raw, i * size)[0] for i in range(count + 1)]
    return [values[offsets[i] : offsets[i + 1]].decode("utf-8") for i in range(count)]


def get_instanced_nodes(document: GlbDocument) -> list[tuple[int, dict[str, Any]]]:
    result = []
    for node_index, node in enumerate(document.json_data.get("nodes", [])):
        extensions = node.get("extensions", {})
        if "EXT_mesh_gpu_instancing" in extensions:
            result.append((node_index, node))
    return result


def get_node_metadata(document: GlbDocument, node: dict[str, Any]) -> tuple[list[int], dict[str, list[str]]]:
    extensions = node["extensions"]
    attributes = extensions["EXT_mesh_gpu_instancing"]["attributes"]
    feature_ids = extensions["EXT_instance_features"]["featureIds"][0]
    attribute_number = feature_ids.get("attribute", 0)
    feature_accessor = attributes[f"_FEATURE_ID_{attribute_number}"]
    ids = read_scalar_uint(document, feature_accessor)

    table_index = feature_ids["propertyTable"]
    table = document.json_data["extensions"]["EXT_structural_metadata"]["propertyTables"][table_index]
    properties = {
        name: read_string_property(document, definition, table["count"])
        for name, definition in table["properties"].items()
    }
    return ids, properties


def node_matrix_translation(node: dict[str, Any]) -> tuple[float, float, float]:
    matrix = node.get("matrix")
    if matrix is None:
        raise ValueError("试验脚本要求实例节点使用 matrix")
    expected_rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    actual_rotation = [matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6], matrix[8], matrix[9], matrix[10]]
    if any(abs(a - b) > 1e-8 for a, b in zip(actual_rotation, expected_rotation)):
        raise ValueError("节点 matrix 含旋转/缩放，本脚本不能安全套用当前坐标换算")
    return matrix[12], matrix[13], matrix[14]


def local_translation_to_ecef(
    node_origin: tuple[float, float, float], translation: tuple[float, float, float]
) -> tuple[float, float, float]:
    # 当前生成器用 glTF Y-up 保存 ECEF：glTF(X,Y,Z) = ECEF(X,Z,-Y)。
    gltf_x = node_origin[0] + translation[0]
    gltf_y = node_origin[1] + translation[1]
    gltf_z = node_origin[2] + translation[2]
    return gltf_x, -gltf_z, gltf_y


def ecef_to_local_translation(
    node_origin: tuple[float, float, float], ecef: tuple[float, float, float]
) -> tuple[float, float, float]:
    gltf = (ecef[0], ecef[2], -ecef[1])
    return tuple(gltf[axis] - node_origin[axis] for axis in range(3))  # type: ignore[return-value]


def sample_dem_bilinear(dataset: rasterio.io.DatasetReader, x: float, y: float) -> tuple[float, str]:
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
    elevation = float((np.asarray(values.filled(0), dtype=np.float64) * valid_weights).sum() / weight_sum)
    status = "bilinear" if bool(valid.all()) else "partial_bilinear"
    return elevation, status


def collect_instances(
    document: GlbDocument,
    ecef_to_wgs84: Transformer,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    global_index = 0
    for node_index, node in get_instanced_nodes(document):
        attributes = node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"]
        translations = read_vec3_f32(document, attributes["TRANSLATION"])
        feature_ids, properties = get_node_metadata(document, node)
        origin = node_matrix_translation(node)
        if len(feature_ids) != len(translations):
            raise ValueError(f"Node {node_index} 的 Feature ID 与实例数量不一致")
        for instance_index, (translation, feature_id) in enumerate(zip(translations, feature_ids)):
            ecef = local_translation_to_ecef(origin, translation)
            longitude, latitude, height = ecef_to_wgs84.transform(*ecef)
            metadata = {
                property_name: values[feature_id]
                for property_name, values in properties.items()
            }
            records.append(
                {
                    "globalIndex": global_index,
                    "nodeIndex": node_index,
                    "instanceIndex": instance_index,
                    "featureId": feature_id,
                    "metadata": metadata,
                    "longitude": longitude,
                    "latitude": latitude,
                    "originalEllipsoidHeight": height,
                }
            )
            global_index += 1
    return records


def apply_dem_translations(
    document: GlbDocument,
    canonical_records: list[dict[str, Any]],
    wgs84_to_ecef: Transformer,
) -> None:
    records_by_node: dict[int, list[dict[str, Any]]] = {}
    for record in canonical_records:
        records_by_node.setdefault(record["nodeIndex"], []).append(record)

    for node_index, node in get_instanced_nodes(document):
        attributes = node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"]
        origin = node_matrix_translation(node)
        node_records = records_by_node[node_index]
        new_translations = []
        for record in node_records:
            ecef = wgs84_to_ecef.transform(
                record["longitude"], record["latitude"], record["demHeight"]
            )
            new_translations.append(ecef_to_local_translation(origin, ecef))
        write_vec3_f32(document, attributes["TRANSLATION"], new_translations)

    asset = document.json_data.setdefault("asset", {})
    original_generator = asset.get("generator", "unknown")
    asset["generator"] = f"{original_generator} + DEM height cell test"


def compare_levels(low_records: list[dict[str, Any]], high_records: list[dict[str, Any]]) -> float:
    if len(low_records) != len(high_records):
        raise ValueError(f"High/Low 实例数不一致：{len(high_records)} != {len(low_records)}")
    maximum_position_difference = 0.0
    for low, high in zip(low_records, high_records):
        if (
            low["nodeIndex"] != high["nodeIndex"]
            or low["instanceIndex"] != high["instanceIndex"]
            or low["featureId"] != high["featureId"]
            or low["metadata"] != high["metadata"]
        ):
            raise ValueError("High/Low 的实例顺序、Feature ID 或 Metadata 不一致")
        horizontal_difference = math.hypot(
            (low["longitude"] - high["longitude"]) * 111_320 * math.cos(math.radians(low["latitude"])),
            (low["latitude"] - high["latitude"]) * 110_540,
        )
        maximum_position_difference = max(maximum_position_difference, horizontal_difference)
    return maximum_position_difference


def verify_only_translation_binary_changed(
    document: GlbDocument, binary_before: bytes
) -> int:
    """确认 BIN 中除实例 TRANSLATION 外的几何、Metadata 等字节完全未改。"""
    allowed_offsets: set[int] = set()
    for _, node in get_instanced_nodes(document):
        attributes = node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"]
        start, stride, count = accessor_layout(document, attributes["TRANSLATION"])
        for index in range(count):
            element_start = start + index * stride
            allowed_offsets.update(range(element_start, element_start + 12))

    changed_offsets = [
        index
        for index, (before, after) in enumerate(zip(binary_before, document.binary_data))
        if before != after
    ]
    unexpected_offsets = [offset for offset in changed_offsets if offset not in allowed_offsets]
    if len(binary_before) != len(document.binary_data) or unexpected_offsets:
        raise ValueError(
            f"检测到 TRANSLATION 以外的 BIN 数据变化：{unexpected_offsets[:10]}"
        )
    return len(changed_offsets)


def verify_output_records(
    expected_records: list[dict[str, Any]],
    output_records: list[dict[str, Any]],
) -> tuple[float, float]:
    if len(expected_records) != len(output_records):
        raise ValueError("输出 GLB 的实例数发生变化")
    maximum_horizontal_error = 0.0
    maximum_height_error = 0.0
    for expected, output in zip(expected_records, output_records):
        if (
            expected["nodeIndex"] != output["nodeIndex"]
            or expected["instanceIndex"] != output["instanceIndex"]
            or expected["featureId"] != output["featureId"]
            or expected["metadata"] != output["metadata"]
        ):
            raise ValueError("输出 GLB 的实例顺序、Feature ID 或 Metadata 发生变化")
        horizontal_error = math.hypot(
            (expected["longitude"] - output["longitude"])
            * 111_320
            * math.cos(math.radians(expected["latitude"])),
            (expected["latitude"] - output["latitude"]) * 110_540,
        )
        height_error = abs(expected["demHeight"] - output["originalEllipsoidHeight"])
        maximum_horizontal_error = max(maximum_horizontal_error, horizontal_error)
        maximum_height_error = max(maximum_height_error, height_error)
    if maximum_horizontal_error > 0.1 or maximum_height_error > 0.1:
        raise ValueError(
            "输出坐标误差超过 0.1m："
            f"horizontal={maximum_horizontal_error}, height={maximum_height_error}"
        )
    return maximum_horizontal_error, maximum_height_error


def write_tileset(path: Path, region: list[float], content_uri: str) -> None:
    data = {
        "asset": {"version": "1.1"},
        # 与现有 spatial 区域 tileset 保持一致，避免改变 Cesium 的遍历条件。
        "geometricError": 1000,
        "root": {
            "boundingVolume": {"region": region},
            "geometricError": 0,
            "refine": "ADD",
            "content": {"uri": content_uri},
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    source_root = args.source_root.resolve()
    output_root = args.output_root.resolve()
    dem_path = args.dem.resolve()
    manifest = json.loads((source_root / "manifest.json").read_text(encoding="utf-8"))
    matching_cells = [cell for cell in manifest["cells"] if cell["id"] == args.cell_id]
    if len(matching_cells) != 1:
        raise ValueError(f"manifest 中找不到唯一空间块：{args.cell_id}")
    source_cell = matching_cells[0]

    source_paths = {
        level: source_root / level / "content" / f"{args.cell_id}.glb"
        for level in ("low", "high")
    }
    for path in [*source_paths.values(), dem_path]:
        if not path.is_file():
            raise FileNotFoundError(path)

    low_document = read_glb(source_paths["low"])
    high_document = read_glb(source_paths["high"])
    ecef_to_wgs84 = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)
    wgs84_to_ecef = Transformer.from_crs("EPSG:4979", "EPSG:4978", always_xy=True)
    low_records = collect_instances(low_document, ecef_to_wgs84)
    high_records = collect_instances(high_document, ecef_to_wgs84)
    maximum_level_difference = compare_levels(low_records, high_records)

    if len(low_records) != source_cell["treeCount"]:
        raise ValueError(
            f"GLB 实例数与 manifest 不一致：{len(low_records)} != {source_cell['treeCount']}"
        )

    with rasterio.open(dem_path) as dem:
        wgs84_to_dem = Transformer.from_crs("EPSG:4326", dem.crs, always_xy=True)
        sample_status_counts: dict[str, int] = {}
        for record in low_records:
            dem_x, dem_y = wgs84_to_dem.transform(record["longitude"], record["latitude"])
            dem_height, sample_status = sample_dem_bilinear(dem, dem_x, dem_y)
            record["demHeight"] = dem_height
            record["heightChange"] = dem_height - record["originalEllipsoidHeight"]
            record["sampleStatus"] = sample_status
            sample_status_counts[sample_status] = sample_status_counts.get(sample_status, 0) + 1
        dem_information = {
            "path": str(dem_path),
            "crs": str(dem.crs),
            "pixelSize": [abs(dem.transform.a), abs(dem.transform.e)],
            "nodata": dem.nodata,
        }

    business_id_property = "tree_id" if "tree_id" in low_records[0]["metadata"] else "id"
    business_ids = [record["metadata"][business_id_property] for record in low_records]
    if len(set(business_ids)) != len(business_ids):
        raise ValueError(f"Metadata 的 {business_id_property} 在试验块内不唯一")

    changed_binary_bytes: dict[str, int] = {}
    for level, document in (("low", low_document), ("high", high_document)):
        binary_before = bytes(document.binary_data)
        apply_dem_translations(document, low_records, wgs84_to_ecef)
        changed_binary_bytes[level] = verify_only_translation_binary_changed(
            document, binary_before
        )
        write_glb(document, output_root / level / "content" / f"{args.cell_id}.glb")

    output_records: dict[str, list[dict[str, Any]]] = {}
    output_coordinate_errors: dict[str, dict[str, float]] = {}
    for level in ("low", "high"):
        output_document = read_glb(
            output_root / level / "content" / f"{args.cell_id}.glb"
        )
        level_records = collect_instances(output_document, ecef_to_wgs84)
        horizontal_error, height_error = verify_output_records(low_records, level_records)
        output_records[level] = level_records
        output_coordinate_errors[level] = {
            "maximumHorizontalErrorMeters": horizontal_error,
            "maximumHeightErrorMeters": height_error,
        }
    maximum_output_level_difference = compare_levels(
        output_records["low"], output_records["high"]
    )

    minimum_dem_height = min(record["demHeight"] for record in low_records)
    maximum_dem_height = max(record["demHeight"] for record in low_records)
    output_region = [
        *source_cell["region"][:4],
        math.floor(minimum_dem_height - GROUND_MARGIN_METERS),
        math.ceil(maximum_dem_height + TREE_MARGIN_METERS),
    ]
    for level in ("low", "high"):
        write_tileset(
            output_root / level / "regions" / f"{args.cell_id}.json",
            output_region,
            f"../content/{args.cell_id}.glb",
        )
        write_tileset(
            output_root / level / "tileset.json",
            output_region,
            f"content/{args.cell_id}.glb",
        )

    test_manifest = {
        "version": 1,
        "testName": "263-tree DEM height test",
        "divisions": manifest["divisions"],
        "rootRegion": output_region,
        "totalInstances": len(low_records),
        "dem": dem_information,
        "verticalDatumAssumption": (
            "DEM values are temporarily used as Cesium ellipsoid heights; "
            "the DEM vertical datum has not yet been verified."
        ),
        "cells": [
            {
                **source_cell,
                "region": output_region,
            }
        ],
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(test_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    report_records = []
    for record in low_records:
        report_records.append(
            {
                "globalIndex": record["globalIndex"],
                "nodeIndex": record["nodeIndex"],
                "instanceIndex": record["instanceIndex"],
                "featureId": record["featureId"],
                business_id_property: record["metadata"][business_id_property],
                "disease_level": record["metadata"].get("disease_level"),
                "longitude": record["longitude"],
                "latitude": record["latitude"],
                "originalEllipsoidHeight": record["originalEllipsoidHeight"],
                "demHeight": record["demHeight"],
                "heightChange": record["heightChange"],
                "sampleStatus": record["sampleStatus"],
            }
        )

    report = {
        "cellId": args.cell_id,
        "instanceCount": len(low_records),
        "sourceTreeCount": source_cell["treeCount"],
        "businessIdProperty": business_id_property,
        "uniqueBusinessIdCount": len(set(business_ids)),
        "metadataProperties": sorted(low_records[0]["metadata"].keys()),
        "sampleStatusCounts": sample_status_counts,
        "originalHeightRange": [
            min(record["originalEllipsoidHeight"] for record in low_records),
            max(record["originalEllipsoidHeight"] for record in low_records),
        ],
        "demHeightRange": [minimum_dem_height, maximum_dem_height],
        "heightChangeRange": [
            min(record["heightChange"] for record in low_records),
            max(record["heightChange"] for record in low_records),
        ],
        "maximumHighLowHorizontalDifferenceMeters": maximum_level_difference,
        "maximumOutputHighLowHorizontalDifferenceMeters": maximum_output_level_difference,
        "changedBinaryByteCounts": changed_binary_bytes,
        "outputCoordinateErrors": output_coordinate_errors,
        "outputRegion": output_region,
        "verticalDatumWarning": test_manifest["verticalDatumAssumption"],
        "records": report_records,
    }
    (output_root / "dem-height-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (output_root / "dem-height-samples.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=report_records[0].keys())
        writer.writeheader()
        writer.writerows(report_records)

    print(f"空间块：{args.cell_id}")
    print(f"实例数：{len(low_records)}")
    print(f"业务 ID 字段：{business_id_property}（唯一 {len(set(business_ids))}）")
    print(f"DEM 高程范围：{minimum_dem_height:.3f} ~ {maximum_dem_height:.3f} m")
    print(f"DEM 采样状态：{sample_status_counts}")
    print(f"High/Low 最大水平差：{maximum_level_difference:.6f} m")
    print(f"写回后最大高程误差：{max(item['maximumHeightErrorMeters'] for item in output_coordinate_errors.values()):.6f} m")
    print(f"BIN 变化字节数：{changed_binary_bytes}（仅 TRANSLATION）")
    print(f"独立输出：{output_root}")


if __name__ == "__main__":
    main()
