const url = `http://${process.env['BITCOIND_IP'] || '127.0.0.1'}:${process.env['RPC_PORT'] || '8332'}/`
const auth = `Basic ${Buffer.from(
	`${process.env['RPC_USER'] || 'umbrel'}:${process.env['RPC_PASS'] || 'moneyprintergobrrr'}`,
).toString('base64')}`

let nextId = 0

type CacheEntry = {value: unknown; expiresAt: number}
const MAX_RPC_CACHE_ENTRIES = 64
const rpcCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<unknown>>()

export function clearRpcCache() {
	rpcCache.clear()
}

export const rpcClient = {
	async command<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
		const res = await fetch(url, {
			method: 'POST',
			headers: {'Content-Type': 'application/json', Authorization: auth},
			body: JSON.stringify({method, params, id: nextId++}),
			signal: AbortSignal.timeout(30_000),
		})

		// Auth failures return non-JSON (text/html 401). Consume body to free connection.
		if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
			const text = await res.text()
			throw new Error(`RPC ${method}: HTTP ${res.status} ${text}`.trim())
		}

		// V1_LEGACY: RPC errors return non-200 but still have a JSON body, so we
		// intentionally don't gate on res.ok here — just parse and check error.
		let json: {result: T; error: {code: number; message: string} | null}
		try {
			json = await res.json()
		} catch {
			throw new Error(`RPC ${method}: invalid JSON response (HTTP ${res.status})`)
		}

		if (json.error) {
			throw new Error(`RPC ${method}: ${json.error.message} (code ${json.error.code})`)
		}

		return json.result
	},

	// Short-TTL cache with in-flight deduplication for frequently polled read-only RPCs
	// (widgets, dashboard stats, peer counts/locations) to avoid redundant bitcoind calls.
	cachedCommand<T = unknown>(ttlMs: number, method: string, ...params: unknown[]): Promise<T> {
		const key = params.length === 0 ? method : `${method}:${JSON.stringify(params)}`
		const now = Date.now()
		const hit = rpcCache.get(key)
		if (hit) {
			if (hit.expiresAt > now) return Promise.resolve(hit.value as T)
			rpcCache.delete(key)
		}

		const pending = inFlight.get(key)
		if (pending) return pending as Promise<T>

		const req = this.command<T>(method, ...params)
			.then((value) => {
				if (rpcCache.size >= MAX_RPC_CACHE_ENTRIES) {
					const oldest = rpcCache.keys().next().value
					if (oldest !== undefined) rpcCache.delete(oldest)
				}
				rpcCache.set(key, {value, expiresAt: Date.now() + ttlMs})
				return value
			})
			.finally(() => {
				inFlight.delete(key)
			})

		inFlight.set(key, req)
		return req
	},
}
