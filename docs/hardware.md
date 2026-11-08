# Hardware notes

## Board

- **VeloCloud Edge 510-LTE** (Dell OEM).
- CPU: Intel Atom C2358 (2 cores, 1.74 GHz), 4 GB RAM.
- Internal eMMC with GPT:
  - `sda1` — BIOS boot
  - `sda2` — GRUB `/boot` (ext4)
  - `sda3` — stock root0
  - `sda4` — stock root1 / latest stock OS
  - `sda5` — spare root partition (used for OpenWrt here)
  - `sda6` — data partition (formatted `rootfs_data` here)
- Console: **ttyS1, 115200 8N1** (USB serial adapter, 3-pin header).
- LTE module: **Sierra Wireless EM7455**, USB ID `1199:9071`, QMI composition.

## Modem USB topology

```
EM7455 (USB 1199:9071, on USB1 port 1-1.3)
   │  USB 2.0, internal
   ├── 1.0  qcserial  → ttyUSB0   (DM/diag)
   ├── 1.2  qcserial  → ttyUSB1   (NMEA/GPS)
   ├── 1.3  qcserial  → ttyUSB2   (AT)
   ├── 1.8  qmi_wwan  → cdc-wdm0 / wwan0
   └── 1.10 qmi_wwan  → cdc-wdm1 / wwan1
```

`cdc-wdm0` is the QMI control device used by `uqmi`/netifd.

## I2C buses

| Bus | Controller | Devices |
|---|---|---|
| `i2c-0` | Intel I801 SMBus (`00:1f.3`) | MFG EEPROM at `0x50` |
| `i2c-1` | Intel iSMT SMBus (`00:13.0`) | PCA9539 at `0x74`, PIC at `0x20`, PoE LTC4266 at `0x21`–`0x2a` |

OpenWrt's x86/64 kernel config does **not** build `i2c-ismt`, so `i2c-1` does
not exist until the module from this repository is loaded. Without it the
PCA9539 cannot be reached and the modem stays unpowered.

## PCA9539 GPIO expander (`i2c-1`, `0x74`)

16-bit expander used for slot power/reset/rfkill and SIM presence.

Register map:

```
0x00 INPUT   (16-bit, word access)
0x02 OUTPUT  (16-bit)
0x04 POL     (16-bit, 0x0000 = no inversion)
0x06 CONFIG  (16-bit; 1 = input, 0 = output)
0x40 DRIVE0  0x42 DRIVE1  0x44 INLR  0x46 PULLEN
0x48 PULLSEL 0x4A IMASK   0x4C ISTATUS 0x4F OUTCFG (0 = push/pull)
```

Bit map (as used by the vendor driver):

| Bit | Name | Direction | Meaning |
|---|---|---|---|
| 0 | `usb1-oc` | in | 0 = USB1 overcurrent |
| 1 | `usb2-oc` | in | 0 = USB2 overcurrent |
| 2 | `usb1-power` | out | 1 = USB1 VBUS on |
| 3 | `usb2-power` | out | 1 = USB2 VBUS on |
| 4 | `slota-reset` | out | 1 = reset released |
| 5 | `slotb-reset` | out | 0 = reset asserted, 1 = normal |
| 6 | `slotb-present` | in | 0 = card present (active low) |
| 7 | `phy-reset` | out | 88E1543 PHY reset |
| 8 | `slota-rfkill_a` | out | 0 = rfkill |
| 9 | `slota-rfkill_b` | out | 0 = rfkill |
| 10 | `slotb-power` | out | **1 = modem power on** |
| 11 | `slotb-rfkill` | out | 0 = rfkill, 1 = radio enabled |
| 12 | `slotb-gnss` | out | 1 = GNSS enable |
| 13 | `sim1` | in | 1 = SIM1 (bottom) installed |
| 14 | `sim2` | in | 1 = SIM2 (top) installed |
| 15 | `slotb-sim-enable` | out (open-drain) | 1 = normal, 0 = SIM off/plug event |

Stock initial state:

```
OUTPUT = 0x003c   # usb power on, slot resets released
CONFIG = 0x6043   # inputs: usb1-oc, usb2-oc, slotb-present, sim1, sim2
POL    = 0x0000
```

Power sequence used by this project (matches the stock `cell-ctl` order):

```sh
BUS=$(i2cdetect -l | awk '/iSMT/{gsub("i2c-","",$1); print $1; exit}')
i2cset -y "$BUS" 0x74 0x06 0x6043 w    # directions
i2cset -y "$BUS" 0x74 0x04 0x0000 w    # no inversion
i2cset -y "$BUS" 0x74 0x02 0x0000 w    # all off
sleep 1
i2cset -y "$BUS" 0x74 0x02 0x8000 w    # sim_enable high, power off
sleep 1
i2cset -y "$BUS" 0x74 0x02 0x8020 w    # reset released
sleep 1
i2cset -y "$BUS" 0x74 0x02 0x9FBC w    # power on + rfkill/gnss
sleep 1
i2cset -y "$BUS" 0x74 0x02 0x1FBC w    # SIM plug low
sleep 1
i2cset -y "$BUS" 0x74 0x02 0x9FBC w    # SIM plug high
```

`0x9FBC` = power (bit 10), reset (bit 5), rfkill (bit 11), gnss (bit 12) and
sim_enable (bit 15). Toggling bit 15 low/high simulates a SIM plug event.

## C2000 PCU GPIOs and SIM select

The LPC bridge is `0000:00:1f.0`. The vendor `gpio-pcu` driver exposes two
banks:

| Bank | GPIOs | Notes |
|---|---|---|
| core well | 0–31 | misc |
| suspend well | 32–63 | misc |

**GPIO 38** (suspend-well bit 6) is the SIM mux select:

- `0` = SIM1 / **bottom**
- `1` = SIM2 / **top**

Under OpenWrt, `lpc_ich` binds to `0000:00:1f.0` first. You must unbind it
before `pcu_gpio` can bind:

```sh
insmod /root/gpio-pcu.ko
echo -n 0000:00:1f.0 > /sys/bus/pci/drivers/lpc_ich/unbind
echo -n 0000:00:1f.0 > /sys/bus/pci/drivers/pcu_gpio/bind
echo 38 > /sys/class/gpio/export
echo out > /sys/class/gpio/gpio38/direction
echo 0 > /sys/class/gpio/gpio38/value
```

The init script `/etc/init.d/lte-hw` does this at boot before network starts.

## Why both SIM sockets exist but only one is official

The Edge 510-LTE has two physical SIM sockets feeding one EM7455 through the
on-board mux. VeloCloud's documentation says only the lower/bottom slot is
validated, and the stock `CELL2` profile is bound to SIM2. Electrically both
work; this project defaults to the bottom slot and exposes the choice.

## Watchdog

The stock coreboot/PCU watchdog resets the board if nothing kicks it. The
stock OS does; a fail-safe shell does not. Two findings:

- The `vc wdt 0` command in the **stock GRUB** disables the PIC watchdog. This
  was tested by idling in fail-safe for **430 s** with no reset.
- Writing to `i2c-1 0x24` (the OPNsense recipe for related boards) **fails on
  this unit** — `0x24` is read-only here, likely an LTC4266.

No BIOS flash is needed. See [install-openwrt.md](install-openwrt.md) for the
GRUB entry.

## Modem firmware

The unit used here reports `SWI9X30C_02.30.01.01`. The public Edge 540 tree
contains `02.26.01.00`, which is **older**. Do not run `cell-fw-update` with
that package.
