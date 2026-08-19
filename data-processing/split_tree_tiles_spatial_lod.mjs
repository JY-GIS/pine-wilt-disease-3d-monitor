import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_ROOT = path.join(SCRIPT_DIR, 'tree-tiles-lod-output')
const OUTPUT_ROOT = path.join(SOURCE_ROOT, 'spatial')
const LEVELS = ['low', 'high']
const SOURCE_DIVISIONS = 4
const CHILD_DIVISIONS = 2
const TOTAL_DIVISIONS = SOURCE_DIVISIONS * CHILD_DIVISIONS
const ROOT_REGION = [
    2.0394184628913434,
    0.6073815537034762,
    2.0710821262631494,
    0.6496054446429451,
]

const COMPONENT_BYTES = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
}
const TYPE_COMPONENTS = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
}

const WGS84_A = 6378137
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = WGS84_F * (2 - WGS84_F)
const WGS84_B = WGS84_A * (1 - WGS84_F)
const WGS84_EP2 =
    (WGS84_A ** 2 - WGS84_B ** 2) / WGS84_B ** 2

function align4(value) {
    return (value + 3) & ~3
}

function parseGlb(filePath) {
    const file = fs.readFileSync(filePath)
    if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2) {
        throw new Error(`不是有效的 GLB 2.0：${filePath}`)
    }

    let json
    let bin
    let offset = 12
    while (offset < file.length) {
        const length = file.readUInt32LE(offset)
        const type = file.readUInt32LE(offset + 4)
        const data = file.subarray(offset + 8, offset + 8 + length)
        if (type === 0x4e4f534a) {
            json = JSON.parse(data.toString('utf8').trimEnd())
        } else if (type === 0x004e4942) {
            bin = Buffer.from(data)
        }
        offset += 8 + length
    }

    if (!json || !bin) {
        throw new Error(`GLB 缺少 JSON 或 BIN chunk：${filePath}`)
    }
    return { json, bin }
}

function writeGlb(filePath, json, bin) {
    const jsonSource = Buffer.from(JSON.stringify(json))
    const jsonLength = align4(jsonSource.length)
    const binLength = align4(bin.length)
    const totalLength = 12 + 8 + jsonLength + 8 + binLength
    const output = Buffer.alloc(totalLength)

    output.writeUInt32LE(0x46546c67, 0)
    output.writeUInt32LE(2, 4)
    output.writeUInt32LE(totalLength, 8)
    output.writeUInt32LE(jsonLength, 12)
    output.writeUInt32LE(0x4e4f534a, 16)
    output.fill(0x20, 20, 20 + jsonLength)
    jsonSource.copy(output, 20)

    const binHeader = 20 + jsonLength
    output.writeUInt32LE(binLength, binHeader)
    output.writeUInt32LE(0x004e4942, binHeader + 4)
    bin.copy(output, binHeader + 8)
    fs.writeFileSync(filePath, output)
}

function getBufferViewBytes(gltf, bin, bufferViewIndex) {
    const view = gltf.bufferViews[bufferViewIndex]
    const start = view.byteOffset ?? 0
    return Buffer.from(bin.subarray(start, start + view.byteLength))
}

function getAccessorLayout(gltf, accessorIndex) {
    const accessor = gltf.accessors[accessorIndex]
    const componentBytes = COMPONENT_BYTES[accessor.componentType]
    const components = TYPE_COMPONENTS[accessor.type]
    if (!componentBytes || !components) {
        throw new Error(`不支持的 accessor：${accessorIndex}`)
    }
    return {
        accessor,
        elementBytes: componentBytes * components,
        components,
        componentBytes,
    }
}

function filterAccessor(gltf, bin, accessorIndex, selectedIndices) {
    const { accessor, elementBytes } = getAccessorLayout(gltf, accessorIndex)
    const view = gltf.bufferViews[accessor.bufferView]
    const stride = view.byteStride ?? elementBytes
    const sourceStart = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const output = Buffer.alloc(selectedIndices.length * elementBytes)

    selectedIndices.forEach((sourceIndex, outputIndex) => {
        bin.copy(
            output,
            outputIndex * elementBytes,
            sourceStart + sourceIndex * stride,
            sourceStart + sourceIndex * stride + elementBytes
        )
    })
    return output
}

