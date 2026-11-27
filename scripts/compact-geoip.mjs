import {mkdirSync, openSync, readFileSync, closeSync, writeSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const require = createRequire(import.meta.url)
const DEFAULT_OUT_DIR = path.resolve('apps/backend/dist/geoip')
const geoDataDir = path.join(path.dirname(require.resolve('geoip-lite/package.json')), 'data')

const NO_LOCATION = 0xffffffff
// Quantize to 0.25 degrees (~27 km — still ~4x finer than the Globe's 120 km H3 res-3 hexes)
// so adjacent ISP subnets in the same metro coalesce into a single range.
const quantizeDeg100 = (raw10000) => Math.round(raw10000 / 2500) * 25

function compactV4(srcFile, dstFile) {
	const data = readFileSync(srcFile)
	const count = Math.floor(data.length / 24)
	const out = Buffer.allocUnsafe(count * 12)
	let outCount = 0
	let prevFloor = 0
	let prevCeil = 0
	let prevLat = 0
	let prevLng = 0
	let hasPrev = false

	const flush = () => {
		const off = outCount * 12
		out.writeUInt32BE(prevFloor, off)
		out.writeUInt32BE(prevCeil, off + 4)
		out.writeInt16BE(prevLat, off + 8)
		out.writeInt16BE(prevLng, off + 10)
		outCount++
	}

	for (let i = 0; i < count; i++) {
		const off = i * 24
		const loc = data.readUInt32BE(off + 8)
		if (loc >= NO_LOCATION) continue
		const floor = data.readUInt32BE(off)
		const ceil = data.readUInt32BE(off + 4)
		const lat = quantizeDeg100(data.readInt32BE(off + 12))
		const lng = quantizeDeg100(data.readInt32BE(off + 16))

		if (hasPrev && lat === prevLat && lng === prevLng && floor <= prevCeil + 1) {
			if (ceil > prevCeil) prevCeil = ceil
		} else {
			if (hasPrev) flush()
			prevFloor = floor
			prevCeil = ceil
			prevLat = lat
			prevLng = lng
			hasPrev = true
		}
	}
	if (hasPrev) flush()

	const fd = openSync(dstFile, 'w')
	try {
		writeSync(fd, out.subarray(0, outCount * 12))
	} finally {
		closeSync(fd)
	}
	console.log(
		`[compact-geoip] v4: ${count} (${(data.length / 1e6).toFixed(1)} MB) -> ${outCount} (${((outCount * 12) / 1e6).toFixed(1)} MB)`,
	)
}

function compactV6(srcFile, dstFile) {
	const data = readFileSync(srcFile)
	const count = Math.floor(data.length / 48)
	const out = Buffer.allocUnsafe(count * 20)
	let outCount = 0
	let prevFloor = 0n
	let prevCeil = 0n
	let prevLat = 0
	let prevLng = 0
	let hasPrev = false

	const flush = () => {
		const off = outCount * 20
		out.writeBigUInt64BE(prevFloor, off)
		out.writeBigUInt64BE(prevCeil, off + 8)
		out.writeInt16BE(prevLat, off + 16)
		out.writeInt16BE(prevLng, off + 18)
		outCount++
	}

	for (let i = 0; i < count; i++) {
		const off = i * 48
		const loc = data.readUInt32BE(off + 32)
		if (loc >= NO_LOCATION) continue
		let floor = data.readBigUInt64BE(off)
		const ceil = data.readBigUInt64BE(off + 16)
		const lat = quantizeDeg100(data.readInt32BE(off + 36))
		const lng = quantizeDeg100(data.readInt32BE(off + 40))

		if (hasPrev && floor <= prevCeil) {
			if (ceil <= prevCeil) continue
			if (lat === prevLat && lng === prevLng) {
				prevCeil = ceil
				continue
			}
			floor = prevCeil + 1n
		}

		if (hasPrev && lat === prevLat && lng === prevLng && floor <= prevCeil + 1n) {
			if (ceil > prevCeil) prevCeil = ceil
		} else {
			if (hasPrev) flush()
			prevFloor = floor
			prevCeil = ceil
			prevLat = lat
			prevLng = lng
			hasPrev = true
		}
	}
	if (hasPrev) flush()

	const fd = openSync(dstFile, 'w')
	try {
		writeSync(fd, out.subarray(0, outCount * 20))
	} finally {
		closeSync(fd)
	}
	console.log(
		`[compact-geoip] v6: ${count} (${(data.length / 1e6).toFixed(1)} MB) -> ${outCount} (${((outCount * 20) / 1e6).toFixed(1)} MB)`,
	)
}

export function compactGeoip(outDir = DEFAULT_OUT_DIR) {
	mkdirSync(outDir, {recursive: true})
	compactV4(path.join(geoDataDir, 'geoip-city.dat'), path.join(outDir, 'geoip-v4.bin'))
	compactV6(path.join(geoDataDir, 'geoip-city6.dat'), path.join(outDir, 'geoip-v6.bin'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	compactGeoip()
}
