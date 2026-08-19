// import { defineConfig } from 'vite'
// import vue from '@vitejs/plugin-vue'
// import cesium from 'vite-plugin-cesium'

// // https://vite.dev/config/
// export default defineConfig({
//   plugins: [vue(), cesium()],
// })

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [vue(), cesium()],
  server: {
    proxy: {
      '/geoserver': {
        target: 'http://localhost:8081',
        changeOrigin: true
      },
      '/tree-tiles': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/tree-tiles/, '')
      }
    }
  }
})