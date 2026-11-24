import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {test} from 'node:test'

test('Umbrel exports derive stable, distinct secrets without changing caller shell options', () => {
	const script = `
set -euo pipefail
derive_entropy() { printf '%s' "$1" | sha256sum | cut -d ' ' -f 1; }
app_entropy_identifier=app-bitcoin-roots-seed
before=$-
source umbrel/bitcoin-roots/exports.sh
[[ "$before" == "$-" ]]
first=$APP_BITCOIN_ROOTS_RPC_PASS
[[ "$first" != "$APP_BITCOIN_ROOTS_TOR_PASSWORD" ]]
source umbrel/bitcoin-roots/exports.sh
[[ "$first" == "$APP_BITCOIN_ROOTS_RPC_PASS" ]]
printf '%s' "$first"
`
	assert.match(execFileSync('bash', ['-c', script], {encoding: 'utf8'}), /^[a-f0-9]{64}$/)
})

test('Umbrel exports match canonical APP_BITCOIN_* contract and derive identical RPC credentials for dependents', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'roots-exports-'))
	try {
		await mkdir(path.join(directory, 'app'), {recursive: true})
		await mkdir(path.join(directory, 'tor', 'p2p'), {recursive: true})
		await mkdir(path.join(directory, 'tor', 'rpc'), {recursive: true})
		await writeFile(path.join(directory, 'app', 'settings.json'), JSON.stringify({chain: 'regtest', ipc: true}))
		await writeFile(path.join(directory, 'tor', 'p2p', 'hostname'), 'p2pexampleonionaddress1234567890abcdefghijklmnopqrstuvwx.onion\n')
		await writeFile(path.join(directory, 'tor', 'rpc', 'hostname'), 'rpcexampleonionaddress1234567890abcdefghijklmnopqrstuvwx.onion\n')

		const runExports = (callerEntropyId) => {
			const script = `
set -euo pipefail
derive_entropy() { printf '%s' "$1" | sha256sum | cut -d ' ' -f 1; }
export EXPORTS_APP_ID=bitcoin-roots
export EXPORTS_APP_DATA_DIR=${JSON.stringify(directory)}
export app_entropy_identifier=${JSON.stringify(callerEntropyId)}
source umbrel/bitcoin-roots/exports.sh
node -e 'console.log(JSON.stringify({
	nodeIp: process.env.APP_BITCOIN_NODE_IP,
	torIp: process.env.APP_BITCOIN_TOR_PROXY_IP,
	i2pIp: process.env.APP_BITCOIN_I2P_DAEMON_IP,
	dataDir: process.env.APP_BITCOIN_DATA_DIR,
	rpcPort: process.env.APP_BITCOIN_RPC_PORT,
	p2pPort: process.env.APP_BITCOIN_P2P_PORT,
	whitebindPort: process.env.APP_BITCOIN_P2P_WHITEBIND_PORT,
	torPort: process.env.APP_BITCOIN_TOR_PORT,
	zmqRawBlock: process.env.APP_BITCOIN_ZMQ_RAWBLOCK_PORT,
	zmqRawTx: process.env.APP_BITCOIN_ZMQ_RAWTX_PORT,
	zmqHashBlock: process.env.APP_BITCOIN_ZMQ_HASHBLOCK_PORT,
	zmqSequence: process.env.APP_BITCOIN_ZMQ_SEQUENCE_PORT,
	zmqHashTx: process.env.APP_BITCOIN_ZMQ_HASHTX_PORT,
	network: process.env.APP_BITCOIN_NETWORK,
	networkElectrs: process.env.APP_BITCOIN_NETWORK_ELECTRS,
	ipcEnabled: process.env.APP_BITCOIN_IPC_ENABLED,
	ipcSocket: process.env.APP_BITCOIN_IPC_SOCKET_RELATIVE_PATH,
	rpcUser: process.env.APP_BITCOIN_RPC_USER,
	rpcPass: process.env.APP_BITCOIN_RPC_PASS,
	rootsRpcPass: process.env.APP_BITCOIN_ROOTS_RPC_PASS,
	rpcOnion: process.env.APP_BITCOIN_RPC_HIDDEN_SERVICE,
	p2pOnion: process.env.APP_BITCOIN_P2P_HIDDEN_SERVICE,
}))'
`
			return JSON.parse(execFileSync('bash', ['-c', script], {encoding: 'utf8'}))
		}

		const selfEnv = runExports('app-bitcoin-roots-seed')
		const clnEnv = runExports('app-core-lightning-seed')

		assert.deepEqual(clnEnv, selfEnv)
		assert.equal(clnEnv.nodeIp, '10.21.120.8')
		assert.equal(clnEnv.torIp, '10.21.120.9')
		assert.equal(clnEnv.i2pIp, '10.21.120.10')
		assert.equal(clnEnv.dataDir, path.join(directory, 'bitcoin'))
		assert.equal(clnEnv.rpcPort, '8332')
		assert.equal(clnEnv.p2pPort, '8333')
		assert.equal(clnEnv.whitebindPort, '8335')
		assert.equal(clnEnv.torPort, '8334')
		assert.equal(clnEnv.zmqRawBlock, '28332')
		assert.equal(clnEnv.zmqRawTx, '28333')
		assert.equal(clnEnv.zmqHashBlock, '28334')
		assert.equal(clnEnv.zmqSequence, '28335')
		assert.equal(clnEnv.zmqHashTx, '28336')
		assert.equal(clnEnv.network, 'regtest')
		assert.equal(clnEnv.networkElectrs, 'regtest')
		assert.equal(clnEnv.ipcEnabled, 'true')
		assert.equal(clnEnv.ipcSocket, 'regtest/node.sock')
		assert.equal(clnEnv.rpcUser, 'umbrel')
		assert.equal(clnEnv.rpcPass, clnEnv.rootsRpcPass)
		assert.equal(clnEnv.rpcOnion, 'rpcexampleonionaddress1234567890abcdefghijklmnopqrstuvwx.onion')
		assert.equal(clnEnv.p2pOnion, 'p2pexampleonionaddress1234567890abcdefghijklmnopqrstuvwx.onion')
	} finally {
		await rm(directory, {recursive: true, force: true})
	}
})
