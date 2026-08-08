<template>
  <div class="fps-counter" v-if="fps !== null">
    {{ fps }} FPS
  </div>
</template>

<script setup>
defineProps({
//Vue3<script setup>专用语法：定义组件允许接收的外部参数（父组件传进来的数据）
  fps: {
    type: Number,
    default: null,
  },
})
</script>

<style scoped>
.fps-counter {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: #0f0;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  padding: 4px 10px;
  border-radius: 3px;
  z-index: 10;
  pointer-events: none;
}
</style>