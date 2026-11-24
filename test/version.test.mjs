import assert from 'node:assert/strict'
import {test} from 'node:test'

const {parseBinaryVersionLine} = await import('../dist/modules/bitcoind/manager.js')

test('parseBinaryVersionLine parses Bitcoin Roots two-part version tags', () => {
	assert.deepEqual(parseBinaryVersionLine('Bitcoin Roots daemon version v30.3-roots.1'), {
		implementation: 'Bitcoin Roots',
		version: 'v30.3-roots.1',
	})
	assert.deepEqual(parseBinaryVersionLine('Bitcoin Roots RPC client version v32.1-roots.2'), {
		implementation: 'Bitcoin Roots',
		version: 'v32.1-roots.2',
	})
})

test('parseBinaryVersionLine preserves Bitcoin Core three-part version parsing', () => {
	assert.deepEqual(parseBinaryVersionLine('Bitcoin Core daemon version v30.3.0'), {
		implementation: 'Bitcoin Core',
		version: 'v30.3.0',
	})
})
