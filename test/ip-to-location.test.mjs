import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ipToLatLng} from '../dist/modules/peers/ip-to-location.js'

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
