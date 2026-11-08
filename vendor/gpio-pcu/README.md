# Vendor `gpio-pcu` driver (GPL-2.0)

`gpio-pcu.c` is the VeloCloud C2000 PCU GPIO driver, extracted from
`444-vc-pcu.patch` in the public Edge 540 OpenWRT port:

- https://github.com/gallops-gannets/velo540openwrt
- https://github.com/junk-labs/velocloud-openwrt

The file is **GPL-2.0** (see the header in the source and
`../COPYING.GPL-2.0`). It is included here so the build is reproducible
without depending on a third-party repository staying online.

The vendor source targets Linux 3.14. `../../patches/0003-gpio-pcu-linux-6.12.patch`
contains the minimal fixes needed for Linux 6.12:

- include `linux/gpio/driver.h`
- `gpio_chip.dev` -> `gpio_chip.parent`
- set `owner` and `label`
- `gpiochip_add()` -> `gpiochip_add_data()`
- `gpiochip_remove()` no longer returns a value
- `DEFINE_PCI_DEVICE_TABLE()` -> `const struct pci_device_id[]`
- stub `vc_dmi` / `vc_bbfw` (the vendor `vc-board` module is not built)

`velocloud.h` is a minimal replacement for the vendor header (board enum and
the two exported symbols).

After loading the module, `lpc_ich` must be unbound from `0000:00:1f.0` before
`pcu_gpio` can bind. See `../../docs/lte.md`.
