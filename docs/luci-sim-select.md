# SIM slot selection in LuCI

The SIM slot is a **General** field on the `wanb` interface:

```
Network → Interfaces → wanb → Edit → General
    Protocol          QMI Cellular
    Modem device      /dev/cdc-wdm0
    SIM slot          [ Bottom ▼ ]     ← added by this repo
    APN               sp.mb.com
    ...
```

Choosing Bottom/Top and pressing **Save & Apply** switches the hardware mux
(GPIO 38), power-cycles the modem, and restarts `wanb`.

## Why it needs a patch

LuCI's QMI form is a static JavaScript module:
`/www/luci-static/resources/protocol/qmi.js`. It has fields for device, APN,
auth, PDP, profile, etc., but no SIM-slot field because the slot is switched by
board GPIO, not by QMI.

The netifd protocol script `/lib/netifd/proto/qmi.sh` also has no concept of a
SIM slot.

This repository adds both:

1. **`patches/0002-luci-proto-qmi-sim-slot.patch`** — inserts a
   `form.ListValue` named `sim_slot` into the `general` tab, right after
   `Modem device`.
2. **`patches/0001-netifd-qmi-sim-slot.patch`** — declares the `sim_slot`
   option and calls `/usr/bin/lte-qmi-preup` at the start of
   `proto_qmi_setup()`.

The hook compares UCI `network.<if>.sim_slot` with `/etc/lte-sim-slot`. On a
change it runs `/usr/bin/lte-hw-setup --slot ...` (GPIO 38 + PCA9539 power
cycle) before the QMI setup continues. No change means no power cycle.

## Installing

The easy path is `scripts/install.sh`, which copies the patched files, keeps
`.orig` backups, and installs the hook.

Manual path:

```sh
cp /lib/netifd/proto/qmi.sh /lib/netifd/proto/qmi.sh.orig
cp files/lib/netifd/proto/qmi.sh /lib/netifd/proto/qmi.sh
cp /www/luci-static/resources/protocol/qmi.js /www/luci-static/resources/protocol/qmi.js.orig
cp files/www/luci-static/resources/protocol/qmi.js /www/luci-static/resources/protocol/qmi.js
cp scripts/lte-qmi-preup /usr/bin/ && chmod 755 /usr/bin/lte-qmi-preup
```

Then set the UCI option:

```sh
uci set network.wanb.sim_slot='bottom'
uci commit network
```

## The cache-busting trap

LuCI appends a version to every JS module:

```
/luci-static/resources/protocol/qmi.js?v=<luci-version>-<pkgs_update_time>
```

`pkgs_update_time` is the **mtime of `/lib/apk/db/installed`**, not the mtime
of `qmi.js`. Editing `qmi.js` therefore leaves the URL unchanged, and the
browser keeps using its cached copy. After installing/updating the JS, bump
the timestamp:

```sh
touch /lib/apk/db/installed
```

Then reload LuCI. A hard refresh or private window also works, but the version
bump is what makes normal reloads pick it up.

**Symptom:** the field is missing even though `qmi.js` on disk contains
`SIM slot`. **Fix:** `touch /lib/apk/db/installed`, reload LuCI.

## Verifying the patch

Check the served module:

```sh
curl -s http://192.168.2.1/luci-static/resources/protocol/qmi.js | grep 'SIM slot'
```

Check the versioned URL from the login page:

```sh
curl -s http://192.168.2.1/cgi-bin/luci/ | grep -o 'luci.js?v=[^"]*'
```

Check the UCI value:

```sh
uci get network.wanb.sim_slot
```

## Upgrades

`qmi.sh` and `qmi.js` are OpenWrt/LuCI package files. An `apk upgrade` that
updates `luci-proto-qmi` or `base-files` can overwrite them. The paths are in
`/etc/sysupgrade.conf` so a **sysupgrade** keeps them, but a package upgrade
does not.

If the field disappears after an upgrade:

```sh
# from the repo checkout on the router
cp files/lib/netifd/proto/qmi.sh /lib/netifd/proto/qmi.sh
cp files/www/luci-static/resources/protocol/qmi.js /www/luci-static/resources/protocol/qmi.js
cp scripts/lte-qmi-preup /usr/bin/ && chmod 755 /usr/bin/lte-qmi-preup
touch /lib/apk/db/installed
```

If the upstream `qmi.sh`/`qmi.js` changed enough that the copies no longer
apply, use the patches with `patch -p1` instead and re-check the hook.

## Alternative: Custom Commands

The installer also registers three **System → Custom Commands** entries:

| Name | Command |
|---|---|
| LTE: use bottom SIM (restart) | `/usr/bin/sim-select bottom` |
| LTE: use top SIM (restart) | `/usr/bin/sim-select top` |
| LTE: SIM / modem status | `/usr/bin/sim-select status` |

These are independent of the form patch and are useful for diagnostics.
