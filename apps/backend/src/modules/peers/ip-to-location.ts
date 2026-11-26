import {createHash} from 'node:crypto'
import {existsSync, fstatSync, openSync, readSync} from 'node:fs'
import {createRequire} from 'node:module'
import net from 'node:net'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

type LatLng = [number, number]

const RECORD_SIZE_V4 = 24
const RECORD_SIZE_V6 = 48
const COMPACT_SIZE_V4 = 12
const COMPACT_SIZE_V6 = 20
const NO_LOCATION = 0xffffffff
const MAX_CACHE_SIZE = 256

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

type GeoTable = {
	fd: number
	totalRecords: number
	compact: boolean
}

function resolveCompactDir(): string | null {
	const candidates = [
		process.env['GEOIP_DATA_DIR'],
		path.resolve(__dirname, '../../geoip'),
		path.resolve(process.cwd(), 'dist/geoip'),
	]
	for (const dir of candidates) {
		if (dir && existsSync(path.join(dir, 'geoip-v4.bin'))) return dir
	}
	return null
}

function resolveLegacyGeoDataDir(): string | null {
	try {
		const pkgPath = require.resolve('geoip-lite/package.json')
		return path.join(path.dirname(pkgPath), 'data')
	} catch {
		return null
	}
}

let v4Table: GeoTable | null | undefined
let v6Table: GeoTable | null | undefined

function openGeoTable(version: 4 | 6): GeoTable | null {
	const compactDir = resolveCompactDir()
	if (compactDir) {
		const filePath = path.join(compactDir, version === 4 ? 'geoip-v4.bin' : 'geoip-v6.bin')
		const recSize = version === 4 ? COMPACT_SIZE_V4 : COMPACT_SIZE_V6
		try {
			const fd = openSync(filePath, 'r')
			const totalRecords = Math.floor(fstatSync(fd).size / recSize)
			if (totalRecords > 0) return {fd, totalRecords, compact: true}
		} catch {}
	}

	const legacyDir = resolveLegacyGeoDataDir()
	if (legacyDir) {
		const filePath = path.join(legacyDir, version === 4 ? 'geoip-city.dat' : 'geoip-city6.dat')
		const recSize = version === 4 ? RECORD_SIZE_V4 : RECORD_SIZE_V6
		try {
			const fd = openSync(filePath, 'r')
			const totalRecords = Math.floor(fstatSync(fd).size / recSize)
			if (totalRecords > 0) return {fd, totalRecords, compact: false}
		} catch {}
	}

	return null
}

function getGeoTable(version: 4 | 6): GeoTable | null {
	if (version === 4) {
		if (v4Table === undefined) v4Table = openGeoTable(4)
		return v4Table
	}
	if (v6Table === undefined) v6Table = openGeoTable(6)
	return v6Table
}

const geoCache = new Map<string, LatLng | null>()
const bufV4 = Buffer.allocUnsafe(RECORD_SIZE_V4)
const bufV6 = Buffer.allocUnsafe(RECORD_SIZE_V6)

function parseIpv4(ip: string): number | null {
	const parts = ip.split('.')
	if (parts.length !== 4) return null
	let result = 0
	for (const part of parts) {
		const n = Number(part)
		if (!Number.isInteger(n) || n < 0 || n > 255) return null
		result = ((result << 8) | n) >>> 0
	}
	return result
}

function isPrivateIpv4(ip: number): boolean {
	const first = (ip >>> 24) & 0xff
	const second = (ip >>> 16) & 0xff
	return (
		first === 10 ||
		first === 127 ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 169 && second === 254)
	)
}

function parseIpv6Prefix(ip: string): bigint | null {
	const clean = ip.replace(/^\[|\]$/g, '').split('%')[0]
	const halves = clean.split('::')
	if (halves.length > 2) return null

	const left = halves[0] ? halves[0].split(':') : []
	const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
	const missing = 8 - (left.length + right.length)
	if (halves.length === 1 ? missing !== 0 : missing < 0) return null

	const groups = [...left, ...Array<string>(missing).fill('0'), ...right]
	let prefix = 0n
	for (let i = 0; i < 4; i++) {
		const val = Number.parseInt(groups[i] || '0', 16)
		if (!Number.isInteger(val) || val < 0 || val > 0xffff) return null
		prefix = (prefix << 16n) | BigInt(val)
	}
	return prefix
}

function isPrivateIpv6(prefix: bigint): boolean {
	const first16 = Number((prefix >> 48n) & 0xffffn)
	return (first16 & 0xfe00) === 0xfc00 || (first16 & 0xffc0) === 0xfe80 || prefix === 0n
}

