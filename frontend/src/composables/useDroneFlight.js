import { useRoutePlanStore } from '../stores/routePlanStore.js'
import { sampleTerrainHeight } from '../utils/cesiumUtils.js'
import LineFlowMaterialProperty from '../utils/lineFlowMaterialProperty.js'

const Cesium = window.Cesium

let droneDataSource = null  // CZML 数据源，内部包含移动的无人机模型
let flightLineEntity = null // 空中流光路线实体
let clockBackup = null      // 保存进入无人机动画前的 Cesium 时钟状态
let droneStartTime = null   // 无人机动画开始时间
let droneStopTime = null    // 无人机动画结束时间

const EARTH_RADIUS = 6371000

/**
 * 计算两个经纬度之间的球面距离，单位：米。
 * 这是标准的 Haversine 公式。
 */
function haversine(lat1, lon1, lat2, lon2) {
    const dLat = Cesium.Math.toRadians(lat2 - lat1)
    const dLon = Cesium.Math.toRadians(lon2 - lon1)

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(Cesium.Math.toRadians(lat1))
        * Math.cos(Cesium.Math.toRadians(lat2))
        * Math.sin(dLon / 2) * Math.sin(dLon / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return EARTH_RADIUS * c
}

/**
 * 计算从第一个点指向第二个点的初始方位角，单位：度。
 * 方位角 0 度是正北，90 度是正东。
 */
function initialBearing(lat1, lng1, lat2, lng2) {
    const radLat1 = Cesium.Math.toRadians(lat1)
    const radLat2 = Cesium.Math.toRadians(lat2)
    const dLng = Cesium.Math.toRadians(lng2 - lng1)

    const y = Math.sin(dLng) * Math.cos(radLat2)
    const x = Math.cos(radLat1) * Math.sin(radLat2)
        - Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLng)

    const degrees = Cesium.Math.toDegrees(Math.atan2(y, x))
    return (degrees + 360) % 360
}
// ===== 根据经纬度、高度和航向角计算四元数 =====
function computeOrientation(lng, lat, height, headingDeg, pitchDeg = 0) {
    const position = Cesium.Cartesian3.fromDegrees(lng, lat, height)
    const headingOffset = 90
    const hpr = new Cesium.HeadingPitchRoll( // 作用：表示 heading/pitch/roll 三个姿态角
        Cesium.Math.toRadians(headingDeg + headingOffset),
        Cesium.Math.toRadians(pitchDeg),
        Cesium.Math.toRadians(0)
    )
    // Cesium.Transforms.headingPitchRollQuaternion 作用：把 HeadingPitchRoll 转成 Cesium 四元数
    const q = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)
    return {
        x: q.x,
        y: q.y,
        z: q.z,
        w: q.w
    }
}

/**
 * 创建一个无人机飞行关键帧。
 * 关键帧 = 某个时间点，无人机的位置、高度和姿态。
 */
function createPoint(time, lng, lat, height, heading, pitchDeg = 0) {
    // ===== 计算模型朝向四元数 =====
    const orientation = computeOrientation(lng, lat, height, heading, pitchDeg)
    return {
        time,
        lng,
        lat,
        height,
        headingDeg: heading,
        pitchDeg,
        rollDeg: 0,
        orientation,
    }
}
// ===== 在两个病树点之间生成很多中间经纬度点 =====
function buildDenseLngLatPoints(route, samplesPerSegment) {
    const densePoints = []
    for (let i = 0; i < route.length - 1; i++) {
        const current = route[i]
        const next = route[i + 1]
        for (let k = 0; k <= samplesPerSegment; k++) {
            const ratio = k / samplesPerSegment
            densePoints.push([
                current.lng + (next.lng - current.lng) * ratio,
                current.lat + (next.lat - current.lat) * ratio,
            ])
        }
    }
    return densePoints
}
// ===== 采集两点之间的多点经纬度对应的高度 =====
function routePointGroundHeight(i, routeLength, denseHeights, samplesPerSegment) {
    if (routeLength < 2) return 0
    if (i === routeLength - 1) {
        return denseHeights[denseHeights.length - 1] || 0
    }
    const index = i * (samplesPerSegment + 1)
    return denseHeights[index] || 0
}

