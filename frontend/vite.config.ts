import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const antdForms = new Set([
  'auto-complete', 'button', 'cascader', 'checkbox', 'color-picker', 'date-picker',
  'form', 'input', 'input-number', 'mentions', 'radio', 'rate', 'segmented', 'select',
  'slider', 'switch', 'time-picker', 'transfer', 'tree-select', 'upload',
])
const antdFeedback = new Set([
  'alert', 'drawer', 'message', 'modal', 'notification', 'popconfirm', 'progress',
  'result', 'skeleton', 'spin', 'tour',
])
const antdData = new Set([
  'avatar', 'badge', 'calendar', 'card', 'carousel', 'collapse', 'descriptions',
  'empty', 'image', 'list', 'popover', 'qrcode', 'statistic', 'table', 'tag',
  'timeline', 'tooltip', 'tree', 'typography', 'watermark',
])
const antdNavigation = new Set([
  'anchor', 'back-top', 'breadcrumb', 'dropdown', 'float-button', 'menu',
  'pagination', 'steps', 'tabs',
])
const antdLayout = new Set([
  'affix', 'col', 'divider', 'flex', 'grid', 'layout', 'row', 'space', 'splitter',
])

// https://vite.dev/config/
export default defineConfig({
  envDir: '..',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@vidstack')) return 'media'
          if (id.includes('react-markdown') || id.includes('remark-')) return 'markdown'
          if (id.includes('@ant-design/icons')) return 'antd-icons'
          if (id.includes('@ant-design')) return 'antd-core'
          const antdModule = id.match(/node_modules\/antd\/es\/([^/]+)/)?.[1]
          if (antdModule) {
            if (antdForms.has(antdModule)) return 'antd-forms'
            if (antdFeedback.has(antdModule)) return 'antd-feedback'
            if (antdData.has(antdModule)) return 'antd-data'
            if (antdNavigation.has(antdModule)) return 'antd-navigation'
            if (antdLayout.has(antdModule)) return 'antd-layout'
            return 'antd-core'
          }
          if (id.includes('react')) return 'react'
          return 'vendor'
        },
      },
    },
  },
})
