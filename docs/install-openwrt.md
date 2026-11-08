# Installing OpenWrt on the Edge 510-LTE

This is the **destructive** part. Read it fully before writing anything.

The procedure keeps `sda1`–`sda4` untouched (BIOS boot, GRUB, both stock root
partitions) and installs OpenWrt into the spare `sda5`, with `sda6` as data.
The stock GRUB menu remains the recovery path.

## 1. Back up the stock system

Do this from the stock OS (or a live USB) before touching the eMMC.

```sh
# partition images (store them on another machine)
dd if=/dev/sda1 of=/backup/sda1_bios.img bs=1M
dd if=/dev/sda2 of=/backup/sda2_boot.img bs=1M
dd if=/dev/sda3 of=/backup/sda3_root0.img bs=1M
dd if=/dev/sda4 of=/backup/sda4_root1.img bs=1M

# stock configuration and vendor LTE scripts
tar -C / -czf /backup/stock-etc-root-opt.tar.gz etc root opt
```

Also collect:

- `lsblk`, `blkid`, `fdisk -l /dev/sda`
- `lspci -nn`, `lsusb -t`
- `/proc/cmdline`, `dmesg`
- the stock `cell-ctl` / `ltectrl.sh` scripts and modem profiles
- a BIOS dump if you have a reliable method (not required for this build)

The repository deliberately does **not** ship BIOS dumps, disk images, SIM
identifiers or credentials.

## 2. Prepare the OpenWrt media

Download the official **25.12.4 x86/64** images:

- `openwrt-25.12.4-x86-64-generic-ext4-rootfs.img.gz`
- `openwrt-25.12.4-x86-64-generic-kernel.bin`

The rootfs image is a bare ext4 filesystem (~109 MB uncompressed). `sda5` is
1 GiB, so write it and grow the filesystem.

From the stock OS (or a Linux live environment):

```sh
# sda5 = OpenWrt rootfs
gunzip -c openwrt-...-generic-ext4-rootfs.img.gz | dd of=/dev/sda5 bs=1M
resize2fs /dev/sda5

# sda2 = stock GRUB partition; put the kernel next to the existing boot files
mkdir -p /mnt/boot
mount /dev/sda2 /mnt/boot
cp openwrt-...-generic-kernel.bin /mnt/boot/boot/vmlinuz

# sda6 = data
mkfs.ext4 -L rootfs_data /dev/sda6
```

Get the root partition UUID:

```sh
blkid /dev/sda5
# /dev/sda5: UUID="..." TYPE="ext4" PARTUUID="ac7a2231-b9df-483d-ae2b-66b7e04b0758"
```

## 3. Partition layout used here

| Part | Size | Stock role | After |
|---|---|---|---|
| `sda1` | 1 MiB | BIOS boot | untouched |
| `sda2` | 18 MiB | GRUB `/boot` | stock GRUB + OpenWrt menu entry + `vmlinuz` |
| `sda3` | 1 GiB | stock root0 | untouched (recovery) |
| `sda4` | 1 GiB | stock root1 | untouched (recovery) |
| `sda5` | 1 GiB | spare root | OpenWrt ext4 rootfs |
| `sda6` | 4.1 GiB | data | ext4, label `rootfs_data` |

## 4. Disable the watchdog in GRUB

The stock GRUB has a vendor command that disables the PIC watchdog. Add it at
the top of `grub.cfg` (on `sda2`, in `boot/grub/grub.cfg`; mounted as
`/boot/boot/grub/grub.cfg` when `sda2` is on `/boot`):

```
vc wdt 0
set timeout=5

menuentry "OpenWRT" {
    set root=(hd0,gpt5)
    linux /boot/vmlinuz root=PARTUUID=AC7A2231-B9DF-483D-AE2B-66B7E04B0758 rootfstype=ext4 rootwait console=ttyS1,115200n8
}
```

Keep the stock entries (`Latest Velocloud Image`, `Force Velocloud Root1`, …)
unchanged. Save a copy of the original as `grub.cfg.stock`.

`vc wdt 0` was verified by leaving the box in fail-safe for **430 s** with no
reset. Do not skip this: without it the board resets after a few minutes.

## 5. First boot

- Connect the console to **ttyS1, 115200 8N1**.
- The OpenWrt entry is the default (menu index 0).
- First boot configures `br-lan`/`eth0`; set a static LAN address if you want
  the same layout as here:

```
config interface 'lan'
    option device 'eth0'
    option proto 'static'
    option ipaddr '192.168.2.1'
    option netmask '255.255.255.0'
```

- Set a root password and install your SSH key. The examples in this repo use
  `root@192.168.2.1` only as a placeholder.

## 6. Recovery

At the GRUB menu press a key within the timeout and choose a stock entry.
The stock OS remains fully bootable. Keep its root password/SSH access known
before you start.

## 7. After OpenWrt boots

Continue with [lte.md](lte.md) to build/install the missing kernel modules and
bring up the modem, and [luci-sim-select.md](luci-sim-select.md) for the SIM
slot field.

## Notes

- OpenWrt's `sysupgrade` replaces the root filesystem. The files listed in
  `/etc/sysupgrade.conf` are preserved; the installer adds the LTE stack there.
- A full reflash still needs the helpers and `/root/*.ko` copied back.
- The stock GRUB timeout is short (5 s). Keep a serial console attached while
  experimenting.
