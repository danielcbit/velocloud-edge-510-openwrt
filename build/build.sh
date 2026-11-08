#!/bin/sh
# Build the two out-of-tree kernel modules for OpenWrt 25.12.4 x86/64.
#
# Run inside the Linux/amd64 container from build/run.sh (or any Linux host
# with the build dependencies). It downloads the matching SDK once into
# .work/ and writes the modules to prebuilt/6.12.87/.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

SDK_VER=${SDK_VER:-25.12.4}
SDK_BASE="openwrt-sdk-${SDK_VER}-x86-64_gcc-14.3.0_musl.Linux-x86_64"
SDK_URL=${SDK_URL:-https://downloads.openwrt.org/releases/${SDK_VER}/targets/x86/64/${SDK_BASE}.tar.zst}
WORK=${WORK:-$ROOT/.work}
OUT=${OUT:-$ROOT/prebuilt/6.12.87}

mkdir -p "$WORK" "$OUT"

if [ ! -d "$WORK/$SDK_BASE" ]; then
	echo "== downloading SDK =="
	wget -O "$WORK/sdk.tar.zst" "$SDK_URL"
	echo "== extracting SDK =="
	tar --zstd -xf "$WORK/sdk.tar.zst" -C "$WORK"
fi

SDK="$WORK/$SDK_BASE"
KDIR="$SDK/build_dir/target-x86_64_musl/linux-x86_64/linux-6.12.87"
TC="$SDK/staging_dir/toolchain-x86_64_gcc-14.3.0_musl/bin/x86_64-openwrt-linux-musl-"

if [ ! -d "$KDIR" ] || [ ! -f "$KDIR/.config" ]; then
	echo "kernel tree not found or not prepared: $KDIR" >&2
	echo "Extract the SDK and, if needed, run: make -C $SDK target/linux/prepare" >&2
	exit 1
fi

echo "== kernel: $(make -s -C "$KDIR" kernelversion) =="

# --- i2c-ismt -------------------------------------------------------------
# OpenWrt's x86/64 kernel config leaves CONFIG_I2C_ISMT unset; pass it on the
# command line so the in-tree driver is built as a module.
echo "== building i2c-ismt.ko =="
make -C "$KDIR" ARCH=x86_64 CROSS_COMPILE="$TC" \
	M=drivers/i2c/busses CONFIG_I2C_ISMT=m modules
cp "$KDIR/drivers/i2c/busses/i2c-ismt.ko" "$OUT/"

# --- gpio-pcu -------------------------------------------------------------
echo "== building gpio-pcu.ko =="
mkdir -p "$KDIR/include/misc"
cp "$ROOT/vendor/gpio-pcu/velocloud.h" "$KDIR/include/misc/velocloud.h"
cp "$ROOT/vendor/gpio-pcu/gpio-pcu.c" "$KDIR/drivers/gpio/gpio-pcu.c"
patch -d "$KDIR" -p1 < "$ROOT/patches/0003-gpio-pcu-linux-6.12.patch"
grep -q 'obj-$(CONFIG_GPIO_PCU)' "$KDIR/drivers/gpio/Makefile" || \
	echo 'obj-$(CONFIG_GPIO_PCU) += gpio-pcu.o' >> "$KDIR/drivers/gpio/Makefile"
make -C "$KDIR" ARCH=x86_64 CROSS_COMPILE="$TC" \
	M=drivers/gpio CONFIG_GPIO_PCU=m modules
cp "$KDIR/drivers/gpio/gpio-pcu.ko" "$OUT/"

cd "$OUT"
sha256sum ./*.ko > SHA256SUMS
file ./*.ko
echo "== done: $OUT =="