function readComponent(buffer, offset, componentType) {
    if (componentType === 5120) return buffer.readInt8(offset)
    if (componentType === 5121) return buffer.readUInt8(offset)
    if (componentType === 5122) return buffer.readInt16LE(offset)
    if (componentType === 5123) return buffer.readUInt16LE(offset)
    if (componentType === 5125) return buffer.readUInt32LE(offset)
    if (componentType === 5126) return buffer.readFloatLE(offset)
    throw new Error(`不支持的 componentType：${componentType}`)
}

function updateAccessorBounds(accessor, data) {
    if (!accessor.min && !accessor.max) return
    const componentBytes = COMPONENT_BYTES[accessor.componentType]
    const components = TYPE_COMPONENTS[accessor.type]
    const min = Array(components).fill(Number.POSITIVE_INFINITY)
    const max = Array(components).fill(Number.NEGATIVE_INFINITY)

    for (let index = 0; index < accessor.count; index += 1) {
        for (let component = 0; component < components; component += 1) {
            const value = readComponent(
                data,
                (index * components + component) * componentBytes,
                accessor.componentType
            )
            min[component] = Math.min(min[component], value)
            max[component] = Math.max(max[component], value)
        }
    }
    accessor.min = min
    accessor.max = max
}

function createSequentialFeatureIds(count, componentType) {
    if (componentType !== 5125) {
        throw new Error(`当前只支持 UINT32 Feature ID，收到 ${componentType}`)
    }
    const output = Buffer.alloc(count * 4)
    for (let index = 0; index < count; index += 1) {
        output.writeUInt32LE(index, index * 4)
    }
    return output
}

function readStringProperty(gltf, bin, property, count) {
    const values = getBufferViewBytes(gltf, bin, property.values)
    const offsets = getBufferViewBytes(gltf, bin, property.stringOffsets)
    const strings = []
    for (let index = 0; index < count; index += 1) {
        const start = offsets.readUInt32LE(index * 4)
        const end = offsets.readUInt32LE((index + 1) * 4)
        strings.push(values.subarray(start, end).toString('utf8'))
    }
    return strings
}

function encodeStrings(strings) {
    const encoded = strings.map((value) => Buffer.from(value, 'utf8'))
    const values = Buffer.concat(encoded)
    const offsets = Buffer.alloc((strings.length + 1) * 4)
    let offset = 0
    offsets.writeUInt32LE(0, 0)
    encoded.forEach((value, index) => {
        offset += value.length
        offsets.writeUInt32LE(offset, (index + 1) * 4)
    })
    return { values, offsets }
}

function rebuildBinary(gltf, originalGltf, originalBin, replacements) {
    const chunks = []
    let byteOffset = 0
    gltf.bufferViews.forEach((view, viewIndex) => {
        const data =
            replacements.get(viewIndex) ??
            getBufferViewBytes(originalGltf, originalBin, viewIndex)
        const alignedOffset = align4(byteOffset)
        if (alignedOffset > byteOffset) {
            chunks.push(Buffer.alloc(alignedOffset - byteOffset))
        }
        view.byteOffset = alignedOffset
        view.byteLength = data.length
        chunks.push(data)
        byteOffset = alignedOffset + data.length
    })
    const finalLength = align4(byteOffset)
    if (finalLength > byteOffset) {
        chunks.push(Buffer.alloc(finalLength - byteOffset))
    }
    const bin = Buffer.concat(chunks)
    gltf.buffers[0].byteLength = bin.length
    return bin
}

