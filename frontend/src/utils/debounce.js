/**
 * 防抖 & 节流工具函数
 * 用于优化高频事件（鼠标移动、窗口 resize 等）
 */

/**
 * 防抖（debounce）
 * 事件触发后等待 t 毫秒，若期间再次触发则重新计时
 * 适用场景：搜索框输入、窗口 resize
 *
 * @param {Function} fn - 要执行的函数
 * @param {number} t - 等待时间（毫秒）
 * @returns {Function} 包裹后的函数
 */
export function debounce(fn, t) {
    let timer
    return function (...args) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            fn.apply(this, args)
        }, t)
    }
}

/**
 * 节流（throttle）
 * 每 t 毫秒内最多执行一次
 * 适用场景：鼠标移动、滚动事件
 *
 * @param {Function} fn - 要执行的函数
 * @param {number} t - 间隔时间（毫秒）
 * @returns {Function} 包裹后的函数
 */
export function throttle(fn, t) {
    let timer = null
    return function (...args) {
        if (!timer) {
            timer = setTimeout(() => {
                fn.apply(this, args)
                timer = null
            }, t)
        }
    }
}