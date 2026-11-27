import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {polygonToCells} from 'h3-js'

test('globe countries GeoJSON converts all 177 features to H3 cells without errors', () => {
	const data = JSON.parse(readFileSync('apps/ui/public/datasets/ne_110m_admin_0_countries.geojson', 'utf8'))
	assert.equal(data.type, 'FeatureCollection')
	assert.equal(data.features.length, 177)

	let totalCells = 0
	for (let i = 0; i < data.features.length; i++) {
		const geom = data.features[i].geometry
		const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
		for (const poly of polys) {
			totalCells += polygonToCells(poly, 3, true).length
		}
	}

	assert.ok(totalCells > 11_000, `Expected >11,000 H3 res-3 cells across all countries, got ${totalCells}`)
})
