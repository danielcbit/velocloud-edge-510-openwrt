#!/bin/sh
# Install the OpenWrt packages used by this project.
# Run on the router (needs internet or a configured proxy).
set -eu

apk update
apk add \
	i2c-tools \
	usbutils \
	uqmi \
	kmod-usb-net-qmi-wwan \
	kmod-usb-serial-option \
	kmod-usb-serial-sierrawireless \
	mwan3 \
	luci-app-mwan3 \
	luci-proto-qmi \
	luci-app-commands

# If the router reaches the internet through a proxy, export it first, e.g.:
#   export http_proxy=http://192.168.1.10:8888 https_proxy=http://192.168.1.10:8888

echo "Packages installed. Reboot or continue with scripts/install.sh."
