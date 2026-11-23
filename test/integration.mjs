// Runs the actual Umbrel package with an isolated regtest datadir and network.
// No public Tor bootstrap, blockchain download, or registry write is required.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, mkdir, writeFile, cp, chmod, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

const directory = await mkdtemp(path.join(tmpdir(), 'roots-integration-'))
const subnetPrefix = process.env.E2E_SUBNET_PREFIX ?? ['10', '21'].join('.')
const dockerBin = process.env.DOCKER_BIN ?? '/usr/bin/docker'
const env = {
	...process.env,
	APP_DATA_DIR: directory,
	NETWORK_IP: `${subnetPrefix}.0.0`,
	APP_BITCOIN_ROOTS_NODE_IP: `${subnetPrefix}.120.8`,
	APP_BITCOIN_ROOTS_TOR_IP: `${subnetPrefix}.120.9`,
	APP_BITCOIN_ROOTS_I2P_IP: `${subnetPrefix}.120.10`,
	APP_BITCOIN_ROOTS_RPC_USER: 'umbrel',
	APP_BITCOIN_ROOTS_RPC_PASS: 'integrationrpcpassword',
	APP_BITCOIN_ROOTS_TOR_PASSWORD: 'integrationtorpassword',
	DEVICE_DOMAIN_NAME: 'localhost',
}
const override = path.join(directory, 'compose.yml')
const args = [
	'compose',
	'-p',
	`roots-test-${process.pid}`,
	'-f',
	'umbrel/bitcoin-roots/docker-compose.yml',
	'-f',
	override,
]
function compose(...command) {
	return execFileSync(dockerBin, [...args, ...command], {
		env,
		encoding: 'utf8',
		timeout: 180_000,
		maxBuffer: 8 * 1024 * 1024,
	})
}
const node = (code) => compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', code)
// The Umbrel package keeps RPC on 8332 even when the test selects regtest.
const rpc = (method) =>
	JSON.parse(compose('exec', '-T', 'app', 'bitcoin-cli', '-datadir=/data/bitcoin', '-regtest', '-rpcport=8332', method))

async function until(check) {
	let failure
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			return await check()
		} catch (error) {
			failure = error
		}
		await delay(2000)
	}
	throw failure
}

try {
	await chmod(directory, 0o755)
	await mkdir(path.join(directory, 'data'), {mode: 0o777})
	await chmod(path.join(directory, 'data'), 0o777)
	await cp('umbrel/bitcoin-roots/hooks', path.join(directory, 'hooks'), {recursive: true})
	await writeFile(
		override,
		`services:
  app_proxy:
    image: busybox:1.37
  app:
    image: ${process.env.ROOTS_IMAGE || 'umbrel-bitcoin-roots:prod'}
    ports: !reset []
    environment:
      DEFAULT_CHAIN: regtest
networks:
  default:
    ipam:
      config:
        - subnet: 10.21.0.0/16
`,
	)
	compose('config', '--quiet')
	compose('up', '-d', 'app')
	await until(() => assert.equal(rpc('getblockchaininfo').chain, 'regtest'))
	const network = rpc('getnetworkinfo')
	const onion = network.networks.find((entry) => entry.name === 'onion')
	assert.equal(onion.proxy, '10.21.120.9:9050')
	assert.equal(onion.reachable, true)
	// Exercise the SOCKS protocol and authenticated control protocol from the app.
	node(`
import net from 'node:net';
import assert from 'node:assert/strict';
async function exchange(port, request, expected) {
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, process.env.TOR_HOST, () => socket.write(request));
    let response = Buffer.alloc(0);
    socket.setTimeout(5000, () => socket.destroy(new Error('Tor timeout')));
    socket.on('error', reject);
    socket.on('data', chunk => {
      response = Buffer.concat([response, chunk]);
      if (response.length < expected.length) return;
      socket.destroy();
      try { assert.deepEqual(response.subarray(0, expected.length), expected); resolve(); }
      catch (error) { reject(error); }
    });
  });
}
await exchange(9050, Buffer.from([5,1,0]), Buffer.from([5,0]));
await exchange(9051, 'AUTHENTICATE "' + process.env.TOR_CONTROL_PASSWORD + '"\\r\\n', Buffer.from('250 OK'));
`)
	const details = () =>
		JSON.parse(
			node(
				`const r = await fetch('http://127.0.0.1:3000/api/connect/details'); if (!r.ok) throw new Error('HTTP ' + r.status); console.log(JSON.stringify(await r.json()));`,
			),
		)
	const first = await until(() => {
		const result = details()
		assert.match(result.p2p.tor.host, /^[a-z2-7]{56}\.onion$/)
		assert.match(result.rpc.tor.host, /^[a-z2-7]{56}\.onion$/)
		return result
	})
	// Use the real settings API to enable incoming Tor and proxy clearnet traffic.
	node(`const r = await fetch('http://127.0.0.1:3000/api/config/settings', {
  method: 'PATCH', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({listen: ['tor'], proxy: true})
}); if (!r.ok) throw new Error('Settings HTTP ' + r.status);`)
	await until(() => {
		const updated = rpc('getnetworkinfo')
		assert.equal(updated.networks.find((entry) => entry.name === 'ipv4').proxy, '10.21.120.9:9050')
	})
	node(`import {readFileSync} from 'node:fs'; import assert from 'node:assert/strict';
const conf = readFileSync('/data/bitcoin/umbrel-bitcoin.conf', 'utf8');
assert.ok(conf.includes('torcontrol=10.21.120.9:9051'));
assert.ok(conf.includes('listenonion=1'));`)
	compose('restart', 'tor')
	await until(() =>
		assert.equal(compose('exec', '-T', 'tor', 'cat', '/data/tor/p2p/hostname').trim(), first.p2p.tor.host),
	)
	assert.equal(details().rpc.tor.host, first.rpc.tor.host)
	console.log(
		'PASS: Roots regtest RPC, Tor proxy, SOCKS handshake, control authentication, settings restart, onion discovery and persistence',
	)
} catch (error) {
	try {
		console.error(compose('logs', '--no-color', '--tail', '100'))
	} catch {}
	throw error
} finally {
	try {
		compose('down', '--volumes', '--remove-orphans', '--timeout', '30')
	} finally {
		await rm(directory, {recursive: true, force: true}).catch(() => {})
	}
}
