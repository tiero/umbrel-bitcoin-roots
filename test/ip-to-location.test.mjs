import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {ipToLatLng, lookupPublicIpLatLng} from '../dist/modules/peers/ip-to-location.js'
import {compactGeoip} from '../scripts/compact-geoip.mjs'

test('ipToLatLng resolves public IPv4/IPv6 via on-disk binary search with minimal RAM', () => {
	const googleDns = ['8', '8', '8', '8'].join('.')
	const cloudflareV6 = ['2606', '4700', '4700', '', '1111'].join(':')
	const privateV4 = ['192', '168', '1', '1'].join('.')

	const [lat4, lng4] = ipToLatLng(googleDns, 'ipv4')
	assert.equal(typeof lat4, 'number')
	assert.equal(typeof lng4, 'number')
	assert.ok(Math.abs(lat4) <= 90 && Math.abs(lng4) <= 180)

	const [lat6, lng6] = ipToLatLng(cloudflareV6, 'ipv6')
	assert.equal(typeof lat6, 'number')
	assert.equal(typeof lng6, 'number')
	assert.ok(Math.abs(lat6) <= 90 && Math.abs(lng6) <= 180)

	// Private and Tor peers fall back deterministically
	const priv1 = ipToLatLng(privateV4, 'ipv4')
	const priv2 = ipToLatLng(privateV4, 'ipv4')
	assert.deepEqual(priv1, priv2)

	const onion1 = ipToLatLng('exampleaddress1234567890.onion', 'onion')
	const onion2 = ipToLatLng('exampleaddress1234567890.onion', 'onion')
	assert.deepEqual(onion1, onion2)

	// Verify GeoIP tables and cities.json were NOT loaded into RAM (~318 MB before vs <90 MB now)
	const rssMb = process.memoryUsage().rss / 1024 / 1024
	assert.ok(rssMb < 100, `Expected RSS < 100 MB, got ${rssMb.toFixed(1)} MB`)
})

test('compact GeoIP binary tables agree with raw geoip-lite within 0.25 degrees', () => {
	const tmpDir = mkdtempSync(path.join(tmpdir(), 'geoip-compact-'))
	try {
		compactGeoip(tmpDir)

		const googleDns = ['8', '8', '8', '8'].join('.')
		const italyTim = ['87', '0', '1', '1'].join('.')
		const cloudflareV6 = ['2606', '4700', '4700', '', '1111'].join(':')
		const rawV4 = ipToLatLng(googleDns, 'ipv4')
		const rawItaly = ipToLatLng(italyTim, 'ipv4')
		const rawV6 = ipToLatLng(cloudflareV6, 'ipv6')

		// Verify strict monotonicity on both compact binary tables
		const v4Buf = readFileSync(path.join(tmpDir, 'geoip-v4.bin'))
		for (let i = 12; i < v4Buf.length; i += 12) {
			assert.ok(v4Buf.readUInt32BE(i) > v4Buf.readUInt32BE(i - 8), `non-monotonic v4 at offset ${i}`)
		}
		const v6Buf = readFileSync(path.join(tmpDir, 'geoip-v6.bin'))
		for (let i = 20; i < v6Buf.length; i += 20) {
			assert.ok(v6Buf.readBigUInt64BE(i) > v6Buf.readBigUInt64BE(i - 12), `non-monotonic v6 at offset ${i}`)
		}

		// lookupPublicIpLatLng returns null for private/CGNAT IPs (never fakes a city)
		assert.equal(lookupPublicIpLatLng('10.21.120.8'), null)
		assert.equal(lookupPublicIpLatLng('192.168.1.1'), null)
		assert.equal(lookupPublicIpLatLng('100.64.0.1'), null)

		const out = execFileSync(
			process.execPath,
			[
				'-e',
				`import {ipToLatLng, lookupPublicIpLatLng} from './dist/modules/peers/ip-to-location.js';
				console.log(JSON.stringify({
					v4: ipToLatLng(${JSON.stringify(googleDns)}, 'ipv4'),
					italy: lookupPublicIpLatLng(${JSON.stringify(italyTim)}),
					v6: ipToLatLng(${JSON.stringify(cloudflareV6)}, 'ipv6'),
					rssMb: process.memoryUsage().rss / 1024 / 1024,
				}));`,
			],
			{env: {...process.env, GEOIP_DATA_DIR: tmpDir}, encoding: 'utf8'},
		)
		const compact = JSON.parse(out.trim())
		assert.ok(Math.abs(compact.v4[0] - rawV4[0]) <= 0.25, `v4 lat mismatch: ${compact.v4} vs ${rawV4}`)
		assert.ok(Math.abs(compact.v4[1] - rawV4[1]) <= 0.25, `v4 lng mismatch: ${compact.v4} vs ${rawV4}`)
		assert.ok(compact.italy && Math.abs(compact.italy[0] - rawItaly[0]) <= 0.25, `italy lat mismatch`)
		assert.ok(compact.italy && Math.abs(compact.italy[1] - rawItaly[1]) <= 0.25, `italy lng mismatch`)
		assert.ok(Math.abs(compact.v6[0] - rawV6[0]) <= 0.25, `v6 lat mismatch: ${compact.v6} vs ${rawV6}`)
		assert.ok(Math.abs(compact.v6[1] - rawV6[1]) <= 0.25, `v6 lng mismatch: ${compact.v6} vs ${rawV6}`)
		assert.ok(compact.rssMb < 100, `Expected compact RSS < 100 MB, got ${compact.rssMb.toFixed(1)} MB`)
	} finally {
		rmSync(tmpDir, {recursive: true, force: true})
	}
})
