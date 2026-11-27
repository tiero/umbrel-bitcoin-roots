import type {ConnectionDetails} from '#types'
import {readFile} from 'node:fs/promises'

// Read on every request: Tor creates these files asynchronously on first boot.
async function onionHost(kind: 'P2P' | 'RPC'): Promise<string> {
	const file = process.env[`${kind}_HIDDEN_SERVICE_FILE`]
	if (file) {
		try {
			const hostname = (await readFile(file, 'utf8')).trim()
			if (/^[a-z2-7]{56}\.onion$/.test(hostname)) return hostname
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
		return 'notyetset.onion'
	}
	return process.env[`${kind}_HIDDEN_SERVICE`] ?? 'notyetset.onion'
}

export async function getConnectionDetails(): Promise<ConnectionDetails> {
	// P2P
	const p2pPort = process.env['P2P_PORT'] ?? '8333'
	const p2pTorHost = await onionHost('P2P')
	const p2pLocalHost = process.env['DEVICE_DOMAIN_NAME'] ?? '127.0.0.1'

	// RPC
	const label = 'Umbrel Bitcoin Node'
	const rpcPort = process.env['RPC_PORT'] ?? '8332'
	const rpcUser = process.env['RPC_USER'] ?? 'umbrel'
	const rpcPassword = process.env['RPC_PASS'] ?? ''
	const rpcTorHost = await onionHost('RPC')
	const rpcLocalHost = process.env['DEVICE_DOMAIN_NAME'] ?? '127.0.0.1'

	return {
		p2p: {
			tor: {
				host: p2pTorHost,
				port: p2pPort,
				uri: `${p2pTorHost}:${p2pPort}`,
			},
			local: {
				host: p2pLocalHost,
				port: p2pPort,
				uri: `${p2pLocalHost}:${p2pPort}`,
			},
		},

		rpc: {
			tor: {
				host: rpcTorHost,
				port: rpcPort,
				username: rpcUser,
				password: rpcPassword,
				uri: `btcrpc://${rpcUser}:${rpcPassword}@${rpcTorHost}:${rpcPort}?label=${encodeURIComponent(label)}`,
			},
			local: {
				host: rpcLocalHost,
				port: rpcPort,
				username: rpcUser,
				password: rpcPassword,
				uri: `btcrpc://${rpcUser}:${rpcPassword}@${rpcLocalHost}:${rpcPort}?label=${encodeURIComponent(label)}`,
			},
		},
	}
}
