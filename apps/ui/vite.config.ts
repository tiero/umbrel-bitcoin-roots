import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
	plugins: [svgr(), react(), tailwindcss()],
	server: {
		proxy: {
			// any request starting with /api → http://localhost:3000
			'/api': {
				target: process.env['VITE_API_BASE'] || 'http://localhost:3000',
				changeOrigin: true,
				ws: true,
				rewrite: (path) => path, // keep /api/whatever as-is
			},
		},
	},
	build: {
		target: 'es2022',
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('node_modules')) return
					if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) {
						return 'vendor-react'
					}
					if (/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) {
						return 'vendor-motion'
					}
					if (/\/node_modules\/@radix-ui\//.test(id)) {
						return 'vendor-radix'
					}
					if (/\/node_modules\/@tanstack\//.test(id)) {
						return 'vendor-tanstack'
					}
				},
			},
		},
	},
	// Shadcn requirement
	// https://ui.shadcn.com/docs/installation/vite
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'#settings': path.resolve(__dirname, '../../libs/settings/index.ts'),
			'#types': path.resolve(__dirname, '../../libs/shared-types/index.d.ts'),
		},
	},
})
