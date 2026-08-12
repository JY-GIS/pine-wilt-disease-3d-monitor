/**
 * 飞线流光材质 —— LineFlowMaterialProperty
 *
 *   startTime 均匀：不同线段错峰启动，实现“点1→点2、点2→点3……”的顺序飞行动画
 *   flowColor 均匀：亮头颜色与线体底色分开，流光更明显（融合第二篇博客的渐变思路）
 */
const Cesium = window.Cesium

class LineFlowMaterialProperty {
    constructor(options = {}) {
        this._definitionChanged = new Cesium.Event()
        this._color = undefined
        this._flowColor = undefined
        this._speed = undefined
        this._percent = undefined
        this._gradient = undefined
        this._startTime = undefined
        this._headCount = undefined
        this._glowPower = undefined  // 发光强度
        this.color = options.color ?? Cesium.Color.fromCssColorString('#ff0000')
        this.flowColor = options.flowColor ?? Cesium.Color.fromCssColorString('#fffb03')
        this.speed = options.speed ?? 10
        this.percent = options.percent ?? 0.08
        this.gradient = options.gradient ?? 0.08
        this.startTime = options.startTime ?? 0
        this.headCount = options.headCount ?? 3
        this.glowPower = options.glowPower ?? 2.0
    }

    get isConstant() {
        return false
    }

    get definitionChanged() {
        return this._definitionChanged
    }

    getType(time) {
        return Cesium.Material.LineFlowMaterialType
    }

    getValue(time, result) {
        if (!Cesium.defined(result)) {
            result = {}
        }
        result.color = Cesium.Property.getValueOrDefault(
            this._color, time, Cesium.Color.RED, result.color
        )
        result.flowColor = Cesium.Property.getValueOrDefault(
            this._flowColor, time, Cesium.Color.CYAN, result.flowColor
        )
        result.speed = Cesium.Property.getValueOrDefault(
            this._speed, time, 10.0, result.speed
        )
        result.percent = Cesium.Property.getValueOrDefault(
            this._percent, time, 0.08, result.percent
        )
        result.gradient = Cesium.Property.getValueOrDefault(
            this._gradient, time, 0.08, result.gradient
        )
        result.startTime = Cesium.Property.getValueOrDefault(
            this._startTime, time, 0.0, result.startTime
        )
        result.headCount = Cesium.Property.getValueOrDefault(
            this._headCount, time, 3.0, result.headCount
        )
        result.glowPower = Cesium.Property.getValueOrDefault(
            this._glowPower, time, 2.0, result.glowPower
        )
        return result
    }

    equals(other) {
        return (
            this === other ||
            (other instanceof LineFlowMaterialProperty &&
                Cesium.Property.equals(this._color, other._color) &&
                Cesium.Property.equals(this._flowColor, other._flowColor) &&
                Cesium.Property.equals(this._speed, other._speed) &&
                Cesium.Property.equals(this._percent, other._percent) &&
                Cesium.Property.equals(this._gradient, other._gradient) &&
                Cesium.Property.equals(this._startTime, other._startTime) &&
                Cesium.Property.equals(this._headCount, other._headCount) &&
                Cesium.Property.equals(this._glowPower, other._glowPower))
        )
    }
}

Object.defineProperties(LineFlowMaterialProperty.prototype, {
    color: Cesium.createPropertyDescriptor('color'),
    flowColor: Cesium.createPropertyDescriptor('flowColor'),
    speed: Cesium.createPropertyDescriptor('speed'),
    percent: Cesium.createPropertyDescriptor('percent'),
    gradient: Cesium.createPropertyDescriptor('gradient'),
    startTime: Cesium.createPropertyDescriptor('startTime'),
    headCount: Cesium.createPropertyDescriptor('headCount'),
    glowPower: Cesium.createPropertyDescriptor('glowPower'),
})

// 注册材质类型（全局注册一次）
Cesium.Material.LineFlowMaterialType = 'LineFlowMaterialType'
Cesium.Material.LineFlowMaterialSource = /* glsl */ `
    uniform vec4 color;        // 线体底色
    uniform vec4 flowColor;    // 流光/亮头颜色 
    uniform float speed;       // 速度
    uniform float percent;     // 亮头长度比例
    uniform float gradient;    // 线体基础透明度
    uniform float startTime;   // 错峰起始时间 
    uniform float headCount;   // 光点数量
    uniform float glowPower;   // 自发光强度

    const int MAX_HEADS = 4;   // GLSL 限制：循环次数必须是常量，这里是上限

    czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec2 st = materialInput.st;

        // 加入startTime:不同线段错峰启动
        float t = fract(czm_frameNumber * speed / 1000.0 + startTime);
        // t *= (1.0 + percent);  // 去掉 t *= (1.0 + percent)，亮头位置不再被拉伸

        float headAlpha = 0.0;
        if (headCount <= 1.0) {
            // 亮头沿线的方向移动(st.s:0=起点 → 1=终点),即“点1飞向点2”
            headAlpha = smoothstep(t - percent, t, st.s) * step(-t, -st.s);
        } else {
            // 多头效果:headCount 个光点等距排列，一起沿线流动
            for (int i = 0; i < MAX_HEADS; i++) {
                if (float(i) >= headCount) {
                    break;  // 超过实际数量的直接跳过
                }
                // 第 i 个光点的位置：在队首 t 的基础上，往后错开 i/headCount
                float headPos = fract(t + float(i) / headCount);
                // 以 headPos 为中心、前后各 percent 宽度的一小段窗口
                float window = smoothstep(headPos - percent, headPos, st.s)
                             - smoothstep(headPos, headPos + percent, st.s);
                headAlpha += clamp(window, 0.0, 1.0);
            }
        }

        // mix + smoothstep 让整条线从底色渐变到流光色
        vec4 ackColor = mix(color, flowColor, smoothstep(0.0, 1.0, st.s));

        // Cesium 要求这个函数返回一个czm_material,它有几个常用字段
        material.diffuse = ackColor.rgb; //diffuse:物体的本色(漫反射颜色),决定它“本来是什么颜色”
        material.alpha = clamp(headAlpha + gradient, 0.0, 1.0);//透明度
        material.emission = flowColor.rgb * headAlpha * glowPower;//emission:自发光颜色,即使没有光照也会亮,适合做光效
        return material;
    }
`

Cesium.Material._materialCache.addMaterial(Cesium.Material.LineFlowMaterialType, {
    fabric: {
        type: Cesium.Material.LineFlowMaterialType,
        uniforms: {
            color: new Cesium.Color(1.0, 0.0, 0.0, 1.0),
            flowColor: new Cesium.Color(0.0, 1.0, 1.0, 1.0),
            speed: 10.0,
            percent: 0.08,
            gradient: 0.08,
            startTime: 0.0,
            headCount: 3.0,
            glowPower: 2.0,
        },
        source: Cesium.Material.LineFlowMaterialSource,
    },
    translucent: function (material) {
        return true
    },
})

export default LineFlowMaterialProperty