function extractMappedIpv4(ip: string): string | null {
	const lower = ip.toLowerCase()
	if (lower.startsWith('::ffff:')) return lower.slice('::ffff:'.length)
	if (lower.startsWith('0:0:0:0:0:ffff:')) return lower.slice('0:0:0:0:0:ffff:'.length)
	return null
}

// On-disk binary search over sorted fixed-width GeoIP tables (compact production .bin or geoip-lite .dat).
// Uses cached file descriptors and avoids loading ~105 MB of GeoIP tables into Node.js RAM at startup.
function lookupIpv4OnDisk(ipInt: number): LatLng | null {
	if (isPrivateIpv4(ipInt)) return null
	const table = getGeoTable(4)
	if (!table) return null
	const recSize = table.compact ? COMPACT_SIZE_V4 : RECORD_SIZE_V4
	try {
		let low = 0
		let high = table.totalRecords - 1

		while (low <= high) {
			const mid = (low + high) >>> 1
			if (readSync(table.fd, bufV4, 0, recSize, mid * recSize) < recSize) return null
			const floor = bufV4.readUInt32BE(0)
			const ceil = bufV4.readUInt32BE(4)
			if (ipInt < floor) {
				high = mid - 1
			} else if (ipInt > ceil) {
				low = mid + 1
			} else if (table.compact) {
				return [bufV4.readInt16BE(8) / 100, bufV4.readInt16BE(10) / 100]
			} else {
				const locId = bufV4.readUInt32BE(8)
				if (locId >= NO_LOCATION) return null
				return [bufV4.readInt32BE(12) / 10000, bufV4.readInt32BE(16) / 10000]
			}
		}
		return null
	} catch {
		return null
	}
}

function lookupIpv6OnDisk(prefix: bigint): LatLng | null {
	if (isPrivateIpv6(prefix)) return null
	const table = getGeoTable(6)
	if (!table) return null
	const recSize = table.compact ? COMPACT_SIZE_V6 : RECORD_SIZE_V6
	try {
		let low = 0
		let high = table.totalRecords - 1

		while (low <= high) {
			const mid = (low + high) >>> 1
			if (readSync(table.fd, bufV6, 0, recSize, mid * recSize) < recSize) return null
			const floor = bufV6.readBigUInt64BE(0)
			const ceil = table.compact ? bufV6.readBigUInt64BE(8) : bufV6.readBigUInt64BE(16)
			if (prefix < floor) {
				high = mid - 1
			} else if (prefix > ceil) {
				low = mid + 1
			} else if (table.compact) {
				return [bufV6.readInt16BE(16) / 100, bufV6.readInt16BE(18) / 100]
			} else {
				const locId = bufV6.readUInt32BE(32)
				if (locId >= NO_LOCATION) return null
				return [bufV6.readInt32BE(36) / 10000, bufV6.readInt32BE(40) / 10000]
			}
		}
		return null
	} catch {
		return null
	}
}

function lookupGeoLatLng(ip: string): LatLng | null {
	if (geoCache.has(ip)) return geoCache.get(ip) ?? null

	let result: LatLng | null = null
	const ipVersion = net.isIP(ip)
	if (ipVersion === 4) {
		const parsed = parseIpv4(ip)
		if (parsed !== null) result = lookupIpv4OnDisk(parsed)
	} else if (ipVersion === 6) {
		const mapped = extractMappedIpv4(ip)
		if (mapped && net.isIPv4(mapped)) {
			const parsed = parseIpv4(mapped)
			if (parsed !== null) result = lookupIpv4OnDisk(parsed)
		} else {
			const prefix = parseIpv6Prefix(ip)
			if (prefix !== null) result = lookupIpv6OnDisk(prefix)
		}
	}

	if (geoCache.size >= MAX_CACHE_SIZE) {
		const oldest = geoCache.keys().next().value
		if (oldest !== undefined) geoCache.delete(oldest)
	}
	geoCache.set(ip, result)
	return result
}

