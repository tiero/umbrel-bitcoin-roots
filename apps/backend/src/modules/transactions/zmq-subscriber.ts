// Bitcoin Core's ZMQ `pubhashtx` transaction notifier is NOT SILENT during IBD and initial startup.
// We wait until the node is fully synced (IBD complete AND blocks === headers) and the mempool
// is loaded before subscribing to `pubhashtx`.
//
// Demand-driven subscription: we only keep the ZMQ `hashtx` socket open while at least one UI
// WebSocket client is connected (acquireTransactionStream / releaseTransactionStream), avoiding
// continuous ZMQ wakeups and V8 buffer allocations when no browser tab is open.

import {EventEmitter} from 'node:events'
import zmq from 'zeromq'

import {rpcClient} from '../bitcoind/rpc-client.js'
import {bitcoind} from '../bitcoind/bitcoind.js'

async function waitSynced(isCurrent: () => boolean, pollMs = 5_000): Promise<boolean> {
	while (isCurrent()) {
		try {
			const {initialblockdownload, blocks, headers} = await rpcClient.command<{
				initialblockdownload: boolean
				blocks: number
				headers: number
			}>('getblockchaininfo')
			if (!initialblockdownload && blocks === headers) return true
		} catch {
			// rpc not ready yet or bitcoind is down
		}
		await new Promise((r) => setTimeout(r, pollMs))
	}
	return false
}

async function waitMempoolLoaded(isCurrent: () => boolean, pollMs = 2_000): Promise<boolean> {
	while (isCurrent()) {
		try {
			const {loaded} = await rpcClient.command<{loaded: boolean}>('getmempoolinfo')
			if (loaded) return true
		} catch {
			// rpc not ready yet or bitcoind is down
		}
		await new Promise((r) => setTimeout(r, pollMs))
	}
	return false
}

export const transactionStream = new EventEmitter()

let currentSubscriber: zmq.Subscriber | null = null
let activeConsumers = 0
let generation = 0

async function startTransactionSubscriber(): Promise<void> {
	const gen = ++generation
	const isCurrent = () => gen === generation && activeConsumers > 0

	if (!(await waitSynced(isCurrent))) return
	if (!(await waitMempoolLoaded(isCurrent))) return
	if (!isCurrent()) return

	const sub = new zmq.Subscriber()
	currentSubscriber = sub
	sub.connect(`tcp://0.0.0.0:${process.env['ZMQ_HASHTX_PORT'] || '28336'}`)
	sub.subscribe('hashtx')

	for await (const msg of sub) {
		if (!isCurrent()) break
		void msg
		transactionStream.emit('hashtx')
	}
}

function stopTransactionSubscriber() {
	generation++
	if (currentSubscriber) {
		console.log('[tx-subscriber] Stopping transaction subscriber')
		currentSubscriber.close()
		currentSubscriber = null
	}
}

export function acquireTransactionStream() {
	activeConsumers += 1
	if (activeConsumers === 1) {
		startTransactionSubscriber().catch((err) => console.error('ZMQ hashtx subscriber crashed:', err))
	}
}

export function releaseTransactionStream() {
	activeConsumers = Math.max(0, activeConsumers - 1)
	if (activeConsumers === 0) {
		stopTransactionSubscriber()
	}
}

bitcoind.events.on('stop', stopTransactionSubscriber)
bitcoind.events.on('exit', stopTransactionSubscriber)

bitcoind.events.on('start', () => {
	if (activeConsumers > 0) {
		console.log('[tx-subscriber] Bitcoind started, restarting transaction subscriber')
		startTransactionSubscriber().catch((err) => console.error('ZMQ hashtx subscriber crashed:', err))
	}
})
