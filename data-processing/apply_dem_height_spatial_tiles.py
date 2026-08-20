"""为现有 64 个空间块、10,205 个 GPU Instance 批量写入 DEM 高程。

输入目录保持只读，结果写入独立的 spatial-dem。脚本先完成全部预检，再开始
生成文件，避免在 DEM NoData、ID 重复或 High/Low 不对应时留下半套结果。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

import rasterio
from pyproj import Transformer

from test_dem_height_cell import (
    GROUND_MARGIN_METERS,
    TREE_MARGIN_METERS,
    apply_dem_translations,
    collect_instances,
    compare_levels,
    read_glb,
    sample_dem_bilinear,
    verify_only_translation_binary_changed,
    verify_output_records,
    write_glb,
    write_tileset,
)


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_dir = script_dir.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root",
        type=Path,
        default=script_dir / "tree-tiles-lod-output" / "spatial",
        help="现有稳定 spatial 数据目录（只读）",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=script_dir / "tree-tiles-lod-output" / "spatial-dem",
        help="独立 DEM 输出目录",
    )
    parser.add_argument(
        "--dem",
        type=Path,
        default=repo_dir / "downloads" / "DEM" / "shandong-dem-12.5.tif",
        help="本地 DEM GeoTIFF",
    )
    return parser.parse_args()


def write_combined_tileset(
    path: Path,
    root_region: list[float],
    cells: list[dict[str, Any]],
) -> None:
    """生成一个便于整体校验或临时直载的普通 3D Tiles 1.1 tileset。"""
    data = {
        "asset": {"version": "1.1"},
        "geometricError": 1000,
        "root": {
            "boundingVolume": {"region": root_region},
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
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    source_root = args.source_root.resolve()
    output_root = args.output_root.resolve()
    dem_path = args.dem.resolve()

    manifest_path = source_root / "manifest.json"
    for path in (manifest_path, dem_path):
        if not path.is_file():
            raise FileNotFoundError(path)

    source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_cells = source_manifest["cells"]
    if len(source_cells) != 64:
        raise ValueError(f"预期64个空间块，实际{len(source_cells)}个")

    ecef_to_wgs84 = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)
    wgs84_to_ecef = Transformer.from_crs("EPSG:4979", "EPSG:4978", always_xy=True)

    processed_cells: list[dict[str, Any]] = []
    all_records: list[dict[str, Any]] = []
    all_business_ids: list[str] = []
    sample_status_counts: dict[str, int] = {}
    metadata_properties: set[str] = set()
    business_id_property: str | None = None
    maximum_input_level_difference = 0.0
    sample_failures: list[dict[str, Any]] = []

    # 一次打开 DEM，预检64块的全部坐标。预检完成前不写任何输出 GLB。
    with rasterio.open(dem_path) as dem:
        wgs84_to_dem = Transformer.from_crs("EPSG:4326", dem.crs, always_xy=True)
        dem_information = {
            "path": str(dem_path),
            "crs": str(dem.crs),
            "pixelSize": [abs(dem.transform.a), abs(dem.transform.e)],
            "nodata": dem.nodata,
        }

        for cell_number, source_cell in enumerate(source_cells, start=1):
            cell_id = source_cell["id"]
            documents = {
                level: read_glb(source_root / level / "content" / f"{cell_id}.glb")
                for level in ("low", "high")
            }
            low_records = collect_instances(documents["low"], ecef_to_wgs84)
            high_records = collect_instances(documents["high"], ecef_to_wgs84)
            level_difference = compare_levels(low_records, high_records)
            maximum_input_level_difference = max(
                maximum_input_level_difference, level_difference
            )
            if len(low_records) != source_cell["treeCount"]:
                raise ValueError(
                    f"{cell_id} 实例数与 manifest 不一致："
                    f"{len(low_records)} != {source_cell['treeCount']}"
                )

            cell_property_names = set(low_records[0]["metadata"].keys())
            metadata_properties.update(cell_property_names)
            current_business_property = (
                "tree_id" if "tree_id" in cell_property_names else "id"
            )
            if business_id_property is None:
                business_id_property = current_business_property
            elif business_id_property != current_business_property:
                raise ValueError("不同空间块使用了不同的业务 ID 字段")

            for record in low_records:
                record["cellId"] = cell_id
                dem_x, dem_y = wgs84_to_dem.transform(
                    record["longitude"], record["latitude"]
                )
                try:
                    dem_height, sample_status = sample_dem_bilinear(
                        dem, dem_x, dem_y
                    )
                except ValueError as error:
                    sample_failures.append(
                        {
                            "cellId": cell_id,
                            "globalIndex": len(all_records),
                            "longitude": record["longitude"],
                            "latitude": record["latitude"],
                            "message": str(error),
                        }
                    )
                    continue

                record["demHeight"] = dem_height
                record["heightChange"] = (
                    dem_height - record["originalEllipsoidHeight"]
                )
                record["sampleStatus"] = sample_status
                record["datasetGlobalIndex"] = len(all_records)
                sample_status_counts[sample_status] = (
                    sample_status_counts.get(sample_status, 0) + 1
                )
                all_records.append(record)
                all_business_ids.append(
                    str(record["metadata"][current_business_property])
                )

            processed_cells.append(
                {
                    "sourceCell": source_cell,
                    "documents": documents,
                    "records": low_records,
                    "inputHighLowDifference": level_difference,
                }
            )
            print(
                f"预检 {cell_number:02d}/64：{cell_id}，"
                f"{len(low_records)} 个实例"
            )

    if sample_failures:
        failure_path = output_root.parent / "spatial-dem-preflight-failures.json"
        failure_path.write_text(
            json.dumps(sample_failures, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        raise ValueError(
            f"有 {len(sample_failures)} 个实例无法取得 DEM 高程，"
            f"未生成 spatial-dem；详见 {failure_path}"
        )

    expected_instance_count = sum(cell["treeCount"] for cell in source_cells)
    if len(all_records) != expected_instance_count:
        raise ValueError(
            f"总实例数不一致：{len(all_records)} != {expected_instance_count}"
        )
    id_counts = Counter(all_business_ids)
    duplicate_ids = sorted(
        business_id for business_id, count in id_counts.items() if count > 1
    )
    if duplicate_ids:
        raise ValueError(
            f"{business_id_property} 存在重复，示例：{duplicate_ids[:10]}"
        )

    output_cells: list[dict[str, Any]] = []
    cell_summaries: list[dict[str, Any]] = []
    changed_binary_bytes = {"low": 0, "high": 0}
    maximum_output_horizontal_error = 0.0
    maximum_output_height_error = 0.0
    maximum_output_level_difference = 0.0

    # 全部预检通过后，才开始写独立输出。
    for cell_number, item in enumerate(processed_cells, start=1):
        source_cell = item["sourceCell"]
        cell_id = source_cell["id"]
        records = item["records"]
        documents = item["documents"]

        for level in ("low", "high"):
            document = documents[level]
            binary_before = bytes(document.binary_data)
            apply_dem_translations(document, records, wgs84_to_ecef)
            changed_binary_bytes[level] += verify_only_translation_binary_changed(
                document, binary_before
            )
            write_glb(
                document,
                output_root / level / "content" / f"{cell_id}.glb",
            )

        output_records: dict[str, list[dict[str, Any]]] = {}
        level_errors: dict[str, dict[str, float]] = {}
        for level in ("low", "high"):
            output_document = read_glb(
                output_root / level / "content" / f"{cell_id}.glb"
            )
            level_records = collect_instances(output_document, ecef_to_wgs84)
            horizontal_error, height_error = verify_output_records(
                records, level_records
            )
            output_records[level] = level_records
            level_errors[level] = {
                "maximumHorizontalErrorMeters": horizontal_error,
                "maximumHeightErrorMeters": height_error,
            }
            maximum_output_horizontal_error = max(
                maximum_output_horizontal_error, horizontal_error
            )
            maximum_output_height_error = max(
                maximum_output_height_error, height_error
            )

        output_level_difference = compare_levels(
            output_records["low"], output_records["high"]
        )
        maximum_output_level_difference = max(
            maximum_output_level_difference, output_level_difference
        )

        minimum_height = min(record["demHeight"] for record in records)
        maximum_height = max(record["demHeight"] for record in records)
        output_region = [
            *source_cell["region"][:4],
            math.floor(minimum_height - GROUND_MARGIN_METERS),
            math.ceil(maximum_height + TREE_MARGIN_METERS),
        ]
        output_cell = {**source_cell, "region": output_region}
        output_cells.append(output_cell)
        for level in ("low", "high"):
            write_tileset(
                output_root / level / "regions" / f"{cell_id}.json",
                output_region,
                f"../content/{cell_id}.glb",
            )

        cell_summaries.append(
            {
                "cellId": cell_id,
                "instanceCount": len(records),
                "demHeightRange": [minimum_height, maximum_height],
                "inputHighLowHorizontalDifferenceMeters": item[
                    "inputHighLowDifference"
                ],
                "outputHighLowHorizontalDifferenceMeters": output_level_difference,
                "outputCoordinateErrors": level_errors,
                "region": output_region,
            }
        )
        print(f"生成 {cell_number:02d}/64：{cell_id}")

    root_region = [
        *source_manifest["rootRegion"][:4],
        min(cell["region"][4] for cell in output_cells),
        max(cell["region"][5] for cell in output_cells),
    ]
    output_manifest = {
        "version": 1,
        "datasetName": "10,205-tree DEM height dataset",
        "divisions": source_manifest["divisions"],
        "rootRegion": root_region,
        "totalInstances": len(all_records),
        "dem": dem_information,
        "verticalDatumAssumption": (
            "DEM values are temporarily used as Cesium ellipsoid heights; "
            "the DEM vertical datum has not yet been verified."
        ),
        "cells": output_cells,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(output_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    for level in ("low", "high"):
        write_combined_tileset(
            output_root / level / "tileset.json", root_region, output_cells
        )

    report_rows: list[dict[str, Any]] = []
    for record in all_records:
        report_rows.append(
            {
                "cellId": record["cellId"],
                "datasetGlobalIndex": record["datasetGlobalIndex"],
                "cellGlobalIndex": record["globalIndex"],
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
        "cellCount": len(output_cells),
        "instanceCount": len(all_records),
        "businessIdProperty": business_id_property,
        "uniqueBusinessIdCount": len(set(all_business_ids)),
        "metadataProperties": sorted(metadata_properties),
        "sampleStatusCounts": sample_status_counts,
        "originalHeightRange": [
            min(record["originalEllipsoidHeight"] for record in all_records),
            max(record["originalEllipsoidHeight"] for record in all_records),
        ],
        "demHeightRange": [
            min(record["demHeight"] for record in all_records),
            max(record["demHeight"] for record in all_records),
        ],
        "heightChangeRange": [
            min(record["heightChange"] for record in all_records),
            max(record["heightChange"] for record in all_records),
        ],
        "maximumInputHighLowHorizontalDifferenceMeters": maximum_input_level_difference,
        "maximumOutputHighLowHorizontalDifferenceMeters": maximum_output_level_difference,
        "maximumOutputHorizontalErrorMeters": maximum_output_horizontal_error,
        "maximumOutputHeightErrorMeters": maximum_output_height_error,
        "changedBinaryByteCounts": changed_binary_bytes,
        "rootRegion": root_region,
        "verticalDatumWarning": output_manifest["verticalDatumAssumption"],
        "cells": cell_summaries,
    }
    (output_root / "dem-height-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (output_root / "dem-height-samples.csv").open(
        "w", newline="", encoding="utf-8-sig"
    ) as file:
        writer = csv.DictWriter(file, fieldnames=report_rows[0].keys())
        writer.writeheader()
        writer.writerows(report_rows)

    print("\n批处理完成")
    print(f"空间块：{len(output_cells)}")
    print(f"实例数：{len(all_records)}")
    print(f"唯一 {business_id_property}：{len(set(all_business_ids))}")
    print(f"DEM 采样状态：{sample_status_counts}")
    print(
        "DEM 高程范围："
        f"{report['demHeightRange'][0]:.3f} ~ {report['demHeightRange'][1]:.3f} m"
    )
    print(f"High/Low 输出最大水平差：{maximum_output_level_difference:.6f} m")
    print(f"输出最大高程误差：{maximum_output_height_error:.6f} m")
    print(f"独立输出：{output_root}")


if __name__ == "__main__":
    main()
