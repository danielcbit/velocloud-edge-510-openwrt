# LTE bring-up

This is the part that is specific to the Edge 510-LTE. It assumes OpenWrt
25.12.4 is already running and you have LAN/SSH access.

## 1. Packages

```sh
apk update
apk add i2c-tools usbutils uqmi \
    kmod-usb-net-qmi-wwan kmod-usb-serial-option \
    kmod-usb-serial-sierrawireless \
    mwan3 luci-app-mwan3 luci-proto-qmi luci-app-commands
```

`luci-proto-qmi` is required for LuCI to recognise the `qmi` protocol;
`luci-app-commands` is optional but provides the SIM shortcut page.

If the router reaches the internet through a proxy:

```sh
export http_proxy=http://<proxy>:8888 https_proxy=http://<proxy>:8888
```

## 2. Missing kernel modules

OpenWrt 25.12.4 does not build these:

| Module | Why |
|---|---|
| `i2c-ismt.ko` | exposes `i2c-1` (SMBus iSMT), needed for the PCA9539 |
| `gpio-pcu.ko` | vendor C2000 PCU GPIO driver; GPIO 38 = SIM mux |

Build them with [../build/README.md](../build/README.md) or use the prebuilt
modules in `prebuilt/6.12.87/` (same kernel only).

Install:

```sh
scp prebuilt/6.12.87/*.ko root@192.168.2.1:/root/
```

## 3. Boot-time hardware setup

The repository installs `/etc/init.d/lte-hw` (enabled as `S19lte-hw`) and
`/usr/bin/lte-hw-setup`.

`lte-hw-setup` does, in order:

1. `insmod /root/gpio-pcu.ko`
2. unbind `lpc_ich` from `0000:00:1f.0`
3. bind `pcu_gpio` to `0000:00:1f.0`
4. export GPIO 38 and set it from the selected slot
   (`0` = bottom, `1` = top)
5. load `i2c-ismt.ko`
6. run the PCA9539 power sequence
7. toggle the SIM plug bit
8. wait for `/dev/cdc-wdm0`

It prefers `uci get network.wanb.sim_slot`, then `/etc/lte-sim-slot`, then
`bottom`.

The init script runs at **S19**, before `network` (S20), so `wanb` can use
normal LuCI autostart.

## 4. QMI configuration

`/etc/config/network`:

```
config interface 'wanb'
    option proto 'qmi'
    option device '/dev/cdc-wdm0'
    option apn 'sp.mb.com'     # Public Mobile / Telus
    option auth 'none'
    option pdptype 'ipv4'
    option profile '1'         # REQUIRED
    option auto '1'
    option metric '20'
    option multipath 'off'
    option sim_slot 'bottom'
```

The `profile 1` option maps to `uqmi --profile 1`. Without it
`--start-network` returns `Call failed` on this modem.

`uqmi` is at `/sbin/uqmi` and does include the UIM actions
(`--uim-get-sim-state`, `--uim-power-on/off`). The netifd script
`/lib/netifd/proto/qmi.sh` uses them.

## 5. Modem profile

Set the modem's profile 1 to the same values once (it persists in modem NVRAM):

```sh
uqmi -d /dev/cdc-wdm0 -t 3000 --modify-profile 3gpp,1 \
    --apn sp.mb.com --pdp-type ipv4 --auth-type none
uqmi -d /dev/cdc-wdm0 -t 3000 --set-default-profile 3gpp,1
```

Verify:

```sh
uqmi -d /dev/cdc-wdm0 -t 3000 --get-profile-settings 3gpp,1
```

Expected: APN `sp.mb.com`, PDP `ipv4`, auth `none`.

## 6. Do not install ModemManager

ModemManager auto-starts, grabs the QMI device, probes both `cdc-wdm0` and
`cdc-wdm1`, and makes `uqmi` return `Request timed out` /
`Failed to connect to service`. It is not needed with netifd. Remove it:

