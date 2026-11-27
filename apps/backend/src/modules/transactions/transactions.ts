import type WebSocket from 'ws'
import {acquireTransactionStream, releaseTransactionStream, transactionStream} from './zmq-subscriber.js'

// Throttle strategy: we queue every tx immediately, but emit at most
// one WebSocket frame every 33 ms (~30 transactions per second). That frame includes
// `count`, telling the UI how many transactions arrived in the slice,
// so bursts can be represented faithfully while network & render load
// stay capped at ≤30 messages per second.
const MIN_INTERVAL_MS = 33

// Track connected clients
const clients = new Set<WebSocket>()

function broadcastPing(count: number) {
	const msg = JSON.stringify({type: 'txPing', count})
	for (const ws of clients) {
		if (ws.readyState === ws.OPEN) ws.send(msg)
	}
}

// queued txs waiting to be sent
let pending = 0
let lastPingMs = 0

// Increment the queue for every tx; no throttling here.
transactionStream.on('hashtx', () => {
	if (clients.size === 0) return
	pending += 1

	const now = Date.now()
	if (now - lastPingMs >= MIN_INTERVAL_MS) {
		broadcastPing(pending)
		pending = 0
		lastPingMs = now
	}
})

// WebSocket push for new clients
export function wsStream(socket: WebSocket) {
	clients.add(socket)
	acquireTransactionStream()
	let released = false
	const cleanup = () => {
		if (released) return
		released = true
		clients.delete(socket)
		if (clients.size === 0) pending = 0
		releaseTransactionStream()
	}
	socket.on('close', cleanup)
	socket.on('error', cleanup)
}
