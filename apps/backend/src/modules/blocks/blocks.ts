// Block cache and data pipeline.
//
// A single in-memory cache of up to 200 Block objects serves all consumers
// (REST endpoint, WebSocket, insights charts, home page 3D blocks).
//
// Two fetch strategies populate the same cache:
//   - getblockstats (lightweight) — used during prime for bulk loading 200 blocks.
//     Returns precomputed stats (fees, size, weight, fee percentiles) without full
//     transaction data. These blocks have transactionGrid: [].
//   - getblock verbosity 2 (heavy) — used for ZMQ new-block events (1 at a time)
//     and cache misses from the home page (needs transactionGrid for cube faces).
//
// Cache population strategy:
//   Synced:    ZMQ hashblock events → fetch by hash (verbosity 2) → cache + broadcast.
//              Frontend receives real-time updates via a single global WebSocket.
//   IBD:      ZMQ is silent (Core suppresses notifications during IBD). Frontend does not
//              fetch blocks during IBD (home page shows sync progress via useSyncStatus).
//   Catch-up: ZMQ fires rapidly while blocks < headers. We skip these events. Once
//              blocks === headers, normal ZMQ handling resumes.
//
// On startup/restart we prime the cache (5 blocks if not synced, 200 if synced).
// The first ZMQ event that sees blocks === headers triggers a background 200-block
// prime so the insights page data is ready.
// On bitcoind stop (e.g. network switch), the cache is cleared to avoid serving
// stale blocks from the old chain.

import {setTimeout} from 'timers/promises'
import {EventEmitter} from 'node:events'

import type WebSocket from 'ws'
import PQueue from 'p-queue'

import {rpcClient} from '../bitcoind/rpc-client.js'
import {bitcoind} from '../bitcoind/bitcoind.js'
import {blockStream} from './zmq-subscriber.js'

import type {Block, RawBlock, RawTransaction} from '#types'

const rpcQueue = new PQueue({concurrency: 10})
// Heavy `getblock <hash> 2` calls decode 15-35 MB JSON (~50-120 MB V8 heap each); serialize them
// so concurrent home-page requests cannot spike past the 192 MB Node heap cap.
const fullBlockQueue = new PQueue({concurrency: 1})

// --- Pure helpers ---

function computeSubsidy(height: number): number {
	const halvings = Math.floor(height / 210_000)
	if (halvings >= 64) return 0
	return Math.floor(50e8 / 2 ** halvings)
}

function computeFeeRatePercentiles(txs: RawTransaction[]): {p10: number; p50: number; p90: number} {
	const feeRates = txs
		.filter((tx) => tx.fee != null)
		.map((tx) => Math.round((tx.fee! * 1e8) / tx.vsize))
		.sort((a, b) => a - b)

	if (feeRates.length === 0) return {p10: 0, p50: 0, p90: 0}

	const pick = (p: number) => feeRates[Math.min(Math.floor((p / 100) * feeRates.length), feeRates.length - 1)]
	return {p10: pick(10), p50: pick(50), p90: pick(90)}
}

function transactionGrid(transactions: RawTransaction[], gridSize: number) {
	const TOTAL_BLOCK_SIZE = 4_000_000

	const squareSizes = Array.from({length: gridSize}, (_, i) => i + 1).map((size) => ({
		size,
		totalWeight: 0,
		numberOfBlocks: 0,
	}))

	for (const transaction of transactions) {
		const txPercentageOfBlock = transaction.weight / TOTAL_BLOCK_SIZE
		for (const chunk of squareSizes) {
			const chunkPercentageOfGrid = Math.pow(chunk.size / gridSize, 2)
			if (txPercentageOfBlock < chunkPercentageOfGrid) {
				chunk.totalWeight += transaction.weight
				break
			}
		}
	}

	for (const chunk of squareSizes) {
		const chunkPercentageOfGrid = Math.pow(chunk.size / gridSize, 2)
		const chunkPercentageOfBlock = chunk.totalWeight / TOTAL_BLOCK_SIZE
		const numberOfBlocks = Math.round(chunkPercentageOfBlock / chunkPercentageOfGrid)
		chunk.numberOfBlocks = numberOfBlocks
	}

	return squareSizes
		.filter((chunk) => chunk.numberOfBlocks > 0)
		.map(({size, numberOfBlocks}) => ({size, numberOfBlocks}))
}

// --- Block constructors ---

