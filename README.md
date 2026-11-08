# VeloCloud Edge 510-LTE on OpenWrt

Turn a **VeloCloud Edge 510-LTE** into an OpenWrt router with a working **LTE
backup WAN**, **SIM-slot selection in LuCI**, and **mwan3 failover** — while
keeping the stock OS available for recovery.

This is not an officially supported OpenWrt target. The repository documents
the reverse-engineering findings and contains the patches/scripts needed to
reproduce the result on the same hardware.

> **Status:** OpenWrt 25.12.4 (kernel 6.12.87) boots from the internal eMMC,
> the EM7455 is powered and registered on LTE, `wanb` gets an address via QMI,
> DNS/HTTP work, and the SIM slot is selectable in LuCI. The primary WAN
> (`eth1`) was not connected during development, so cable-pull failover is the
> one path not yet exercised end-to-end.

## What works

- **Dual boot**, non-destructive: stock GRUB, stock root partitions and
  recovery entries remain intact. OpenWrt lives on `sda5` with a data
  partition on `sda6`.
- **Watchdog disabled without a BIOS flash** using the stock GRUB command
  `vc wdt 0` (tested for >430 s with no kick).
- **EM7455 power + SIM mux** through the on-board PCA9539 and the vendor C2000
  PCU GPIO driver.
- **QMI LTE** on `/dev/cdc-wdm0` with `uqmi`/netifd, APN `sp.mb.com`
  (Public Mobile / Telus), IPv4, modem profile 1.
- **SIM slot selector in LuCI** on `Network → Interfaces → wanb → General`
  (bottom/top), which switches GPIO 38 and power-cycles the modem.
- **mwan3** with `eth1` as primary (metric 1) and LTE as backup (metric 2).
- **LuCI Status → LTE** page with live RSRP/RSRQ/RSSI/SNR, band/channel/PCI,
  TAC/eNodeB/cell ID, IP/DNS/MTU, SIM state, traffic counters and
  signal-history sparklines.
- **LTE watchdog** that restarts `wanb` if the link drops.
- **Stock OS recovery** through the existing GRUB menu entries.

## Why a repository is needed

OpenWrt 25.12.4 x86/64 is missing several pieces this board needs:

| Missing piece | Consequence | Solution |
|---|---|---|
| `CONFIG_I2C_ISMT` | No `i2c-1`, no PCA9539, no modem power | Build `i2c-ismt.ko` from the matching SDK |
| `gpio-pcu` driver | SIM mux (GPIO 38) cannot be driven | Build the vendor driver for Linux 6.12 |
| QMI SIM state | `qmi.sh` can fail before the call | Correct SIM mux + modem profile |
| `--profile 1` | `--start-network` returns `Call failed` | Set UCI `profile 1` |
| LuCI QMI SIM field | No way to choose the SIM slot | Patch `qmi.js` + `qmi.sh` |
| LuCI cache busting | Patched JS not picked up | Bump `/lib/apk/db/installed` mtime |

## Hardware

- VeloCloud Edge 510-LTE, Intel Atom C2358 (2 cores), 4 GB RAM.
- Internal eMMC with GPT: BIOS boot, GRUB, two stock root partitions, one
  spare root partition, one data partition.
- Sierra Wireless EM7455 (`1199:9071`), USB QMI composition.
- PCA9539 16-bit GPIO expander on SMBus iSMT (`i2c-1`, `0x74`).
- C2000 PCU GPIOs via the LPC bridge (`0000:00:1f.0`); **GPIO 38** is the SIM
  mux select (0 = bottom/SIM1, 1 = top/SIM2).
- Two physical SIM sockets feeding one modem through the on-board mux.
  VeloCloud officially validates the **bottom** slot.

See [docs/hardware.md](docs/hardware.md) for the full GPIO/I2C map and the
stock power sequences.

## Repository layout

```
build/                 Docker/amd64 build for i2c-ismt.ko and gpio-pcu.ko
docs/                  findings, install steps, tuning, troubleshooting
files/                 files to install on the router (patched qmi.sh/qmi.js,
                       init script, rc.local, UCI config examples)
patches/               diffs for qmi.sh, qmi.js and the gpio-pcu 6.12 port
prebuilt/6.12.87/      prebuilt modules for OpenWrt 25.12.4 (checksums)
scripts/               hardware setup, SIM select, watchdog, installer
vendor/gpio-pcu/       vendor GPL-2.0 driver, patched at build time
```

