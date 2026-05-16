#!/bin/sh
# Scramjet launcher.
#
# Interactive:    ./start.sh
# Non-interactive: ./start.sh {jp|us|nl|rotate|none}
#
# Either way, picks an egress profile, writes WIREPROXY_SOCKS into .env,
# then brings up the docker-compose stack (Scramjet on :8080 + wireproxy
# sidecars on the internal egress network).

set -e

cd "$(dirname "$0")"

choice="$1"

if [ -z "$choice" ]; then
	echo "Pick egress:"
	echo "  1) jp     JP (peer1)"
	echo "  2) us     US (peer2)"
	echo "  3) nl     NL (peer3)"
	echo "  4) rotate Round-robin JP+US+NL"
	echo "  5) none   No VPN (host IP)"
	printf "Choice [1-5 or jp|us|nl|rotate|none]: "
	read -r choice
fi

case "$choice" in
	1|jp)     socks="wireproxy1:25344" ;;
	2|us)     socks="wireproxy2:25344" ;;
	3|nl)     socks="wireproxy3:25344" ;;
	4|rotate) socks="wireproxy1:25344,wireproxy2:25344,wireproxy3:25344" ;;
	5|none)   socks="" ;;
	*) echo "Invalid choice: $choice"; echo "Usage: $0 [jp|us|nl|rotate|none]"; exit 1 ;;
esac

echo "WIREPROXY_SOCKS=$socks" > .env
echo "==> Egress: ${socks:-host IP (no VPN)}"
echo "==> Bringing up stack (Scramjet on http://localhost:8080)"

docker compose down
docker compose up --build