// Partial type of bitcoind's getblockstats RPC
type BlockStats = {
	height: number
	time: number
	blockhash: string
	total_size: number
	total_weight: number
	txs: number
	subsidy: number
	totalfee: number
	feerate_percentiles: [number, number, number, number, number]
}

// Lightweight: from getblockstats (no full tx data, no transactionGrid)
function statsToBlock(stats: BlockStats): Block {
	const [p10, , p50, , p90] = stats.feerate_percentiles
	return {
		hash: stats.blockhash,
		height: stats.height,
		time: stats.time,
		size: stats.total_size,
		weight: stats.total_weight,
		txCount: stats.txs,
		subsidySat: stats.subsidy,
		feesSat: stats.totalfee,
		feeRates: {p10, p50, p90},
		transactionGrid: [],
	}
}

// Full: from getblock verbosity 2 (includes transactionGrid for cube faces)
function rawToBlock(raw: RawBlock): Block {
	const feesSat = Math.round(raw.tx.reduce((sum: number, tx) => sum + (tx.fee ?? 0), 0) * 1e8)

	return {
		hash: raw.hash,
		height: raw.height,
		time: raw.time,
		size: raw.size,
		weight: raw.weight,
		txCount: raw.nTx,
		subsidySat: computeSubsidy(raw.height),
		feesSat,
		feeRates: computeFeeRatePercentiles(raw.tx),
		transactionGrid: transactionGrid(raw.tx, 20),
	}
}

// --- Single unified cache ---

export const MAX_BLOCKS_LIMIT = 200
const CACHE_DEPTH = MAX_BLOCKS_LIMIT
const blockCache = new Map<number, Block>()
// Tracks heights fetched via verbosity-2 `getblock` so empty/coinbase-only blocks
// (whose transactionGrid is legitimately []) still hit cache instead of re-fetching forever.
const fullBlockHeights = new Set<number>()
const inFlightBlocks = new Map<string, Promise<Block>>()

function evictOldEntries() {
	if (blockCache.size <= CACHE_DEPTH) return
	const sortedKeys = Array.from(blockCache.keys()).sort((a, b) => a - b)
	const keysToDelete = sortedKeys.slice(0, blockCache.size - CACHE_DEPTH)
	keysToDelete.forEach((key) => {
		blockCache.delete(key)
		fullBlockHeights.delete(key)
	})
}

// Lightweight fetch via getblockstats — used for bulk priming.
// Does NOT overwrite a full block (with transactionGrid) if one is already cached.
function getBlockLight(height: number): Promise<Block> {
	const cached = blockCache.get(height)
	if (cached) return Promise.resolve(cached)

	const key = `light:${height}`
	const existing = inFlightBlocks.get(key)
	if (existing) return existing

	const req = rpcQueue
		.add(async () => {
			const again = blockCache.get(height)
			if (again) return again
			const stats = await rpcClient.command<BlockStats>('getblockstats', height)
			const block = statsToBlock(stats)
			if (!fullBlockHeights.has(height)) {
				blockCache.set(height, block)
				evictOldEntries()
			}
			return blockCache.get(height) ?? block
		})
		.finally(() => {
			inFlightBlocks.delete(key)
		}) as Promise<Block>

	inFlightBlocks.set(key, req)
	return req
}

// Full fetch via getblock verbosity 2 — used for ZMQ events and home page blocks.
// Always overwrites the cache entry (upgrades light → full).
function getBlockFull(height: number): Promise<Block> {
	const cached = blockCache.get(height)
	if (cached && fullBlockHeights.has(height)) return Promise.resolve(cached)

	const key = `full:${height}`
	const existing = inFlightBlocks.get(key)
	if (existing) return existing

	const req = fullBlockQueue
		.add(async () => {
			const again = blockCache.get(height)
			if (again && fullBlockHeights.has(height)) return again
			console.log(`[blocks] fetching full block ${height}`)
			const blockHash = await rpcClient.command<string>('getblockhash', height)
			const raw = await rpcClient.command<RawBlock>('getblock', blockHash, 2)
			const block = rawToBlock(raw)

			blockCache.set(height, block)
			fullBlockHeights.add(height)
			evictOldEntries()

			return block
		})
		.finally(() => {
			inFlightBlocks.delete(key)
		}) as Promise<Block>

	inFlightBlocks.set(key, req)
	return req
}

// --- Frontend-facing reads ---

