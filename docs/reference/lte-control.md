# VeloCloud Edge 510-LTE — LTE modem power / SIM control (for OpenWRT)

Everything below is taken from the **live device** and from VeloCloud's own GPL
kernel patches (`444-vc-board.patch`, `444-vc-pcu.patch`), as mirrored in
<https://github.com/gallops-gannets/velo540openwrt>. These are the authoritative
register/GPIO definitions the stock OS uses.

> This is the original reverse-engineering note from the bring-up. Paths such
> as `backup/lte_research/...` refer to the private working tree; the vendor
> patches are linked below and in [../hardware.md](../hardware.md).

---

## 0. Answer to “is SIM select because of eSIM?”

**No.** The Edge 510-LTE has **two physical SIM sockets** (bottom = SIM1,
top = SIM2) feeding **one** EM7455 through an **on-board mux**. There is no
eSIM/eUICC.

Evidence:
- `hardwareinfo.json` → one LTE module, two slot entries:
  `sim1 → CELL1`, `sim2 → CELL2`, `selector → sim_select`.
- `/root/cell-ctl` → `sim1 - select SIM1 (bottom) via on-board mux`,
  `sim2 - select SIM2 (top) via on-board mux`, `sim both - detection status of
  both SIM cards`.
- Dell/VeloCloud setup guide: *“Two SIM slots are available. However, only use
  the lower SIM slot…”*. Datasheet: **“SIM Slots 2 (only 1 active)”**.
- Arista support: *“We do not support dual sims on Edge 510-LTE. We only
  support bottom slot i.e SIM1…”*.

During development the card was initially in the **top** slot
(`sim_select=1`, `sim2=1`, `sim1=0`), which the hardware supports and which
the vendor `CELL2` profile/APN is bound to. Officially VeloCloud only validates
the bottom slot. This project defaults to the **bottom** slot
(`sim_select=0`); both slots are selectable from LuCI.

---

## 1. Hardware topology

```
EM7455 (USB 1199:9071, on USB1 port 1-1.3)
   │  USB 2.0, internal
   ├── 1.0  qcserial  → ttyUSB0   (DM/diag)
   ├── 1.2  qcserial  → ttyUSB1   (NMEA/GPS)
   ├── 1.3  qcserial  → ttyUSB2   (AT)
   ├── 1.8  qmi_wwan  → cdc-wdm0 / wwan0
   └── 1.10 qmi_wwan  → cdc-wdm1 / wwan1

SIM mux (on-board) ── SIM1 (bottom) ─┐
                   └ SIM2 (top)    ─┴─ EM7455 SIM I/F

PCA9539 16-bit GPIO expander   @ i2c-1 (iSMT SMBus 00:13.0)  addr 0x74
PIC microcontroller            @ i2c-1                       addr 0x20
MFG EEPROM                     @ i2c-0 (I801 SMBus 00:1f.3) addr 0x50
PoE LTC4266 controllers        @ i2c-1                       addr 0x21-0x2a (not modem)
```

The modem is **not** on a removable mini-PCIe card detect that matters here;
`slotb-present` is the slot card-detect (active-low) and is not needed to power
the modem.

---

## 2. GPIO map (Edge 510)

### 2.1 PCA9539 expander, i2c-1 addr 0x74 (gpiochip base 130 in stock OS)

From `444-vc-board.patch` (`EDGE510_GPIO_PCA9539 = 130`) and comments in
`vc_510_probe_pca9539`:

| Bit | Stock GPIO | Name | Dir | Active / meaning |
|---|---|---|---|---|
| 0 | 130 | usb1-oc | in | 0 = USB1 overcurrent |
| 1 | 131 | usb2-oc | in | 0 = USB2 overcurrent |
| 2 | 132 | usb1-power | out | 1 = USB1 VBUS on |
| 3 | 133 | usb2-power | out | 1 = USB2 VBUS on |
| 4 | 134 | slota-reset | out | 1 = slot A reset released |
| **5** | **135** | **slotb-reset** | out | **0 = reset asserted, 1 = normal** |
| 6 | 136 | slotb-present | in | 0 = card in slot B (active-low) |
| 7 | 137 | phy-reset | out | reset of 88E1543 quad PHY |
| 8 | 138 | slota-rfkill_a | out | 0 = slot A rfkill A |
| 9 | 139 | slota-rfkill_b | out | 0 = slot A rfkill B |
| **10** | **140** | **slotb-power** | out | **1 = modem power ON** |
| 11 | 141 | slotb-rfkill | out | 0 = rfkill, 1 = radio enabled |
| 12 | 142 | slotb-gnss | out | 1 = GNSS enable |
| 13 | 143 | sim1 | in | 1 = SIM1 (bottom) installed |
| 14 | 144 | sim2 | in | 1 = SIM2 (top) installed |
| **15** | **145** | **slotb-sim-enable** | out (open-drain) | 1 = released/normal, 0 = driven low (SIM off / plug event) |

