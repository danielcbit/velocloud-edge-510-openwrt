#!/bin/sh
# Print the LTE/SIM state used for troubleshooting.
D=/dev/cdc-wdm0

echo "kernel:   $(uname -r)"
echo "slot:     $(cat /etc/lte-sim-slot 2>/dev/null || echo unknown)"
echo "gpio38:   $(cat /sys/class/gpio/gpio38/value 2>/dev/null || echo unavailable)"
echo "pci drv:  $(readlink -f /sys/bus/pci/devices/0000:00:1f.0/driver 2>/dev/null)"
echo "ismt:     $(i2cdetect -l 2>/dev/null | awk '/iSMT/{print; exit}')"
echo "modem:    $(lsusb 2>/dev/null | grep -i '1199:9071' || echo 'not found')"
echo "wdm:      $(ls -l /dev/cdc-wdm0 2>/dev/null || echo 'not found')"
echo

echo "--- UIM ---"
uqmi -d "$D" -t 3000 --uim-get-sim-state 2>&1 | head -14
echo "--- serving ---"
uqmi -d "$D" -t 3000 --get-serving-system 2>&1 | head -10
echo "--- signal ---"
uqmi -d "$D" -t 3000 --get-signal-info 2>&1 | head -10
echo "--- data ---"
uqmi -d "$D" -t 3000 --get-data-status 2>&1
echo "--- wanb ---"
ifstatus wanb 2>/dev/null | grep -E '"up"|"pending"|l3_device|"code"|cid_4|pdh_4'
echo "--- addresses/routes ---"
ip -4 addr show wwan0 2>/dev/null | grep inet
ip route 2>/dev/null | head -8
echo "--- ping through LTE ---"
ping -c 2 -W 3 -I wwan0 1.1.1.1 2>&1 | tail -3
echo "--- mwan3 ---"
mwan3 status 2>/dev/null | sed -n '1,8p'
