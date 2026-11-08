# Prebuilt kernel modules

These `.ko` files were built against the **OpenWrt 25.12.4 x86/64** kernel
**6.12.87** with the SDK toolchain `x86_64-openwrt-linux-musl-gcc-14.3.0`.

| Module | Purpose |
|---|---|
| `i2c-ismt.ko` | Intel iSMT SMBus controller (`i2c-1`); exposes the PCA9539 at `0x74` |
| `gpio-pcu.ko` | VeloCloud C2000 PCU GPIO driver; provides `gpiochip0`/`gpiochip32` and GPIO 38 (SIM mux) |

`SHA256SUMS` contains the checksums.

**Kernel match is mandatory.** These modules will fail to load on a different
kernel version (`vermagic` mismatch) or a different config. Rebuild them with
`../build/build.sh` if you use another OpenWrt release.

Install to the router:

```sh
scp prebuilt/6.12.87/*.ko root@192.168.2.1:/root/
```

The init script loads them from `/root/`.