function buildSubset(source, selectionsByNode, outputPath) {
    const originalGltf = source.json
    const gltf = structuredClone(originalGltf)
    const replacements = new Map()
    const metadata = gltf.extensions.EXT_structural_metadata

    gltf.nodes.forEach((node, nodeIndex) => {
        const selected = selectionsByNode[nodeIndex]
        if (!selected?.length) {
            throw new Error(`${outputPath} 的节点 ${nodeIndex} 没有实例`)
        }

        const instancing = node.extensions.EXT_mesh_gpu_instancing.attributes
        Object.entries(instancing).forEach(([semantic, accessorIndex]) => {
            const accessor = gltf.accessors[accessorIndex]
            const data =
                semantic === '_FEATURE_ID_0'
                    ? createSequentialFeatureIds(
                          selected.length,
                          accessor.componentType
                      )
                    : filterAccessor(
                          originalGltf,
                          source.bin,
                          accessorIndex,
                          selected
                      )

            accessor.count = selected.length
            accessor.byteOffset = 0
            updateAccessorBounds(accessor, data)
            const view = gltf.bufferViews[accessor.bufferView]
            delete view.byteStride
            replacements.set(accessor.bufferView, data)
        })

        const featureId = node.extensions.EXT_instance_features.featureIds[0]
        featureId.featureCount = selected.length
        const propertyTable = metadata.propertyTables[featureId.propertyTable]
        const originalTable =
            originalGltf.extensions.EXT_structural_metadata.propertyTables[
                featureId.propertyTable
            ]
        propertyTable.count = selected.length

        Object.entries(propertyTable.properties).forEach(
            ([propertyName, property]) => {
                const sourceProperty = originalTable.properties[propertyName]
                const sourceStrings = readStringProperty(
                    originalGltf,
                    source.bin,
                    sourceProperty,
                    originalTable.count
                )
                const encoded = encodeStrings(
                    selected.map((index) => sourceStrings[index])
                )
                replacements.set(property.values, encoded.values)
                replacements.set(property.stringOffsets, encoded.offsets)
            }
        )
    })

    gltf.asset.generator = `${gltf.asset.generator ?? 'unknown'} + spatial split`
    const bin = rebuildBinary(gltf, originalGltf, source.bin, replacements)
    writeGlb(outputPath, gltf, bin)
}

function translationToCartographic(node, translation) {
    const gltfX = node.matrix[12] + translation[0]
    const gltfY = node.matrix[13] + translation[1]
    const gltfZ = node.matrix[14] + translation[2]
    const x = gltfX
    const y = -gltfZ
    const z = gltfY
    const horizontal = Math.hypot(x, y)
    const theta = Math.atan2(z * WGS84_A, horizontal * WGS84_B)
    const longitude = Math.atan2(y, x)
    const latitude = Math.atan2(
        z + WGS84_EP2 * WGS84_B * Math.sin(theta) ** 3,
        horizontal - WGS84_E2 * WGS84_A * Math.cos(theta) ** 3
    )
    return { longitude, latitude }
}

function readTranslation(gltf, bin, accessorIndex, instanceIndex) {
    const { accessor, elementBytes } = getAccessorLayout(gltf, accessorIndex)
    const view = gltf.bufferViews[accessor.bufferView]
    const stride = view.byteStride ?? elementBytes
    const offset =
        (view.byteOffset ?? 0) +
        (accessor.byteOffset ?? 0) +
        instanceIndex * stride
    return [
        bin.readFloatLE(offset),
        bin.readFloatLE(offset + 4),
        bin.readFloatLE(offset + 8),
    ]
}

function getCellRegion(globalX, globalY) {
    const [west, south, east, north] = ROOT_REGION
    const width = (east - west) / TOTAL_DIVISIONS
    const height = (north - south) / TOTAL_DIVISIONS
    return [
        west + globalX * width,
        south + globalY * height,
        west + (globalX + 1) * width,
        south + (globalY + 1) * height,
        -2,
        100,
    ]
}

function writeTileset(filePath, contentUri, region) {
    const tileset = {
        asset: { version: '1.1' },
        geometricError: 1000,
        root: {
            boundingVolume: { region },
            geometricError: 0,
            refine: 'ADD',
            content: { uri: contentUri },
        },
    }
    fs.writeFileSync(filePath, `${JSON.stringify(tileset, null, 2)}\n`)
}

