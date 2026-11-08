# Building the kernel modules

OpenWrt 25.12.4 x86/64 does **not** build:

- `i2c-ismt` — the Intel iSMT SMBus controller that exposes the PCA9539 at
  `i2c-1 0x74`.
- `gpio-pcu` — the VeloCloud C2000 PCU GPIO driver that controls SIM select
  (GPIO 38).

Both are built out-of-tree against the exact kernel from the matching SDK.

## Requirements

- Linux/amd64 environment (Docker Desktop on macOS works with
  `--platform linux/amd64`; the build script does this).
- ~2 GB free disk and a network connection for the SDK tarball (~272 MB).
- The OpenWrt release **must match** the running kernel. The prebuilt modules
  here are for **25.12.4 / kernel 6.12.87**. Rebuild for any other release.

## Build

```sh
./build/run.sh
```

Or, on a Linux host with the build dependencies:

```sh
./build/build.sh
```

The script downloads
`openwrt-sdk-25.12.4-x86-64_gcc-14.3.0_musl.Linux-x86_64.tar.zst` into
`.work/` (gitignored), builds both modules, and writes them to
`prebuilt/6.12.87/` with a fresh `SHA256SUMS`.

## How the modules are built

- **i2c-ismt**: in-tree source, built with
  `make -C $KDIR M=drivers/i2c/busses CONFIG_I2C_ISMT=m modules`. The SDK tree
  is already prepared (`.config`, `Module.symvers`).
- **gpio-pcu**: vendor source in `vendor/gpio-pcu/`, patched with
  `patches/0003-gpio-pcu-linux-6.12.patch`, plus a minimal
  `include/misc/velocloud.h`. The kernel `drivers/gpio/Makefile` gets
  `obj-$(CONFIG_GPIO_PCU) += gpio-pcu.o`.

## Install

Copy to the router and load from `/etc/init.d/lte-hw`:

```sh
scp prebuilt/6.12.87/*.ko root@192.168.2.1:/root/
```

Check that they match the running kernel:

```sh
uname -r          # 6.12.87
modinfo /root/i2c-ismt.ko | grep vermagic
```

If `insmod` reports an invalid module format, the module was built for a
different kernel/config — rebuild against the matching SDK.
