<template>
  <footer class="bottom-legend">
    <span class="legend-title">病树等级图例：</span>
    <div class="legend-item">
      <span class="dot" style="background: #00ff00"></span>1级 健康
    </div>
    <div class="legend-item">
      <span class="dot" style="background: #ffff00"></span>2级 轻度
    </div>
    <div class="legend-item">
      <span class="dot" style="background: #800080"></span>3级 中度
    </div>
    <div class="legend-item">
      <span class="dot" style="background: #ff0000"></span>4级 重度
    </div>
    <div class="legend-item">
      <span class="dot" style="background: #000000; border: 1px solid #555"></span>5级 枯死
    </div>
  </footer>
</template>

<script setup>
// 纯展示组件，无需逻辑
</script>

<style scoped>
.bottom-legend {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  background: linear-gradient(0deg, rgba(0, 212, 255, 0.1) 0%, transparent 100%);
  border-top: 1px solid rgba(0, 212, 255, 0.2);
  z-index: 100;
  flex-shrink: 0;
  font-size: 13px;
}

.legend-title {
  color: #4dd9ff;
  font-weight: bold;
  letter-spacing: 1px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(232, 240, 254, 0.8);
  /* 过渡动画：状态切换时平滑过渡 */
  transition: all 0.25s ease;
  padding: 4px 10px;
  border-radius: 3px;
  border: 1px solid transparent;
}

.legend-item-active {
  color: #ffffff;
  border-color: rgba(0, 212, 255, 0.7);
  background: rgba(0, 212, 255, 0.12);
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
  /* 圆点也加过渡，放大时平滑 */
  transition: all 0.25s ease;
}
/*
  ★ 高亮态的圆点：放大一圈，增加发光
*/
.dot-active {
  width: 16px;
  height: 16px;
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.6);
}
</style>