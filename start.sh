#!/bin/sh
# Scramjet launcher.
#
# Interactive:    ./start.sh
# Non-interactive: ./start.sh {mx|us|nl|rotate|none}
#
# Either way, picks an egress profile, writes WIREPROXY_SOCKS into .env,
# then brings up the docker-compose stack (Scramjet on :8080 + wireproxy
# sidecars on the internal egress network).

set -e

cd "$(dirname "$0")"

choice="$1"

if [ -z "$choice" ]; then
	echo "Pick egress:"
	echo "  1) mx     MX (peer1)"
	echo "  2) us     US (peer2)"
	echo "  3) nl     NL (peer3)"
	echo "  4) rotate Round-robin MX+US+NL"
	echo "  5) none   No VPN (host IP)"
	printf "Choice [1-5 or mx|us|nl|rotate|none]: "
	read -r choice
fi

case "$choice" in
	1|mx)     socks="wireproxy1:25344" ;;
	2|us)     socks="wireproxy2:25344" ;;
	3|nl)     socks="wireproxy3:25344" ;;
	4|rotate) socks="wireproxy1:25344,wireproxy2:25344,wireproxy3:25344" ;;
	5|none)   socks="" ;;
	*) echo "Invalid choice: $choice"; echo "Usage: $0 [mx|us|nl|rotate|none]"; exit 1 ;;
esac

{
	echo "WIREPROXY_SOCKS=$socks"

	# Neko egress: first SOCKS endpoint in the pool (or host if none).
	first_socks="${socks%%,*}"
	if [ -n "$first_socks" ]; then
		echo "NEKO_EGRESS_SOCKS=$first_socks"
	fi

	# Mint Cloudflare TURN ICE servers if a Turn Token is configured.
	if [ -n "$CF_TURN_TOKEN_ID" ] && [ -n "$CF_TURN_API_TOKEN" ]; then
		ice="$(CF_TURN_TOKEN_ID="$CF_TURN_TOKEN_ID" \
			CF_TURN_API_TOKEN="$CF_TURN_API_TOKEN" \
			CF_TURN_TTL="${CF_TURN_TTL:-86400}" \
			./scripts/mint-turn-creds.sh)"
		echo "NEKO_WEBRTC_ICESERVERS_FRONTEND=$ice"
		echo "NEKO_WEBRTC_ICESERVERS_BACKEND=$ice"
		echo "==> Minted Cloudflare TURN credentials for Neko" >&2
	else
		echo "==> WARNING: CF_TURN_TOKEN_ID/CF_TURN_API_TOKEN unset;" >&2
		echo "    Neko WebRTC will have no TURN relay and won't reach the device." >&2
	fi
} > .env

echo "==> Egress: ${socks:-host IP (no VPN)}"
echo "==> Scramjet on http://localhost:8080  |  Neko on http://localhost:8081"
echo "==> SECURITY: In the GitHub Ports panel, set BOTH 8080 and 8081 to"
echo "    'Private' visibility. The remote browser has no login."

docker compose down
docker compose up --build