Register map used by the vendor driver:

```
0x00 INPUT   (16-bit, word access)
0x02 OUTPUT  (16-bit)
0x04 POL     (16-bit, set 0x0000 = no inversion)
0x06 CONFIG  (16-bit; 1 = input, 0 = output)
0x40 DRIVE0  0x42 DRIVE1  0x44 INLR  0x46 PULLEN
0x48 PULLSEL 0x4A IMASK   0x4C ISTATUS 0x4F OUTCFG (0 = push/pull)
```

Initial state written by the stock driver at probe:

```
.out = 0x003c   (usb1/usb2 power on, slota/slotb reset released)
.dir = 0x6043   (inputs: usb1-oc, usb2-oc, slotb-present, sim1, sim2; rest outputs)
.io  = 0x8000   (bit 15 is the open-drain SIM-detect pin)
OUTCFG = 0x00   (push/pull)
POL    = 0x0000 (no inversion)
```

The stock `ltectrl.sh` then sets `sim_select`, `sim_enable=1`, `power=1`.

### 2.2 C2000 PCU GPIOs (`gpio-pcu` driver, 2 banks)

From `444-vc-pcu.patch` and the live `/sys/kernel/debug/gpio`:

| Stock GPIO | Bank | Name | Use |
|---|---|---|---|
| 0–30 | core well | `0000:00:1f.0` | misc |
| 32–59 | suspend well | `0000:00:1f.0` | misc |
| **38** | suspend well bit 6 | **sim-select** | **0 = SIM1 (bottom), 1 = SIM2 (top)** |

`EDGE510_SUS_SIMSEL = (1<<6)` is deliberately **not** in `IOSEL_SUS`, i.e. it is
a plain GPIO, not a native function.

---

## 3. Exact power-on / power-off / SIM-switch sequences

### Cold start (stock `ltectrl.sh start`)

```sh
echo $((sim - 1)) > /sys/devices/platform/vc/slotb/sim_select   # 0=SIM1, 1=SIM2
echo 1            > /sys/devices/platform/vc/slotb/sim_enable
echo 1            > /sys/devices/platform/vc/slotb/power
# reset is already 1 (released), rfkill=1, gnss=1 from driver probe
```

### Power on (stock `cell-ctl cell_on`)

```sh
echo 1 > /sys/devices/platform/vc/slotb/sim_enable
echo 1 > /sys/devices/platform/vc/slotb/reset
echo 1 > /sys/devices/platform/vc/slotb/power
```

### Power off (stock `cell-ctl cell_off`)

```sh
echo 0 > /sys/devices/platform/vc/slotb/reset
echo 0 > /sys/devices/platform/vc/slotb/power
echo 0 > /sys/devices/platform/vc/slotb/sim_enable
```

### Switch SIM safely (stock `cell-ctl sim1|sim2`)

```sh
echo 0 > .../sim_enable          # disable SIM first
echo 0 > .../sim_select          # 0=SIM1/bottom, 1=SIM2/top
echo 1 > .../sim_enable          # re-enable
```

### Simulate card plug (stock `cell-ctl sim plug`)

```sh
echo 0 > .../sim_enable; sleep 0.5; echo 1 > .../sim_enable
```

### Reset pulse (stock `cell-ctl reset`)

```sh
echo 0 > .../reset; sleep 10; echo 1 > .../reset
```

