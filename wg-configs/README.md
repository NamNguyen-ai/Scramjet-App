# WireGuard peer configs for egress IP rotation

Each `.conf` in this directory backs one `wireproxy` container in
`docker-compose.yml`. The Scramjet server round-robins outbound TCP
connections across all of them, so each peer should egress from a different
public IP for rotation to be meaningful.

## Adding peers

1. Copy `example.conf` to a new file named `peerN.conf` (e.g. `peer1.conf`,
   `peer2.conf`, ...).
2. Fill in the real `[Interface]` and `[Peer]` values from your WireGuard
   provider. Leave the `[Socks5]` section as `BindAddress = 0.0.0.0:25344`.
3. Open `../docker-compose.yml` and:
   - Add a `wireproxyN` service mirroring the existing ones, mounting your
     new `peerN.conf` at `/etc/wireproxy/config`.
   - Append `wireproxyN:25344` to the `WIREPROXY_SOCKS` env var on the
     `scramjet` service.
   - Add `wireproxyN` to the `depends_on` list.
4. `docker-compose up --build`.

## Notes

- `example.conf` is a template; wireproxy will refuse to start until you
  replace the placeholders. Don't add it as a service.
- If `WIREPROXY_SOCKS` is empty or unset, rotation is disabled and the
  Scramjet server egresses from the host's IP.