// 64-entry pre-resolved list of city coordinates for fallback when geoip lookup fails or peer is tor/i2p/etc.
// Weighted by Bitnodes June-2025 reachable nodes estimates: https://bitnodes.io/nodes/all/countries/
// Pre-resolved to avoid loading the ~21 MB cities.json dataset (~170 MB RSS in V8) into memory at startup.
const fallbackCityCoords: readonly LatLng[] = [
	// United States (30% of peers = ~19)
	[40.71427, -74.00597], // New York City|US
	[41.85003, -87.65005], // Chicago|US
	[34.05223, -118.24368], // Los Angeles|US
	[47.60621, -122.33207], // Seattle|US
	[37.77493, -122.41942], // San Francisco|US
	[39.73915, -104.9847], // Denver|US
	[44.91928, -123.31705], // Dallas|US
	[35.69143, -100.63819], // Miami|US
	[45.00473, -84.14389], // Atlanta|US
	[42.62895, -78.73753], // Boston|US
	[42.27541, -122.81809], // Phoenix|US
	[61.63028, -149.81806], // Houston|US
	[44.97997, -93.26384], // Minneapolis|US
	[44.1545, -75.70882], // Philadelphia|US
	[45.52345, -122.67621], // Portland|US
	[32.71571, -117.16472], // San Diego|US
	[36.17497, -115.13722], // Las Vegas|US
	[39.09973, -94.57857], // Kansas City|US
	[40.76078, -111.89105], // Salt Lake City|US

	// Germany (13% of peers = ~9)
	[50.11552, 8.68417], // Frankfurt am Main|DE
	[52.52437, 13.41053], // Berlin|DE
	[51.22172, 6.77616], // Düsseldorf|DE
	[53.55073, 9.99302], // Hamburg|DE
	[48.13743, 11.57549], // Munich|DE
	[49.45421, 11.07752], // Nürnberg|DE
	[48.78232, 9.17702], // Stuttgart|DE
	[50.93333, 6.95], // Köln|DE
	[51.33962, 12.37129], // Leipzig|DE

	// Canada (5% of peers = ~3)
	[43.70643, -79.39864], // Toronto|CA
	[45.50884, -73.58781], // Montréal|CA
	[49.24966, -123.11934], // Vancouver|CA

	// France (4% of peers = ~3)
	[48.85341, 2.3488], // Paris|FR
	[45.74846, 4.84671], // Lyon|FR
	[43.29695, 5.38107], // Marseille|FR

	// United Kingdom (4% of peers = ~3)
	[51.50853, -0.12574], // London|GB
	[53.48095, -2.23743], // Manchester|GB
	[52.48142, -1.89983], // Birmingham|GB

	// Netherlands (3% of peers = ~2)
	[52.37403, 4.88969], // Amsterdam|NL
	[51.9225, 4.47917], // Rotterdam|NL
	[52.07667, 4.29861], // The Hague|NL

	// China (2% of peers = ~1)
	[39.9075, 116.39723], // Beijing|CN
	[31.22222, 121.45806], // Shanghai|CN

	// Russia (2% of peers = ~1)
	[55.75222, 37.61556], // Moscow|RU
	[59.93863, 30.31413], // Saint Petersburg|RU

	// Australia (2% of peers = ~1)
	[-33.86785, 151.20732], // Sydney|AU
	[-37.814, 144.96332], // Melbourne|AU

	// Brazil (2% of peers = ~1)
	[-23.5475, -46.63611], // São Paulo|BR
	[-22.90642, -43.18223], // Rio de Janeiro|BR

	// Switzerland (2% of peers = ~1)
	[47.36667, 8.55], // Zürich|CH
	[46.20222, 6.14569], // Genève|CH

	// Single-bucket countries (1% of peers = ~1)
	[40.4165, -3.70256], // Madrid|ES
	[45.46427, 9.18951], // Milan|IT
	[60.16952, 24.93545], // Helsinki|FI
	[35.6895, 139.69171], // Tokyo|JP
	[1.28967, 103.85007], // Singapore|SG
	[37.566, 126.9784], // Seoul|KR
	[59.32938, 18.06871], // Stockholm|SE
	[50.08804, 14.42076], // Prague|CZ
	[48.20849, 16.37208], // Vienna|AT
	[22.27832, 114.17469], // Hong Kong|HK
	[38.71667, -9.13333], // Lisbon|PT
	[50.85045, 4.34878], // Brussels|BE
	[13.75398, 100.50144], // Bangkok|TH
	[52.22977, 21.01178], // Warsaw|PL
]

// Returns a latitude and longitude for a given IP address and network.
// If it is a public ipv4/ipv6 address found in geoip-lite's binary database, returns its [lat, lng].
// Otherwise returns a deterministic city from the 64-entry curated list.
export function ipToLatLng(ip: string, network: string): LatLng {
	if (network === 'ipv4' || network === 'ipv6') {
		const geo = lookupGeoLatLng(ip)
		if (geo) return [geo[0], geo[1]]
	}
	const idx = createHash('sha256').update(ip).digest()[0] & 63 // 0-63
	const [lat, lng] = fallbackCityCoords[idx]
	return [lat, lng]
}