**Polarity summary**
- `power`: active-high (1 = on).
- `reset`: **active-low** (0 = in reset, 1 = running).
- `rfkill`: active-low disable (0 = rfkill, 1 = radio on; stock leaves 1).
- `gnss`: active-high enable (1 = on; stock leaves 1).
- `sim_select`: 0 = SIM1/bottom, 1 = SIM2/top.
- `sim_enable`: 1 = normal, 0 = driven low (SIM off / plug event).

---

## 4. Where this comes from (vendor GPL source)

Available in the public Edge 540 OpenWrt tree:

- **`444-vc-board.patch`** — the `vc` platform driver (`CONFIG_VELOCLOUD_VC`).
  Key parts:
  - Edge 510 GPIO defines: lines ~887–946 (`EDGE510_GPIO_*`, `PCA9539_REG_*`).
  - `vc_hw_edge510` struct: ~1477 (`sims`, `sim_select`, `sim_enable`,
    `addrs[VC_I2C_0]=0x20`, `addrs[VC_I2C_1]=0x74`).
  - `vc_510_*` GPIO descriptors: ~4230–4345 (`slotb-power`, `slotb-reset`,
    `slotb-rfkill`, `slotb-gnss`, `sim1`, `sim2`, `slotb-sim-enable`).
  - PCA9539 initial state + probe: ~4630–4720.
  - `sim_select`/`sim_enable` sysfs handlers: ~3248–3275.
- **`444-vc-pcu.patch`** — the `gpio-pcu` driver (`CONFIG_GPIO_PCU`) that
  exposes the C2000 PCU GPIOs (including GPIO 38).
- **`20-velo540-modem`**, **`velo540-modemdev`**, **`velo540-celltest`** —
  the OpenWRT port's userspace glue (note: its hotplug VID `2c7c` is Quectel;
  your modem is `1199`, so that VID must be changed).

Upstream context / reimplementations:
- <https://github.com/gallops-gannets/velo540openwrt>
- <https://github.com/trainwr3ck/velocloud-520b-opnsense> (`vc_board`,
  `vc_pcu_gpio`, `vc_mdio` modules — FreeBSD port)
- <https://github.com/lori28167/velocloud-520-opnsense>

The stock kernel config confirms: `CONFIG_VELOCLOUD_VC=y`,
`CONFIG_GPIO_PCU=y`, `CONFIG_GPIO_SCH=y`, `CONFIG_GPIO_PCA953X` **not set**
(the vendor uses its own PCA9539 driver inside `vc-i2c`).

---

## 5. How to implement this under OpenWRT

### Option A (recommended): reuse the vendor `vc` driver

Build OpenWRT with:
- `vendor-patches-3.14/444-vc-board.patch`
- `vendor-patches-3.14/444-vc-pcu.patch`
- `CONFIG_VELOCLOUD_VC=y`, `CONFIG_GPIO_PCU=y`

Then `/sys/devices/platform/vc/slotb/{power,reset,sim_select,sim_enable,sim1,sim2}`
exists exactly as on the stock OS, and the backed-up `ltectrl.sh`/`cell-ctl`
logic works unchanged. Put a small init script in `/etc/init.d` that runs at
boot:

```sh
#!/bin/sh /etc/rc.common
START=25
start() {
    [ -e /sys/devices/platform/vc/slotb/power ] || return 0
    echo 0 > /sys/devices/platform/vc/slotb/sim_select   # 0=SIM1/bottom, 1=SIM2/top
    echo 1 > /sys/devices/platform/vc/slotb/sim_enable
    echo 1 > /sys/devices/platform/vc/slotb/reset
    echo 1 > /sys/devices/platform/vc/slotb/power
}
stop() {
    [ -e /sys/devices/platform/vc/slotb/power ] || return 0
    echo 0 > /sys/devices/platform/vc/slotb/reset
    echo 0 > /sys/devices/platform/vc/slotb/power
    echo 0 > /sys/devices/platform/vc/slotb/sim_enable
}
```

### Option B: standard `gpio-pca953x` + `gpio-pcu`, raw GPIOs

1. Enable `CONFIG_GPIO_PCA953X` and instantiate a PCA9539 at **i2c-1, 0x74**
   (ACPI/board file or a small `i2c_board_info` module).
2. Enable the `gpio-pcu` driver for the C2000 PCU banks (base 0 / 32).
3. Find the dynamic expander base (`gpiochip`/`/sys/kernel/debug/gpio`) and
   drive:

