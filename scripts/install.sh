#!/bin/sh
# Install the userspace side on a running OpenWrt 25.12.4 device.
# Run as root from a checkout copied to the router, e.g. /root/velocloud-repo.
#
# Environment overrides:
#   APN=sp.mb.com SIM_SLOT=bottom LAN_IP=192.168.2.1
set -eu

BASE=$(cd "$(dirname "$0")/.." && pwd)
APN=${APN:-sp.mb.com}
SIM_SLOT=${SIM_SLOT:-bottom}
LAN_IP=${LAN_IP:-192.168.2.1}

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
case "$SIM_SLOT" in bottom|top) ;; *) echo "SIM_SLOT must be bottom or top" >&2; exit 1 ;; esac

put() { cp "$1" "$2"; chmod "$3" "$2"; }

echo "== kernel $(uname -r) =="

echo "== kernel modules =="
put "$BASE/prebuilt/6.12.87/i2c-ismt.ko" /root/i2c-ismt.ko 644
put "$BASE/prebuilt/6.12.87/gpio-pcu.ko" /root/gpio-pcu.ko 644

echo "== scripts =="
put "$BASE/scripts/lte-hw-setup" /usr/bin/lte-hw-setup 755
put "$BASE/scripts/lte-qmi-preup" /usr/bin/lte-qmi-preup 755
put "$BASE/scripts/sim-select" /usr/bin/sim-select 755
put "$BASE/scripts/lte-watchdog" /usr/bin/lte-watchdog 755
put "$BASE/files/etc/init.d/lte-hw" /etc/init.d/lte-hw 755
put "$BASE/files/etc/rc.local" /etc/rc.local 755
/etc/init.d/lte-hw enable

echo "== patched netifd/LuCI files =="
[ -f /lib/netifd/proto/qmi.sh.orig ] || cp /lib/netifd/proto/qmi.sh /lib/netifd/proto/qmi.sh.orig
put "$BASE/files/lib/netifd/proto/qmi.sh" /lib/netifd/proto/qmi.sh 644
[ -f /www/luci-static/resources/protocol/qmi.js.orig ] || cp /www/luci-static/resources/protocol/qmi.js /www/luci-static/resources/protocol/qmi.js.orig
put "$BASE/files/www/luci-static/resources/protocol/qmi.js" /www/luci-static/resources/protocol/qmi.js 644

echo "== LuCI LTE status page =="
mkdir -p /www/luci-static/resources/view/lte /usr/share/luci/menu.d /usr/share/rpcd/acl.d
put "$BASE/files/usr/bin/lte-status" /usr/bin/lte-status 755
put "$BASE/files/www/luci-static/resources/view/lte/status.js" /www/luci-static/resources/view/lte/status.js 644
put "$BASE/files/usr/share/luci/menu.d/luci-app-lte.json" /usr/share/luci/menu.d/luci-app-lte.json 644
put "$BASE/files/usr/share/rpcd/acl.d/luci-app-lte.json" /usr/share/rpcd/acl.d/luci-app-lte.json 644

echo "== cron =="
mkdir -p /etc/crontabs
grep -q lte-watchdog /etc/crontabs/root 2>/dev/null || echo "*/5 * * * * /usr/bin/lte-watchdog" >> /etc/crontabs/root
/etc/init.d/cron enable 2>/dev/null || true

echo "== UCI =="
uci set network.lan=interface
uci set network.lan.device='eth0'
uci set network.lan.proto='static'
uci set network.lan.ipaddr="$LAN_IP"
uci set network.lan.netmask='255.255.255.0'

uci set network.wan=interface
uci set network.wan.device='eth1'
uci set network.wan.proto='dhcp'
uci set network.wan.metric='10'

uci set network.wanb=interface
uci set network.wanb.proto='qmi'
uci set network.wanb.device='/dev/cdc-wdm0'
uci set network.wanb.apn="$APN"
uci set network.wanb.auth='none'
uci set network.wanb.pdptype='ipv4'
uci set network.wanb.profile='1'
uci set network.wanb.metric='20'
uci set network.wanb.multipath='off'
uci set network.wanb.auto='1'
uci set network.wanb.sim_slot="$SIM_SLOT"