## Quick start (OpenWrt already installed)

1. **Back up the stock system first.** See
   [docs/install.md](docs/install-openwrt.md). Do not skip this.
2. Install the packages:
   ```sh
   scp scripts/install-packages.sh root@192.168.2.1:/tmp/
   ssh root@192.168.2.1 sh /tmp/install-packages.sh
   ```
3. Copy the repository to the router:
   ```sh
   scp -r . root@192.168.2.1:/root/velocloud-repo
   ```
4. Run the installer:
   ```sh
   ssh root@192.168.2.1 sh /root/velocloud-repo/scripts/install.sh
   ```
5. Reboot and verify:
   ```sh
   ssh root@192.168.2.1 sh /root/velocloud-repo/scripts/verify.sh
   ```
6. In LuCI, open `Network → Interfaces → wanb → Edit → General` and choose
   the **SIM slot**. Press **Save & Apply**.
7. Open **Status → LTE** for live signal/cell/data details.

## Full install from the stock OS

The complete path — backup, partition layout, GRUB, OpenWrt image, first boot,
watchdog and recovery — is in [docs/install-openwrt.md](docs/install-openwrt.md).

The LTE-specific bring-up is in [docs/lte.md](docs/lte.md) and the LuCI SIM
field is described in [docs/luci-sim-select.md](docs/luci-sim-select.md).

To use the Edge as a **backup WAN behind a MikroTik router**, see
[docs/mikrotik-backup-wan.md](docs/mikrotik-backup-wan.md).

The original hardware/GPIO reverse-engineering notes are in
[docs/reference/lte-control.md](docs/reference/lte-control.md).

## Verification

```sh
ifstatus wanb                 # up, l3_device wwan0
ip -4 addr show wwan0          # address from the LTE network
uqmi -d /dev/cdc-wdm0 -t 3000 --get-data-status   # "connected"
ping -I wwan0 -c2 1.1.1.1
mwan3 status                   # wanb online
```

A previous clean boot produced, for example:

```
lte-hw: SIM mux = bottom (GPIO38=0)
lte-hw: modem powered, SIM bottom
lte-hw: cdc-wdm0 ready
netifd: Interface 'wanb' is setting up now
wwan0: 198.51.100.10/29
uqmi: "connected"
ping 1.1.1.1: 2/2, 27-60 ms
mwan3: wanb online
```

## Warnings and limitations

- **Destructive if you ignore the partition plan.** Keep `sda1`–`sda4`
  untouched; the stock OS is the recovery path.
- **Bottom SIM only is officially supported.** The top slot works electrically
  and is implemented here, but VeloCloud only validates SIM1/bottom.
- **Modem firmware must not be downgraded.** The unit here has
  `SWI9X30C_02.30.01.01`; the public Edge 540 tree ships an older
  `02.26.01.00`. Do not run `cell-fw-update` with it.
- **Do not install ModemManager** while netifd owns the modem. It grabs the
  QMI device and makes `uqmi` time out.
- **Local patches.** `qmi.sh` and `qmi.js` are modified in place. A package
  upgrade can overwrite them; re-apply the patches/copies if that happens.
- **No credentials or device-specific identifiers** are included. Set your own
  root password and SSH keys.

## License

Original code and documentation: **MIT** (see [LICENSE](LICENSE)).

`vendor/gpio-pcu/gpio-pcu.c` is VeloCloud GPL-2.0 code; see
[vendor/gpio-pcu/README.md](vendor/gpio-pcu/README.md) and
[vendor/COPYING.GPL-2.0](vendor/COPYING.GPL-2.0).

## References

- Edge 540 OpenWrt port / vendor GPL patches:
  <https://github.com/gallops-gannets/velo540openwrt>
- Another mirror: <https://github.com/junk-labs/velocloud-openwrt>
- OPNsense ports for related VeloCloud boards:
  <https://github.com/trainwr3ck/velocloud-520b-opnsense>,
  <https://github.com/lori28167/velocloud-520-opnsense>
- OpenWrt 25.12.4 downloads: <https://downloads.openwrt.org/releases/25.12.4/>
