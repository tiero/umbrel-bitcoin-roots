import path from 'node:path'
import {fileURLToPath} from 'node:url'
import Fastify from 'fastify'
import fastifyWs from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import helmet from '@fastify/helmet'

import {bootBitcoind, bitcoind} from './modules/bitcoind/bitcoind.js'
import {clearRpcCache} from './modules/bitcoind/rpc-client.js'
import {stopBlockSubscriber} from './modules/blocks/zmq-subscriber.js'
import {closeGeoTables} from './modules/peers/ip-to-location.js'
import {stopTransactionSubscriber} from './modules/transactions/zmq-subscriber.js'
import {ensureDirs} from './lib/paths.js'
import routes from './routes.js'

bitcoind.events.on('stop', clearRpcCache)
bitcoind.events.on('exit', clearRpcCache)

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Ensure that the required data directories exist before we start
await ensureDirs()

// Start bitcoind without blocking server start
bootBitcoind().catch((error) => {
	bitcoind.setLastError(error as Error) // record for /status
	app.log.error(error, 'Bitcoind bootstrap failed.')
})

// Create the HTTP server and register the routes
// Disable per-request access logging in production to avoid writing ~25k widget poll log lines/day.
const app = Fastify({
	logger: true,
	disableRequestLogging: process.env['NODE_ENV'] === 'production',
})

// CSP
await app.register(helmet, {
	contentSecurityPolicy: {
		// We keep Helmet’s defaults and only add what's missing
		directives: {
			// Upgrade-insecure-requests is ignored on HTTP, so we omit it entirely
			upgradeInsecureRequests: null,
		},
	},
})

// No connection cap: these receive-only streams serve a single-user app behind Umbrel's trust boundary.
// Revisit if the backend becomes directly exposed or multi-tenant.
await app.register(fastifyWs)

// Detect dead WebSocket connections. Without this, a client whose network
// drops silently (no close frame) leaves a phantom connection that leaks
// listeners forever — especially on the /ws/bitcoind/exit endpoint which
// rarely sends data and would never trigger TCP failure detection.
const HEARTBEAT_MS = 30_000
const aliveClients = new WeakSet<import('ws').WebSocket>()

app.websocketServer.on('connection', (ws) => {
	aliveClients.add(ws)
	ws.on('pong', () => aliveClients.add(ws))
})

const heartbeat = setInterval(() => {
	for (const ws of app.websocketServer.clients) {
		if (!aliveClients.has(ws)) {
			ws.terminate()
			continue
		}
		aliveClients.delete(ws)
		ws.ping()
	}
}, HEARTBEAT_MS)
heartbeat.unref()
app.addHook('onClose', async () => {
	clearInterval(heartbeat)
})

// Serve pre-compressed (.br / .gz) UI static files with aggressive caching for hashed Vite assets
app.register(fastifyStatic, {
	root: path.join(__dirname, 'public'),
	wildcard: false, // do not serve index.html for all routes
	preCompressed: true,
	setHeaders(reply, filePath) {
		if (filePath.includes(`${path.sep}assets${path.sep}`)) {
			reply.header('Cache-Control', 'public, max-age=31536000, immutable')
		} else {
			reply.header('Cache-Control', 'no-cache')
		}
	},
})

await app.register(routes)

// SPA fallback is last to serve the UI routes
app.get('/*', (_, reply) => reply.sendFile('index.html'))

// Start the server
app
	.listen({port: 3000, host: '0.0.0.0'})
	.then((address) => app.log.info(`₿itcoin Node backend is running at ${address}`))
	.catch((error) => {
		app.log.error(`Failed to start server: ${error}`)
		process.exit(1)
	})

// Log unhandled rejections
process.on('unhandledRejection', (reason) => app.log.error({reason}, 'Unhandled rejection'))

// Graceful, idempotent shutdown of HTTP/WS server, ZMQ sockets, GeoIP FDs, and bitcoind
let shuttingDown = false
const shutdown = async () => {
	if (shuttingDown) return
	shuttingDown = true
	clearInterval(heartbeat)
	let exitCode = 0
	try {
		await app.close().catch((err) => app.log.error({err}, 'Failed to close HTTP server'))
		stopBlockSubscriber()
		stopTransactionSubscriber()
		closeGeoTables()
		clearRpcCache()
		await bitcoind.stop()
	} catch (err) {
		app.log.error({err}, 'Error during shutdown')
		exitCode = 1
	} finally {
		process.exit(exitCode)
	}
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
