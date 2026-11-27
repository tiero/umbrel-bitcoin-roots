import assert from 'node:assert/strict'
import {test} from 'node:test'
import {rpcClient} from '../dist/modules/bitcoind/rpc-client.js'

test('rpcClient.cachedCommand deduplicates in-flight calls and serves TTL cache hits', async () => {
	let calls = 0
	const origCommand = rpcClient.command
	rpcClient.command = async (method) => {
		calls++
		await new Promise((r) => setTimeout(r, 15))
		return {method, seq: calls}
	}

	try {
		// Concurrent calls share a single underlying RPC request
		const [a, b, c] = await Promise.all([
			rpcClient.cachedCommand(100, 'test_dedup_method'),
			rpcClient.cachedCommand(100, 'test_dedup_method'),
			rpcClient.cachedCommand(100, 'test_dedup_method'),
		])
		assert.equal(calls, 1)
		assert.deepEqual(a, {method: 'test_dedup_method', seq: 1})
		assert.deepEqual(b, a)
		assert.deepEqual(c, a)

		// Immediate follow-up within TTL returns cached result without calling RPC
		const cached = await rpcClient.cachedCommand(100, 'test_dedup_method')
		assert.equal(calls, 1)
		assert.deepEqual(cached, a)

		// After TTL expires, fetches a fresh result
		await new Promise((r) => setTimeout(r, 115))
		const fresh = await rpcClient.cachedCommand(100, 'test_dedup_method')
		assert.equal(calls, 2)
		assert.deepEqual(fresh, {method: 'test_dedup_method', seq: 2})
	} finally {
		rpcClient.command = origCommand
	}
})
