# Neko/YouTube De-Risk Probe Results

Gating probes from `docs/superpowers/plans/2026-07-25-remote-browser-youtube.md` (Task 0).
GATE: proceed to relying on the build only if **Probe 1 AND Probe 3 PASS** (Probe 2 informational).

**GATE STATUS (2026-07-25): SATISFIED for the direct-egress build.** Probe 1 PASS (media plane works).
Probe 3 FAIL for the Pi-Zero-W residential exit → user chose direct Codespace egress (Option 3), which
does not depend on Probe 3. YouTube playback (real browser attestation) is unaffected by egress path.

## Environment
- Egress node: Raspberry Pi Zero W (`pi-zero`, `100.106.254.12`), ARMv6l single core, BCM2835, rev 9000c1.
- Reachability: **Tailscale exit node** (userspace `wireguard-go`), NOT `wg-configs/peer1.conf`
  (peer1 = Proton MX datacenter server, wrong exit).
- Home line baseline (`speedtest`, no tunnel): down 24.98 Mbps / **up 27.87 Mbps** / ping 30.6 ms.
- Home residential egress IP (confirmed through exit): `109.152.52.119` (vs direct Codespace `172.166.151.112`).
- Bar: sustained ≥ ~6 Mbps (≈ 750,000 B/s) for 1080p headroom, Pi core not pegged.

## Probe 1 — Device → Cloudflare TURN 443/TCP relay  ✅ **PASS**
- Status: run from the locked device (user, 2026-07-25).
- Result: **PASS** — device opened TCP/443 to Cloudflare TURN and obtained a working relay candidate.
  Media plane is viable on the target device.

## Probe 2 — GH tunnel cannot carry WebRTC (informational)
- Status: **[HUMAN TODO — informational only]**
- Result:

## Probe 3 — Pi Zero egress bandwidth  ❌ **FAIL**
- Method: Codespace → Tailscale userspace SOCKS5 (`localhost:1055`) → Pi exit node → 100 MB CDN download.
- Path sanity: egress IP = `109.152.52.119` (residential, correct); `google/generate_204` → 204 (exit healthy).
- Note: `speed.cloudflare.com` returned 403 through the residential IP (Cloudflare bot-block) — switched
  to a neutral CDN (Hetzner 100MB.bin).
- **Measured: 353,007 B/s ≈ 2.82 Mbps sustained; transfer TIMED OUT at 84 MB / 100 MB after 240 s.**
- Interpretation: home uplink is 27.87 Mbps but the tunnel delivers only ~2.82 Mbps — a ~10× drop.
  Path confirmed DIRECT P2P (`direct 109.152.52.119:41641`, 12 ms — NOT DERP-relayed). Pi `tailscaled`
  at ~60% of the single core (NOT CPU-pegged). Root cause is the **Pi Zero W's single 2.4 GHz WiFi
  radio + no Ethernet**: as an exit node it must pull the download AND re-upload it over the same
  half-duplex radio simultaneously, halving throughput. Hardware-bound (radio), not fixable in software.
- Verdict vs 6 Mbps bar: **FAIL.** ~2.8 Mbps supports ~360p, not 1080p, with no headroom for the
  concurrent WebRTC re-encode.

## Decision (Probe 3)
Pi-Zero-W-as-egress does not meet the 1080p bar. Root cause is the Pi Zero W's single half-duplex WiFi
radio (no Ethernet), not CPU or the home line — so a software/config change cannot fix it. Options
(design spec §5 / plan line 67):
1. Cap Neko egress resolution to ~360-480p (fits ~2.8 Mbps; conflicts with the "real youtube.com,
   lowest latency" quality expectation — degraded but functional).
2. Move egress to a better residential exit: a Pi 4/5 (or any home box) on **wired Ethernet** with kernel
   WireGuard. Full-duplex + crypto accel would clear 1080p easily. Requires different hardware.
3. Drop residential egress for the YouTube path — Neko egresses direct from the Codespace (datacenter IP,
   occasional Google bot-checks, full bandwidth). Simplest; loses the residential-IP benefit.

### DECISION (user, 2026-07-25): Option 3 — direct Codespace egress for YouTube.
- Neko egresses direct (datacenter IP, full bandwidth, 1080p, lowest latency). Real youtube.com still
  plays — attestation is client-side (real browser mints the poToken); residential IP was only
  bot-check friction-reduction, never a playback requirement (spec §1).
- **Task 6 wiring:** OMIT `NEKO_EGRESS_SOCKS` so Chromium launches WITHOUT `--proxy-server`
  (no wireproxy/Tailscale hop on the YouTube path). Non-YouTube Scramjet path is unaffected.
- **Documented fallbacks if Google bot-checks become frequent:** (a) route egress to a better wired
  home exit (Pi 4/5 / home box on Ethernet + kernel WireGuard), or (b) cap Neko to ~360-480p and
  re-enable the Pi Zero W residential exit. Neither blocks shipping the direct-egress build now.