function createSelections(source, parentX, parentY) {
    const selections = Array.from({ length: 4 }, () =>
        source.json.nodes.map(() => [])
    )
    const [west, south, east, north] = ROOT_REGION
    const width = (east - west) / TOTAL_DIVISIONS
    const height = (north - south) / TOTAL_DIVISIONS

    source.json.nodes.forEach((node, nodeIndex) => {
        const translationAccessor =
            node.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION
        const count = source.json.accessors[translationAccessor].count
        for (let instanceIndex = 0; instanceIndex < count; instanceIndex += 1) {
            const translation = readTranslation(
                source.json,
                source.bin,
                translationAccessor,
                instanceIndex
            )
            const { longitude, latitude } = translationToCartographic(
                node,
                translation
            )
            const globalX = Math.max(
                0,
                Math.min(
                    TOTAL_DIVISIONS - 1,
                    Math.floor((longitude - west) / width)
                )
            )
            const globalY = Math.max(
                0,
                Math.min(
                    TOTAL_DIVISIONS - 1,
                    Math.floor((latitude - south) / height)
                )
            )
            const childX = globalX - parentX * CHILD_DIVISIONS
            const childY = globalY - parentY * CHILD_DIVISIONS
            if (childX < 0 || childX > 1 || childY < 0 || childY > 1) {
                throw new Error(
                    `实例落在父区域外：2_${parentX}_${parentY} -> ${globalX}_${globalY}`
                )
            }
            selections[childX * CHILD_DIVISIONS + childY][nodeIndex].push(
                instanceIndex
            )
        }
    })
    return selections
}

function ensureDirectories() {
    LEVELS.forEach((level) => {
        fs.mkdirSync(path.join(OUTPUT_ROOT, level, 'content'), {
            recursive: true,
        })
        fs.mkdirSync(path.join(OUTPUT_ROOT, level, 'regions'), {
            recursive: true,
        })
    })
}

function main() {
    ensureDirectories()
    const manifest = {
        version: 1,
        divisions: TOTAL_DIVISIONS,
        rootRegion: [...ROOT_REGION, -2, 100],
        cells: [],
    }
    let totalInstances = 0

    for (let parentX = 0; parentX < SOURCE_DIVISIONS; parentX += 1) {
        for (let parentY = 0; parentY < SOURCE_DIVISIONS; parentY += 1) {
            const parentId = `2_${parentX}_${parentY}`
            const sources = Object.fromEntries(
                LEVELS.map((level) => [
                    level,
                    parseGlb(
                        path.join(
                            SOURCE_ROOT,
                            level,
                            'content',
                            `${parentId}.glb`
                        )
                    ),
                ])
            )
            const selections = createSelections(
                sources.low,
                parentX,
                parentY
            )

            for (let childX = 0; childX < CHILD_DIVISIONS; childX += 1) {
                for (
                    let childY = 0;
                    childY < CHILD_DIVISIONS;
                    childY += 1
                ) {
                    const selection =
                        selections[childX * CHILD_DIVISIONS + childY]
                    const count = selection.reduce(
                        (sum, indices) => sum + indices.length,
                        0
                    )
                    if (selection.some((indices) => indices.length === 0)) {
                        throw new Error(`${parentId}/${childX}_${childY} 缺少树种节点`)
                    }

                    const globalX = parentX * CHILD_DIVISIONS + childX
                    const globalY = parentY * CHILD_DIVISIONS + childY
                    const cellId = `3_${globalX}_${globalY}`
                    const region = getCellRegion(globalX, globalY)

                    LEVELS.forEach((level) => {
                        const sourceCounts = sources[level].json.nodes.map(
                            (node) => {
                                const accessor =
                                    node.extensions.EXT_mesh_gpu_instancing
                                        .attributes.TRANSLATION
                                return sources[level].json.accessors[accessor]
                                    .count
                            }
                        )
                        selection.forEach((indices, nodeIndex) => {
                            if (
                                indices.some(
                                    (index) => index >= sourceCounts[nodeIndex]
                                )
                            ) {
                                throw new Error(`${level}/${cellId} 实例顺序不一致`)
                            }
                        })

                        const contentPath = path.join(
                            OUTPUT_ROOT,
                            level,
                            'content',
                            `${cellId}.glb`
                        )
                        buildSubset(sources[level], selection, contentPath)
                        writeTileset(
                            path.join(
                                OUTPUT_ROOT,
                                level,
                                'regions',
                                `${cellId}.json`
                            ),
                            `../content/${cellId}.glb`,
                            region
                        )
                    })

                    manifest.cells.push({
                        id: cellId,
                        parentId,
                        treeCount: count,
                        region,
                    })
                    totalInstances += count
                }
            }
        }
    }

    manifest.totalInstances = totalInstances
    fs.writeFileSync(
        path.join(OUTPUT_ROOT, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
    )
    console.log(
        `已生成 ${manifest.cells.length} 个空间小块，实例总数 ${totalInstances}`
    )
}

main()
