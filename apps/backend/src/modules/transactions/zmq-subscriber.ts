// Bitcoin Core's ZMQ `pubhashtx` transaction notifier is NOT SILENT during IBD and initial startup.
// We wait until the node is fully synced (IBD complete AND blocks === headers) and the mempool
// is loaded before subscribing to `pubhashtx`.
//
// Demand-driven subscription: we only keep the ZMQ `hashtx` socket open while at least one UI
// WebSocket client is connected (acquireTransactionStream / releaseTransactionStream), avoiding
// continuous ZMQ wakeups and V8 buffer allocations when no browser tab is open.

import {EventEmitter} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import zmq from 'zeromq'

import {rpcClient} from '../bitcoind/rpc-client.js'
import {bitcoind} from '../bitcoind/bitcoind.js'

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
	try {
		await delay(ms, undefined, {signal, ref: false})
		return true
	} catch {
		return false
	}
}

async function waitSynced(isCurrent: () => boolean, signal: AbortSignal, pollMs = 5_000): Promise<boolean> {
	while (isCurrent() && !signal.aborted) {
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
		if (!(await sleepAbortable(pollMs, signal))) return false
	}
	return false
}

async function waitMempoolLoaded(isCurrent: () => boolean, signal: AbortSignal, pollMs = 2_000): Promise<boolean> {
	while (isCurrent() && !signal.aborted) {
		try {
			const {loaded} = await rpcClient.command<{loaded: boolean}>('getmempoolinfo')
			if (loaded) return true
		} catch {
			// rpc not ready yet or bitcoind is down
		}
		if (!(await sleepAbortable(pollMs, signal))) return false
	}
	return false
}

export const transactionStream = new EventEmitter()

let currentSubscriber: zmq.Subscriber | null = null
let currentAbort: AbortController | null = null
let activeConsumers = 0
let generation = 0

async function startTransactionSubscriber(): Promise<void> {
	stopTransactionSubscriber()
	const gen = ++generation
	const ac = new AbortController()
	currentAbort = ac
	const isCurrent = () => gen === generation && activeConsumers > 0 && !ac.signal.aborted

	if (!(await waitSynced(isCurrent, ac.signal))) return
	if (!(await waitMempoolLoaded(isCurrent, ac.signal))) return
	if (!isCurrent()) return

	const sub = new zmq.Subscriber()
	currentSubscriber = sub
	try {
		sub.connect(`tcp://0.0.0.0:${process.env['ZMQ_HASHTX_PORT'] || '28336'}`)
		sub.subscribe('hashtx')

		for await (const msg of sub) {
			if (!isCurrent()) break
			void msg
			transactionStream.emit('hashtx')
		}
	} finally {
		if (!sub.closed) sub.close()
		if (currentSubscriber === sub) currentSubscriber = null
		if (currentAbort === ac) currentAbort = null
	}
}

export function stopTransactionSubscriber() {
	generation++
	currentAbort?.abort()
	currentAbort = null
	if (currentSubscriber) {
		console.log('[tx-subscriber] Stopping transaction subscriber')
		const sub = currentSubscriber
		currentSubscriber = null
		if (!sub.closed) sub.close()
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
