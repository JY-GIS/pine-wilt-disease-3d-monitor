/**
 * 扩散圆环材质 —— RippleRingMaterialProperty
 * 相对路径：frontend/src/utils/rippleRingMaterialProperty.js
 *
 * 【参考】
 *   1. 掘金《Cesium 涟漪扩散点：自定义材质，参数调对了才好看》
 *   2. CSDN《Cesium 迁徙图，飞线、动态圆》中的动态扩散圆思路
 *
 * 【效果】以圆心为中心，ringCount 圈红色圆环周期性地向外扩散、逐渐变淡消失
 * 【参数】
 *   color:       环颜色（疫情推荐红色）
 *   duration:    一波扩散的周期（秒），3 = 3 秒一波
 *   ringCount:   同时存在的圈数（1~8）
 *   ringWidth:   单环相对宽度（0~1），0.08 细环、0.2 粗环
 *   centerSize:  中心亮点大小，防止扩散时中心空成黑洞
 */
const Cesium = window.Cesium

class RippleRingMaterialProperty {
    constructor(options = {}) {
        this._definitionChanged = new Cesium.Event()
        this._color = undefined
        this._secondColor = undefined
        this._duration = undefined
        this._ringCount = undefined
        this._ringWidth = undefined
        this._centerSize = undefined

        this.color = options.color ?? Cesium.Color.fromCssColorString('#d70004')
        this.secondColor = options.secondColor ?? Cesium.Color.fromCssColorString('#f7ff04') // ★金色
        this.duration = options.duration ?? 3.0
        this.ringCount = options.ringCount ?? 3.0
        this.ringWidth = options.ringWidth ?? 0.12
        this.centerSize = options.centerSize ?? 0.06
    }

    get isConstant() {
        return false
    }

    get definitionChanged() {
        return this._definitionChanged
    }

    getType(time) {
        return Cesium.Material.RippleRingMaterialType
    }

    getValue(time, result) {
        if (!Cesium.defined(result)) {
            result = {}
        }
        result.color = Cesium.Property.getValueOrDefault(
            this._color, time, Cesium.Color.fromCssColorString('#d70004'), result.color
        )
        result.secondColor = Cesium.Property.getValueOrDefault(
            this._secondColor, time, Cesium.Color.fromCssColorString('#f7ff04'), result.secondColor
        )
        result.duration = Cesium.Property.getValueOrDefault(
            this._duration, time, 3.0, result.duration
        )
        result.ringCount = Cesium.Property.getValueOrDefault(
            this._ringCount, time, 3.0, result.ringCount
        )
        result.ringWidth = Cesium.Property.getValueOrDefault(
            this._ringWidth, time, 0.12, result.ringWidth
        )
        result.centerSize = Cesium.Property.getValueOrDefault(
            this._centerSize, time, 0.06, result.centerSize
        )
        return result
    }

    equals(other) {
        return (
            this === other ||
            (other instanceof RippleRingMaterialProperty &&
                Cesium.Property.equals(this._color, other._color) &&
                Cesium.Property.equals(this._secondColor, other._secondColor) &&
                Cesium.Property.equals(this._duration, other._duration) &&
                Cesium.Property.equals(this._ringCount, other._ringCount) &&
                Cesium.Property.equals(this._ringWidth, other._ringWidth) &&
                Cesium.Property.equals(this._centerSize, other._centerSize))
        )
    }
}
Object.defineProperties(RippleRingMaterialProperty.prototype, {
    color: Cesium.createPropertyDescriptor('color'),
    secondColor: Cesium.createPropertyDescriptor('secondColor'),
    duration: Cesium.createPropertyDescriptor('duration'),
    ringCount: Cesium.createPropertyDescriptor('ringCount'),
    ringWidth: Cesium.createPropertyDescriptor('ringWidth'),
    centerSize: Cesium.createPropertyDescriptor('centerSize'),
})

// 注册材质类型（全局注册一次）
Cesium.Material.RippleRingMaterialType = 'RippleRingMaterialType'
Cesium.Material.RippleRingMaterialSource = /* glsl */ `
    uniform vec4 color;       // 第一种颜色（深红）
    uniform vec4 secondColor; // 第二种颜色（金色）
    uniform float duration;   // 一波扩散周期（秒）
    uniform float ringCount;  // 圈数
    uniform float ringWidth;  // 单环相对宽度
    uniform float centerSize; // 中心亮点大小

    const int MAX_RINGS = 8;  // GLSL 限制：循环次数必须是常量

    czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec2 st = materialInput.st;

        // 归一化距离:0 = 圆心,1 = 圆盘边缘
        float dist = distance(st, vec2(0.5, 0.5)) * 2.0;
        // 时间：帧数转秒再除以周期 → 0~1 循环,3 秒一波
        float time = float(czm_frameNumber) / 60.0 / max(duration, 0.0001);

        vec3 accColor = vec3(0.0);
        float totalAlpha = 0.0;
        for (int i = 0; i < MAX_RINGS; i++) {
            if (float(i) >= ringCount) break;
            vec4 ringColor = (mod(float(i), 2.0) < 0.5) ? color : secondColor;
            // 每圈相位错开 i/ringCount,避免叠成一根粗环
            float phase = fract(time - float(i) / max(ringCount, 1.0));
            float ringRadius = phase;                       // 该圈当前扩散到的位置（0→1）
            float distToRing = abs(dist - ringRadius);      // 片元离环的距离
            float width = ringWidth * (1.0 - phase * 0.3);  // 越往外环越细
            float ringAlpha = 1.0 - smoothstep(0.0, width, distToRing);
            ringAlpha *= (1.0 - phase * 0.7);               // 越往外越淡（消散感）
            accColor += ringColor.rgb * ringAlpha;          // 累加当前圈颜色
            totalAlpha = max(totalAlpha, ringAlpha);
        }

        // 中心小亮点：防止扩散时中心空成黑洞
        float centerAlpha = smoothstep(max(centerSize, 0.001), 0.0, dist);
        accColor += color.rgb * centerAlpha;
        totalAlpha = max(totalAlpha, centerAlpha);

        // 圆盘边缘之外直接透明，不污染周围
        if (dist > 1.0) {
            material.alpha = 0.0;
            return material;
        }

        // 发光颜色 = 各圈累加的颜色，自发光让深红/金色都亮得出来
        material.emission = accColor * (1.0 + totalAlpha);
        material.alpha = color.a * clamp(totalAlpha * 1.4, 0.0, 1.0);
        return material;
    }
`

Cesium.Material._materialCache.addMaterial(Cesium.Material.RippleRingMaterialType, {
    fabric: {
        type: Cesium.Material.RippleRingMaterialType,
        uniforms: {
            color: Cesium.Color.fromCssColorString('#d70004'),
            secondColor: Cesium.Color.fromCssColorString('#eeff00'),
            duration: 3.0,
            ringCount: 3.0,
            ringWidth: 0.12,
            centerSize: 0.06,
        },
        source: Cesium.Material.RippleRingMaterialSource,
    },
    translucent: function (material) {
        return true
    },
})

export default RippleRingMaterialProperty