# Put wanb in the existing "wan" firewall zone (masquerade already on).
ZONE=$(uci show firewall 2>/dev/null | sed -n "s/^firewall\.\([^.]*\)\.name='wan'$/\1/p" | head -1)
if [ -z "$ZONE" ]; then
	ZONE=$(uci add firewall zone)
	uci set firewall.$ZONE.name='wan'
	uci set firewall.$ZONE.input='REJECT'
	uci set firewall.$ZONE.output='ACCEPT'
	uci set firewall.$ZONE.forward='DROP'
fi
uci set firewall.$ZONE.network='wan wan6 wanb'
uci set firewall.$ZONE.masq='1'
uci set firewall.$ZONE.mtu_fix='1'

FWD=$(uci show firewall 2>/dev/null | sed -n "s/^firewall\.\([^.]*\)\.src='lan'$/\1/p" | head -1)
if [ -z "$FWD" ]; then
	FWD=$(uci add firewall forwarding)
	uci set firewall.$FWD.src='lan'
	uci set firewall.$FWD.dest='wan'
fi

# mwan3: eth1 primary (metric 1), LTE backup (metric 2).
uci set mwan3.wan=interface
uci set mwan3.wan.enabled='1'
uci set mwan3.wan.track_ip='1.0.0.1' '1.1.1.1'
uci set mwan3.wan.family='ipv4'
uci set mwan3.wan.reliability='2'
uci set mwan3.wanb=interface
uci set mwan3.wanb.enabled='1'
uci set mwan3.wanb.track_ip='1.0.0.1' '1.1.1.1'
uci set mwan3.wanb.family='ipv4'
uci set mwan3.wanb.reliability='1'

uci set mwan3.wan_m1_w3=member
uci set mwan3.wan_m1_w3.interface='wan'
uci set mwan3.wan_m1_w3.metric='1'
uci set mwan3.wan_m1_w3.weight='3'
uci set mwan3.wanb_m2_w2=member
uci set mwan3.wanb_m2_w2.interface='wanb'
uci set mwan3.wanb_m2_w2.metric='2'
uci set mwan3.wanb_m2_w2.weight='2'
uci set mwan3.balanced=policy
uci set mwan3.balanced.use_member='wan_m1_w3' 'wanb_m2_w2'
uci set mwan3.default_rule_v4=rule
uci set mwan3.default_rule_v4.dest_ip='0.0.0.0/0'
uci set mwan3.default_rule_v4.use_policy='balanced'
uci set mwan3.default_rule_v4.family='ipv4'

# LuCI Custom Commands shortcuts (optional but useful).
uci set luci.sim_bottom=command
uci set luci.sim_bottom.name='LTE: use bottom SIM (restart)'
uci set luci.sim_bottom.command='/usr/bin/sim-select bottom'
uci set luci.sim_top=command
uci set luci.sim_top.name='LTE: use top SIM (restart)'
uci set luci.sim_top.command='/usr/bin/sim-select top'
uci set luci.sim_status=command
uci set luci.sim_status.name='LTE: SIM / modem status'
uci set luci.sim_status.command='/usr/bin/sim-select status'

uci commit

echo "$SIM_SLOT" > /etc/lte-sim-slot

echo "== sysupgrade keep list =="
for p in /usr/bin/lte-hw-setup /usr/bin/sim-select /usr/bin/lte-qmi-preup \
	/usr/bin/lte-watchdog /etc/init.d/lte-hw /etc/lte-sim-slot \
	/etc/rc.d/S19lte-hw /root/gpio-pcu.ko /root/i2c-ismt.ko \
	/lib/netifd/proto/qmi.sh /www/luci-static/resources/protocol/qmi.js \
	/usr/bin/lte-status /www/luci-static/resources/view/lte/status.js \
	/usr/share/luci/menu.d/luci-app-lte.json \
	/usr/share/rpcd/acl.d/luci-app-lte.json; do
	grep -qxF "$p" /etc/sysupgrade.conf 2>/dev/null || echo "$p" >> /etc/sysupgrade.conf
done

# Force LuCI to re-fetch its static modules.
touch /lib/apk/db/installed

/etc/init.d/rpcd restart 2>/dev/null || true
/etc/init.d/uhttpd restart 2>/dev/null || true
/etc/init.d/cron restart 2>/dev/null || true
/etc/init.d/firewall reload 2>/dev/null || true

echo "== applying SIM slot and starting wanb =="
/usr/bin/lte-hw-setup --slot "$SIM_SLOT" || true
ifup wanb 2>/dev/null || true
/etc/init.d/mwan3 restart 2>/dev/null || true

echo
echo "Done. Reboot to validate the full boot path, then run scripts/verify.sh."