/**
 * 纯前端核心函数：根据已有路径点，生成无人机飞行计划。
 */
function buildLocalFlight(route, denseCoords, denseHeights, options) {
    const speedMps = options.speedMps ?? 15
    const hoverSeconds = options.hoverSeconds ?? 1
    const sampleIntervalSeconds = options.sampleIntervalSeconds ?? 0.5
    const altitudeMeters = options.altitudeMeters ?? 100

    const samplesPerSegment = options.samplesPerSegment ?? 20
    const points = []
    let currentTime = 0  // 当前累计时间
    let previousHeading = 0

    for (let i = 0; i < route.length; i++) {
        const current = route[i]
        const currentGroundHeight = routePointGroundHeight(
            i,
            route.length,
            denseHeights,
            samplesPerSegment,
        )
        const height = currentGroundHeight + altitudeMeters
        let heading
        if (i < route.length - 1) {
            const next = route[i + 1]
            heading = initialBearing(
                current.lat,
                current.lng,
                next.lat,
                next.lng
            )
        } else {
            heading = previousHeading
        }
        previousHeading = heading
        // 到达病树点
        points.push(
            createPoint(
                currentTime, current.lng, current.lat, height, heading
            )
        )
        // 悬停观察
        currentTime += hoverSeconds
        if (hoverSeconds > 0) {
            points.push(
                createPoint(
                    currentTime, current.lng, current.lat, height, heading
                )
            )
        }
        // 从当前病树点飞向下一个病树点
        if (i < route.length - 1) {
            const next = route[i + 1]
            const distance = haversine(current.lat, current.lng, next.lat, next.lng)
            const duration = distance / speedMps
            const startIndex = i * (samplesPerSegment + 1)
            // ===== 遍历中间密集点 =====
            for (let k = 1; k < samplesPerSegment; k++) {
                const index = startIndex + k
                const lng = denseCoords[index][0]
                const lat = denseCoords[index][1]
                // ===== 中间点真实地形高度 =====
                const groundHeight = denseHeights[index] || 0
                const nextGroundHeight = denseHeights[index + 1] || 0
                const finalHeight = groundHeight + altitudeMeters
                // ===== 沿路径切线方向计算航向 =====
                const prevPoint = denseCoords[index - 1]
                const nextPoint = denseCoords[index + 1]
                const curveHeading = initialBearing(
                    prevPoint[1],
                    prevPoint[0],
                    nextPoint[1],
                    nextPoint[0]
                )
                const verticalDistance = nextGroundHeight - groundHeight
                const horizontalDistance = haversine(
                    lat,
                    lng,
                    nextPoint[1],
                    nextPoint[0]
                )
                const pitchDeg = -Cesium.Math.toDegrees(
                    Math.atan2(verticalDistance, horizontalDistance)
                )
                const ratio = k / samplesPerSegment
                points.push(
                    createPoint(
                        currentTime + duration * ratio,
                        lng, lat,
                        finalHeight,
                        curveHeading,
                        pitchDeg,
                    )
                )
            }
            currentTime += duration
        }
    }
    return {
        speedMps,
        hoverSeconds,
        altitudeMeters,
        samplesPerSegment,
        totalDurationSeconds: currentTime,
        points,
        flightLine: {
            type: 'LineString',
            coordinates: points.map((p) => [p.lng, p.lat, p.height]),
        },
    }
}

/**
 * 把本地生成的飞行计划转换成 CZML 数据。
 */
