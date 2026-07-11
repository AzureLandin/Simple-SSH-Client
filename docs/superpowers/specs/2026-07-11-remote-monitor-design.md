# Remote Session Monitor — Design Spec

**Date:** 2026-07-11  
**Status:** Approved for implementation  
**Scope:** Sidebar metrics for the active connected SSH session (Linux via `/proc` polling).

## Goals

- Show live remote stats for the **active connected** session: CPU %, memory used/total, load average, swap, network up/down rates.
- Collect via ssh2 **exec** on the existing client (read-only `/proc`), ~2s interval.
- Replace sidebar placeholder when a connected session is active.

## Non-Goals

- Windows/macOS remote targets, agents, disk inventory, historical charts, multi-session parallel dashboards.

## Behavior

| State | Sidebar |
|-------|---------|
| No session / disconnected / error | Placeholder (monitoring unavailable) |
| Active session connected (Linux) | Live metrics |
| Active session connected (non-Linux / parse fail) | Short unsupported / error message |

Switching tabs stops polling the previous session and starts the new one. Disconnect clears metrics.

## Metrics

- **CPU %**: delta of `/proc/stat` aggregate idle vs total  
- **Memory**: `/proc/meminfo` MemTotal / MemAvailable (or MemFree+Buffers+Cached)  
- **Swap**: SwapTotal / SwapFree  
- **Load**: `/proc/loadavg` 1/5/15  
- **Network**: delta of summed `/proc/net/dev` rx/tx bytes → B/s (exclude `lo`)

## Architecture

- Main: `MonitorService` holds timer + last counters per session; uses `SessionManager.getClient()` → `exec`.
- IPC push: `monitor:update` with `{ sessionId, snapshot | null, error? }`.
- Renderer: sidebar subscribes; displays bars + rates; i18n keys under `monitor.*`.

## Success criteria

- Active Linux session shows updating CPU/mem/swap/load/net.  
- Tab switch / disconnect does not leave stale data or leaked timers.  
- Interactive terminal output is not polluted by monitor commands.