```sh
apk del modemmanager
```

## 7. Bring it up

```sh
/etc/init.d/lte-hw enable
/usr/bin/lte-hw-setup
ifup wanb
```

Or simply reboot. Verify:

```sh
ifstatus wanb                 # up, l3_device wwan0
ip -4 addr show wwan0          # address from the network
uqmi -d /dev/cdc-wdm0 -t 3000 --get-data-status   # "connected"
ping -I wwan0 -c2 1.1.1.1
```

Example from a clean boot:

```
lte-hw: SIM mux = bottom (GPIO38=0)
lte-hw: modem powered, SIM bottom
lte-hw: cdc-wdm0 ready
netifd: Interface 'wanb' is setting up now
wwan0: 198.51.100.10/29
uqmi: "connected"
ping 1.1.1.1: 2/2, 27-60 ms
```

## 8. LuCI LTE status page

The official OpenWrt 25.12.4 feed has no 3ginfo/modemininfo package, and
`luci-proto-modemmanager` requires ModemManager (which conflicts with the QMI
setup). This repository adds a self-contained **Status → LTE** page instead.

It shows:

- **Signal:** RSRP, RSRQ, RSSI, SNR, TX power (RSRP is colour-coded).
- **Network:** operator, PLMN, registration, roaming, radio, service status.
- **Cell:** band, frequency, channel, PCI, TAC, eNodeB, cell ID, duplex.
- **Data:** data status, IPv4, gateway, DNS, MTU, interface state, uptime,
  RX/TX byte counters.
- **SIM:** card state, PIN1 status, selected slot.

Implementation:

| Path | Purpose |
|---|---|
| `/usr/bin/lte-status` | runs `uqmi` queries and emits one JSON object |
| `/www/luci-static/resources/view/lte/status.js` | LuCI view, refreshes every 10 s |
| `/usr/share/luci/menu.d/luci-app-lte.json` | adds **Status → LTE** |
| `/usr/share/rpcd/acl.d/luci-app-lte.json` | grants `file exec` for `/usr/bin/lte-status` |

The view calls `fs.exec('/usr/bin/lte-status')` through rpcd. Every `uqmi`
invocation has a hard shell timeout so a missing SIM cannot hang the page.

If the page disappears after a package upgrade, re-copy the four files above
and bump the LuCI cache version:

```sh
touch /lib/apk/db/installed
```

## 9. SIM switching

The LuCI field and `/usr/bin/sim-select` both do:

1. `ifdown wanb`
2. set GPIO 38
3. full PCA9539 power cycle
4. wait for `cdc-wdm0`
5. `ifup wanb`

Switching takes ~25–40 s and briefly drops LTE. Selecting an empty slot is
expected to fail with `SIM_ILLEGAL_STATE`; switching back recovers.

## 10. Watchdog

The stock PIC watchdog is disabled in GRUB with `vc wdt 0` (see
[install-openwrt.md](install-openwrt.md)). OpenWrt then needs no watchdog
daemon.

A separate **LTE watchdog** restarts `wanb` if the data path dies:

```cron
*/5 * * * * /usr/bin/lte-watchdog
```

`lte-watchdog` checks `ifstatus wanb` and pings `1.1.1.1` through `wwan0`.

## 11. Why the helper scripts look unusual

- BusyBox in this build has **no `timeout` applet**. `sim-select` uses a small
  shell `to()` watchdog around `uqmi` so a missing SIM cannot hang LuCI.
- `qmi.sh` waits for SIM initialization and can power-cycle the SIM itself.
  The mux must be correct before that runs; hence the pre-up hook in
  [luci-sim-select.md](luci-sim-select.md).
- `uqmi --start-network` returns a **packet data handle** on success. If you
  call it in a separate `uqmi` process without `--set-client-id`, the client
  is released and a later `--get-data-status` may show `disconnected` even
  though the call came up. netifd handles this correctly with a persistent
  client ID.