function buildCzml(flight) {
    const start = Cesium.JulianDate.fromIso8601('2025-01-01T00:00:00Z')
    const stop = Cesium.JulianDate.addSeconds(
        start.clone(),
        flight.totalDurationSeconds,
        new Cesium.JulianDate()
    )

    const interval = `${Cesium.JulianDate.toIso8601(start)}/${Cesium.JulianDate.toIso8601(stop)}`

    const cartographicDegrees = []
    const unitQuaternion = []
    flight.points.forEach((p) => {
        cartographicDegrees.push(p.time, p.lng, p.lat, p.height)
        // ===== 每个关键帧都加入朝向 =====
        unitQuaternion.push(
            p.time,
            p.orientation.x,
            p.orientation.y,
            p.orientation.z,
            p.orientation.w
        )
    })
    return [
        {
            id: 'document',
            version: '1.0',
            clock: {
                interval,
                currentTime: Cesium.JulianDate.toIso8601(start),
                multiplier: 1,
                range: 'LOOP_STOP',
            },
        },
        {
            id: 'droneModel',
            availability: interval,

            position: {
                interpolationAlgorithm: 'LAGRANGE',
                interpolationDegree: 1,
                epoch: Cesium.JulianDate.toIso8601(start),
                cartographicDegrees,
            },

            orientation: {
                interpolationAlgorithm: 'LAGRANGE',
                interpolationDegree: 1,
                epoch: Cesium.JulianDate.toIso8601(start),
                unitQuaternion,
            },

            model: {
                gltf: '/models/drone.glb',
                scale: 10,
                minimumPixelSize: 32,
            },
        },
    ]
}
export function useDroneFlight() {
    const store = useRoutePlanStore()
    /**
     * 保存当前 Cesium 全局时钟，再切换到无人机动画时钟。
     */
    function saveAndStartClock(viewer, flight) {
        clockBackup = {
            startTime: viewer.clock.startTime.clone(),
            stopTime: viewer.clock.stopTime.clone(),
            currentTime: viewer.clock.currentTime.clone(),
            multiplier: viewer.clock.multiplier,
            shouldAnimate: viewer.clock.shouldAnimate,
            clockRange: viewer.clock.clockRange,
        }
        droneStartTime = Cesium.JulianDate.fromIso8601('2025-01-01T00:00:00Z')
        droneStopTime = Cesium.JulianDate.addSeconds(
            droneStartTime.clone(),
            flight.totalDurationSeconds,
            new Cesium.JulianDate()
        )
        viewer.clock.startTime = droneStartTime.clone()
        viewer.clock.stopTime = droneStopTime.clone()
        viewer.clock.currentTime = droneStartTime.clone()
        viewer.clock.multiplier = 1
        viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP
        viewer.clock.shouldAnimate = true
    }
    /**
     * 退出无人机后，把 Cesium 时钟恢复到进入动画之前的状态。
     */
    function restoreClock(viewer) {
        if (!clockBackup || !viewer) return

        viewer.clock.startTime = clockBackup.startTime
        viewer.clock.stopTime = clockBackup.stopTime
        viewer.clock.currentTime = clockBackup.currentTime
        viewer.clock.multiplier = clockBackup.multiplier
        viewer.clock.clockRange = clockBackup.clockRange
        viewer.clock.shouldAnimate = clockBackup.shouldAnimate

        clockBackup = null
        droneStartTime = null
        droneStopTime = null
    }
    /**
     * 移除无人机 CZML 图层和空中路线，并恢复原时钟。
     */
    function removeDroneVisuals(viewer) {
        if (!viewer) return
        if (droneDataSource) {
            try {
                // 第二个参数 true 表示同时销毁 DataSource 内部资源。
                viewer.dataSources.remove(droneDataSource, true)
            } catch (e) {
                console.warn('移除无人机 DataSource 失败', e)
            }
            droneDataSource = null
        }
        if (flightLineEntity) {
            try {
                viewer.entities.remove(flightLineEntity)
            } catch (e) {
                console.warn('移除无人机 flightLineEntity 失败', e)
            }
            flightLineEntity = null
        }
        restoreClock(viewer)
    }
    /**
     * 画一条半透明的空中流光路线。
     */
    function drawFlightLine(viewer, flight) {
        const coords = flight.flightLine?.coordinates
        if (!coords || coords.length < 2) return

        const positions = coords.map((coord) =>
            Cesium.Cartesian3.fromDegrees(
                coord[0],
                coord[1],
                coord[2]
            )
        )
        flightLineEntity = viewer.entities.add({
            polyline: {
                positions,
                width: 3,
                clampToGround: false,
                material: new LineFlowMaterialProperty({
                    color: Cesium.Color.fromCssColorString('#2fd6ff').withAlpha(0.25),
                    flowColor: Cesium.Color.fromCssColorString('#ffffff'),
                    speed: 8,
                    percent: 0.08,
                    gradient: 0.12,
                    startTime: 0,
                    headCount: 2,
                    glowPower: 1.5,
                }),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
        })
    }
    /**
     * 纯前端核心流程：
     * 读取已有 route -> 采样地形 -> 生成飞行计划 -> 生成 CZML -> 加载。
     */
    async function buildAndLoadDrone(viewer, route) {
        removeDroneVisuals(viewer)
        if (!route || route.length < 2) {
            alert('路线点不足，无法生成无人机动画')
            store.setDroneStatus('idle')
            return
        }
        const samplesPerSegment = 20
        const altitudeMeters = 100
        const denseCoords = buildDenseLngLatPoints(route, samplesPerSegment)
        let denseHeights = []
        try {
            const sampled = await sampleTerrainHeight(denseCoords, viewer)
            denseHeights = sampled.map((cartesian) => {
                const carto = Cesium.Cartographic.fromCartesian(cartesian)
                return carto.height || 0
            })
        } catch (e) {
            console.warn('地形采样失败，使用 0 米地面高度', e)
            denseHeights = denseCoords.map(() => 0)
        }
        const flight = buildLocalFlight(route, denseCoords, denseHeights, {
            speedMps: 15,
            hoverSeconds: 1,
            altitudeMeters,
            samplesPerSegment,
        })
        const czml = buildCzml(flight)
        /**
         * CzmlDataSource.load()：
         * 加载 CZML 数组，生成一个 Cesium DataSource。
         * 这个 DataSource 内部会包含会移动的无人机模型。
         */
        droneDataSource = await Cesium.CzmlDataSource.load(czml)
        viewer.dataSources.add(droneDataSource)
        drawFlightLine(viewer, flight)
        saveAndStartClock(viewer, flight)

        /**
         * 把本地生成的结果保存到 store。
         * 右侧面板需要显示总距离和飞行时长。
         */
        store.setDroneFlightResult({
            totalDistance: store.planResult?.totalDistance || 0,
            droneFlight: flight,
        })
        store.setDroneStatus('playing')
    }
    /**
     * 启动无人机。
     */
    async function startDrone(viewer) {
        if (!viewer) return
        const route = store.planResult?.route
        if (!route || route.length < 2) {
            alert('请先获取调查方案')
            return
        }
        store.setDroneStatus('loading')
        try {
            await buildAndLoadDrone(viewer, route)
        } catch (e) {
            console.error('无人机动画生成失败', e)
            alert('无人机动画生成失败')
            store.setDroneStatus('idle')
        }
    }
    /**
     * 暂停：只停止时钟，不重置 currentTime。
     */
    function pauseDrone(viewer) {
        if (!viewer || !droneDataSource) return
        viewer.clock.shouldAnimate = false
        store.setDroneStatus('paused')
    }
    /**
     * 继续：重新让时钟走。
     */
    function resumeDrone(viewer) {
        if (!viewer || !droneDataSource) return
        viewer.clock.shouldAnimate = true
        store.setDroneStatus('playing')
    }
    /**
     * 隐藏：隐藏图层，同时暂停时钟。
     */
    function hideDrone(viewer) {
        if (!viewer || !droneDataSource) return
        viewer.clock.shouldAnimate = false
        droneDataSource.show = false
        store.setDroneStatus('hidden')
    }
    /**
    * 显示：重新显示，并重置到起点重新开始。
    */
    function showDrone(viewer) {
        if (!viewer || !droneDataSource) return
        droneDataSource.show = true
        viewer.clock.currentTime = droneStartTime.clone()
        viewer.clock.shouldAnimate = true
        store.setDroneStatus('playing')
    }
    /**
     * 清除无人机。 resetStore 默认 true，表示同时清空 store 里的无人机状态。
     */
    function clearDrone(viewer, resetStore = true) {
        removeDroneVisuals(viewer)
        if (resetStore) {
            store.clearDroneFlight()
        }
    }

    return {
        startDrone,
        pauseDrone,
        resumeDrone,
        hideDrone,
        showDrone,
        clearDrone,
    }
}
