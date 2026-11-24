#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${TOR_CONTROL_PASSWORD:?Tor control password is required}"
: "${BITCOIND_IP:?Bitcoin address is required}"
RPC_PORT="${RPC_PORT:-8332}"
[[ "$TOR_CONTROL_PASSWORD" =~ ^[a-zA-Z0-9]+$ ]] || exit 1
[[ "$BITCOIND_IP" =~ ^[0-9.]+$ ]] || exit 1
[[ "$RPC_PORT" =~ ^[0-9]+$ ]] || exit 1

mkdir -p /data/tor
chmod 700 /data/tor
hash=$(tor --hash-password "$TOR_CONTROL_PASSWORD" | tail -n 1)
[[ "$hash" == 16:* ]] || exit 1
cat > /tmp/roots-torrc <<EOF
DataDirectory /data/tor
SocksPort 0.0.0.0:9050
ControlPort 0.0.0.0:9051
CookieAuthentication 0
HashedControlPassword $hash
Log notice stdout
HiddenServiceDir /data/tor/p2p
HiddenServicePort 8333 $BITCOIND_IP:8334
HiddenServiceDir /data/tor/rpc
HiddenServicePort 8332 $BITCOIND_IP:$RPC_PORT
EOF
exec tor -f /tmp/roots-torrc
