#!/bin/sh
# Mint short-lived Cloudflare TURN ICE servers and print a single JSON array
# (port-53 URLs removed). Requires curl + jq and the env vars below.
#
# Usage: CF_TURN_TOKEN_ID=... CF_TURN_API_TOKEN=... [CF_TURN_TTL=86400] \
#          scripts/mint-turn-creds.sh
set -e

: "${CF_TURN_TOKEN_ID:?set CF_TURN_TOKEN_ID}"
: "${CF_TURN_API_TOKEN:?set CF_TURN_API_TOKEN}"
ttl="${CF_TURN_TTL:-86400}"

curl -s \
	"https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_TOKEN_ID}/credentials/generate-ice-servers" \
	--header "Authorization: Bearer ${CF_TURN_API_TOKEN}" \
	--header "Content-Type: application/json" \
	--data "{\"ttl\": ${ttl}}" \
| jq -c '[.iceServers[] | .urls |= map(select(contains(":53") | not)) | select(.urls | length > 0)]'