```sh
# example bases: PCU base 32, expander base X (dynamic)
SIM_SELECT=$((32 + 6))          # PCU GPIO 38
PB_POWER=$((X + 10))
PB_RESET=$((X + 5))
PB_RFKILL=$((X + 11))
PB_GNSS=$((X + 12))
SIM_ENA=$((X + 15))

# power on (SIM2/top)
gpioset $SIM_SELECT 1
gpioset $SIM_ENA 1
gpioset $PB_RESET 1
gpioset $PB_RFKILL 1
gpioset $PB_GNSS 1
gpioset $PB_POWER 1
```

(Power off: reset 0, power 0, sim_enable 0. Switch SIM: sim_enable 0, change
sim_select, sim_enable 1.)

> If your kernel lacks `gpioset`, use the legacy sysfs GPIO interface
> (`/sys/class/gpio/export`, `direction`, `value`) or a tiny `gpio-hog` in a
> board file.

### Option C: port the vendor `vc-i2c` driver alone

The PCA9539 handling is ~200 lines (`vc_510_gpio_input/output/get/set`,
`vc_510_probe_pca9539`) and can be lifted into a small OpenWRT platform driver
if you do not want the whole `vc` driver. The register map in §2.1 is all you
need.

---

## 6. Modem / data side (what to configure in OpenWRT)

- USB ID **1199:9071**, QMI composition (config 1, 5 interfaces) →
  `qcserial` ttyUSB0/1/2 + `qmi_wwan` cdc-wdm0/wwan0 and cdc-wdm1/wwan1.
- Driver: `qmi_wwan` (in-kernel) + `usb_wwan`/`qcserial` for AT.
- APN: **`sp.mb.com`**, no username/password (Public Mobile / Telus).
  (Stock file: `/etc/config/modems/CELL2.profile`, `APN_TYPE=manual`.)
- Two ways to bring up the WAN:
  - **ModemManager** (what the stock OS uses; `type 'modemmanager'`,
    `product '1199:9071'`, sysfs `1-1.3`).
  - **uqmi / netifd** directly on `/dev/cdc-wdm0`:
    `uqmi -d /dev/cdc-wdm0 --start-network sp.mb.com --autoconnect`, then DHCP
    or static on `wwan0`.
- The modem can be switched between QMI and MBIM with the vendor tool:
  `cell-ctl usb-qmi` (composition 6), `cell-ctl usb-mbim` (composition 8).
  Current composition is QMI.
- `AT` port is `/dev/ttyUSB2`; APN live check:
  `AT+CGDCONT?` → `1,"IPV4V6","sp.mb.com"`.
- Firmware on the module is **SWI9X30C_02.30.01.01** with an **AT&T PRI**.
  The repo's newest `.cwe` is 02.26.01.00 — **older**; do not use
  `cell-fw-update` blindly (see `../modem_info.txt`).

---

## 7. Caveats / gotchas

- **Watchdog**: the stock coreboot/PCU watchdog resets the box after a few
  minutes if the OS does not kick it. The stock OS does; a bare fail-safe shell
  does not. OpenWRT needs the modified coreboot (or PCU watchdog handling).
  The PCU watchdog is exposed via the `i2c_ltc4266`/PCU MFD; see
  `444-vc-pcu.patch` (`pcu_wdt_cell`).
- **SIM slots**: only the bottom slot is officially supported by VeloCloud, but
  the mux and both presence lines exist and the top slot works. For a
  production backup gateway, prefer the bottom slot.
- **`sim_enable` is the SIM-detect line to the modem**, not a simple power
  switch; always disable it before changing `sim_select`, then re-enable.
- **Do not hot-plug the SIM while `power=1`** unless you use the
  `sim plug` sequence (sim_enable 0 → 1) so the modem re-detects it.
- **GPIO numbering is only stable with the vendor `vc` driver**. With standard
  `gpio-pca953x`/`gpio-pcu`, bases are dynamic; resolve them at boot.
- The `slotb-present` signal is active-low (0 = card present); it is not
  required for powering the modem.
- Modem power is **not** the USB port power (`usb1-power`/`usb2-power`); those
  are the external USB-A ports. Use `slotb-power` (PCA9539 bit 10).
