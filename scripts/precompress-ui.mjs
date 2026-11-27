import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {brotliCompressSync, constants, gzipSync} from 'node:zlib'

const rootDir = path.resolve('apps/ui/dist')
const COMPRESSIBLE_EXTS = new Set(['.js', '.css', '.html', '.svg', '.json', '.geojson', '.ttf', '.webmanifest'])
const MIN_BYTES = 1024

let filesCompressed = 0
let rawTotal = 0
let brTotal = 0
let gzTotal = 0

function walk(dir) {
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			walk(fullPath)
			continue
		}
		const ext = path.extname(entry.name).toLowerCase()
		if (!COMPRESSIBLE_EXTS.has(ext)) continue
		const size = statSync(fullPath).size
		if (size < MIN_BYTES) continue

		const raw = readFileSync(fullPath)
		const br = brotliCompressSync(raw, {
			params: {
				[constants.BROTLI_PARAM_QUALITY]: 11,
				[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
			},
		})
		const gz = gzipSync(raw, {level: 9})

		if (br.length < raw.length) writeFileSync(`${fullPath}.br`, br)
		if (gz.length < raw.length) writeFileSync(`${fullPath}.gz`, gz)

		filesCompressed++
		rawTotal += raw.length
		brTotal += Math.min(br.length, raw.length)
		gzTotal += Math.min(gz.length, raw.length)
	}
}

walk(rootDir)
console.log(
	`[precompress-ui] ${filesCompressed} files: ${(rawTotal / 1024).toFixed(1)} KB raw -> ${(brTotal / 1024).toFixed(1)} KB br, ${(gzTotal / 1024).toFixed(1)} KB gz`,
)