export async function list(limit = 200): Promise<Block[]> {
	const tipHeight = await rpcClient.command<number>('getblockcount')
	const count = Math.min(limit, MAX_BLOCKS_LIMIT, tipHeight + 1)

	// Use lightweight fetch for bulk reads (insights charts).
	// Home page requests (limit ≤ 5) use full fetch for transactionGrid.
	const fetchFn = limit <= 5 ? getBlockFull : getBlockLight

	const blocks = await Promise.all(Array.from({length: count}, (_, i) => fetchFn(tipHeight - i)))

	// Return in chronological order (oldest first)
	return blocks.reverse()
}

// --- ZMQ-driven cache updates ---

const newBlockEmitter = new EventEmitter()

let processing = false

// Bitcoin Core's ZMQ block notifiers are silent during IBD, so this only fires
// when IBD is complete. During post-IBD catch-up (blocks < headers), we skip
// until the node reaches the tip. When UI clients are connected, fetch verbosity 2
// for the cube transactionGrid; when idle (no UI open), use lightweight getblockstats
// (~1 KB instead of multi-MB decoded block JSON) to avoid V8 heap spikes.
blockStream.on('block', async (hash: string) => {
	if (processing) return
	processing = true
	try {
		const {blocks, headers} = await rpcClient.command<{blocks: number; headers: number}>('getblockchaininfo')
		if (blocks !== headers) return // still catching up, skip

		const hasListeners = newBlockEmitter.listenerCount('block') > 0
		const block = hasListeners
			? rawToBlock(await rpcClient.command<RawBlock>('getblock', hash, 2))
			: statsToBlock(await rpcClient.command<BlockStats>('getblockstats', hash))
		blockCache.set(block.height, block)
		if (hasListeners) fullBlockHeights.add(block.height)
		evictOldEntries()

		if (hasListeners) {
			newBlockEmitter.emit('block', block)
		}
	} catch (err) {
		console.error('[blocks] ZMQ handler error:', err)
	} finally {
		processing = false
	}
})

// --- WebSocket (subscribes to processed blocks, no RPC calls) ---

export function wsStream(socket: WebSocket) {
	const send = (block: Block) => {
		try {
			socket.send(JSON.stringify(block))
		} catch {
			// Socket may have closed between emit and send
		}
	}
	newBlockEmitter.on('block', send)
	socket.on('close', () => newBlockEmitter.off('block', send))
}

// --- Cache prime ---
// Prime only the 5 most recent blocks via lightweight getblockstats at startup.
// Larger ranges (e.g. 200 blocks for Insights charts) and full transactionGrids are
// populated on demand when the user opens the UI, keeping idle RAM minimal.

let primeGen = 0
let primeAbort: AbortController | null = null

async function prime() {
	const gen = ++primeGen
	primeAbort?.abort()
	const ac = new AbortController()
	primeAbort = ac
	try {
		await setTimeout(5000, undefined, {signal: ac.signal, ref: false}) // wait for bitcoind to be ready
		if (gen !== primeGen) return
		const tipHeight = await rpcClient.command<number>('getblockcount')
		if (gen !== primeGen) return
		const count = Math.min(5, tipHeight + 1)
		await Promise.all(Array.from({length: count}, (_, i) => getBlockLight(tipHeight - i)))
	} catch (err) {
		if ((err as {name?: string})?.name !== 'AbortError') throw err
	} finally {
		if (primeAbort === ac) primeAbort = null
	}
}

function reset() {
	primeGen++
	primeAbort?.abort()
	primeAbort = null
	rpcQueue.clear()
	fullBlockQueue.clear()
	inFlightBlocks.clear()
	blockCache.clear()
	fullBlockHeights.clear()
	processing = false
}

// --- Bitcoind lifecycle ---
// When bitcoind restarts (e.g. user switches network), the in-memory cache
// would serve stale blocks from the old chain. Clear it on stop/exit, re-prime on start.

bitcoind.events.on('stop', () => {
	console.log('[blocks] bitcoind stopped, clearing cache')
	reset()
})

bitcoind.events.on('exit', () => {
	reset()
})

bitcoind.events.on('start', () => {
	console.log('[blocks] bitcoind started, priming cache')
	prime().catch((err) => console.error('[blocks] prime error:', err))
})

if (bitcoind.status().running) {
	prime().catch((err) => console.error('[blocks] init error:', err))
}
