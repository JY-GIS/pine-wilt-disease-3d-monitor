import { useRoutePlanStore } from '../stores/routePlanStore.js'

const Cesium = window.Cesium

// ===== 相机跟随固定参数 =====
const FOLLOW_DISTANCE = 300
const FOLLOW_HEIGHT = 150

let cameraFollowCallback = null

/**
 * 根据无人机航向，计算相机在无人机局部 ENU 坐标系中的偏移。
 * ENU 含义: x = East，东  /  y = North，北  /  z = Up，上
 */
function computeFollowOffset(headingDeg) {
    const headingRad = Cesium.Math.toRadians(headingDeg)
    const behindRad = headingRad + Math.PI
    return new Cesium.Cartesian3(
        Math.sin(behindRad) * FOLLOW_DISTANCE,
        Math.cos(behindRad) * FOLLOW_DISTANCE,
        FOLLOW_HEIGHT
    )
}
/**
 * 把局部 ENU 偏移转换成世界坐标相机位置。
 */
function getFollowCameraPosition(dronePosition, headingDeg) {
    const offset = computeFollowOffset(headingDeg)
    // 创建矩阵可以把“无人机局部ENU坐标”转换成“Cesium世界坐标”
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(dronePosition)
    /**
    * API：Cesium.Matrix4.multiplyByPoint
    * 作用：用矩阵把局部坐标点转换成世界坐标。常见于 3D 变换。
    */
    return Cesium.Matrix4.multiplyByPoint(
        transform,
        offset,
        new Cesium.Cartesian3()
    )
}
/**
 * 参数 droneFlight 由 useDroneFlight() 返回。
 */
export function useDroneCameraFollow(droneFlight) {
    const store = useRoutePlanStore()
    /**
     * 每一帧执行一次，把相机移动到无人机斜后方。
     *
     * API：viewer.camera.lookAt(target, offset)
     * 作用：让相机看向目标，并使用相对目标的 ENU 偏移设置相机位置。
     * 重要程度：非常重要，必须掌握。
     */
    function followCameraFrame(viewer) {
        if (!store.cameraFollowEnabled) return
        if (!droneFlight || !droneFlight.isDroneActive()) {
            stopCameraFollow(viewer)
            return
        }
        const dronePosition = droneFlight.getDronePosition(viewer)
        if (!dronePosition) return
        const headingDeg = droneFlight.getDroneHeading(viewer)
        const offset = computeFollowOffset(headingDeg)
        viewer.camera.lookAt(dronePosition, offset)
    }
    /**
     * 开始逐帧跟随。
     *
     * API：viewer.scene.postRender.addEventListener
     * 作用：在每一帧渲染后执行回调。
     * 重要程度：重要，Cesium 动画常用。
     */
    function startFrameFollow(viewer) {
        if (cameraFollowCallback) return
        cameraFollowCallback = () => followCameraFrame(viewer)
        viewer.scene.postRender.addEventListener(cameraFollowCallback)
    }
    /**
     * 停止逐帧跟随。
     *
     * API：viewer.scene.postRender.removeEventListener
     * 作用：移除 postRender 回调。
     * 重要程度：重要。
     */
    function stopFrameFollow(viewer) {
        if (!cameraFollowCallback || !viewer) return
        viewer.scene.postRender.removeEventListener(cameraFollowCallback)
        cameraFollowCallback = null
    }
    /**
     * 开启相机跟随。
     * 先平滑飞到无人机斜后方，再开始逐帧跟随。
     */
    function startCameraFollow(viewer) {
        if (!viewer || !droneFlight || !droneFlight.isDroneActive()) return
        const dronePosition = droneFlight.getDronePosition(viewer)
        if (!dronePosition) return
        store.setCameraFollowEnabled(true)
        const headingDeg = droneFlight.getDroneHeading(viewer)
        const cameraPosition = getFollowCameraPosition(dronePosition, headingDeg)
        const direction = Cesium.Cartesian3.normalize(
            Cesium.Cartesian3.subtract(
                dronePosition,
                cameraPosition,
                new Cesium.Cartesian3()
            ),
            new Cesium.Cartesian3()
        )
        viewer.camera.flyTo({
            destination: cameraPosition,
            orientation: {
                direction,
                up: Cesium.Cartesian3.UNIT_Z
            },
            duration: 1.0,
            complete: () => {
                if (store.cameraFollowEnabled) {
                    startFrameFollow(viewer)
                }
            },
        })
    }
    /**
     * 退出相机跟随。
     * 不恢复原视角，只在当前位置恢复自由操控。
     */
    function stopCameraFollow(viewer) {
        stopFrameFollow(viewer)
        // 解除 camera.lookAt 的目标锁定，恢复自由操控（否则退出跟随相机会一直围绕无人机旋转）
        if (viewer) {
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
        }
        store.setCameraFollowEnabled(false)
    }
    /**
     * 按钮切换开启 / 退出跟随。
     */
    function toggleCameraFollow(viewer) {
        if (store.cameraFollowEnabled) {
            stopCameraFollow(viewer)
        } else {
            startCameraFollow(viewer)
        }
    }
    /**
     * 清除无人机或页面卸载时，强制退出相机跟随。
     */
    function clearCameraFollow(viewer) {
        stopCameraFollow(viewer)
    }

    return {
        startCameraFollow,
        stopCameraFollow,
        toggleCameraFollow,
        clearCameraFollow,
    }

}




