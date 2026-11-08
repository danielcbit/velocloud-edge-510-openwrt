# Using the Edge 510 as a MikroTik backup WAN

The Edge 510 runs OpenWrt and NATs its LAN (`192.168.2.1/24`) out through LTE.
A MikroTik router can treat that LAN as a **backup WAN**: plug the Edge LAN
into a free MikroTik port, give that port a backup default route, and keep the
primary ISP at a lower distance.

```
MikroTik LAN ── primary WAN (ISP)
     │
     └── ether1  ──── Edge 510 GE1/eth0 (192.168.2.1/24)
                         └── LTE (wanb) ── Internet
```

Leave the Edge 510’s **GE2/eth1 disconnected**; it must use LTE, not the
MikroTik, as its uplink.

## Assumptions

- RouterOS 7.
- `ether1` is free (not the primary WAN and not needed in the LAN bridge).
- The MikroTik LAN is **not** `192.168.2.0/24` (the Edge LAN).
- The Edge LAN DHCP pool is `192.168.2.100–.249`, so `.2` is safe for a static
  address.

## MikroTik configuration

```rsc
# 1. Free ether1 if it is currently a bridge/LAN port
/interface bridge port remove [find interface=ether1]

# 2. Remove any old address/DHCP client on ether1
/ip address remove [find interface=ether1]
/ip dhcp-client remove [find interface=ether1]

# 3. Put ether1 in the WAN interface list
/interface list member add list=WAN interface=ether1 \
    comment="VeloCloud LTE backup"

# 4. Static address on the Edge LAN
/ip address add address=192.168.2.2/24 interface=ether1 \
    comment="VeloCloud LTE backup"

# 5. Backup default route (primary must be distance 1)
/ip route add dst-address=0.0.0.0/0 gateway=192.168.2.1 \
    distance=2 check-gateway=ping comment="LTE backup via VeloCloud"

# 6. NAT is inherited if the existing rule is out-interface-list=WAN.
#    Otherwise add:
# /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade \
#     comment="NAT to VeloCloud LTE backup"

# 7. Use resolvers reachable through either path
/ip dns set servers=1.1.1.1,8.8.8.8
```

### DHCP instead of a static address

```rsc
/ip dhcp-client add interface=ether1 add-default-route=yes \
    default-route-distance=2 use-peer-dns=no \
    comment="VeloCloud LTE backup"
```

Use `use-peer-dns=no`: the Edge’s DNS forwards over LTE, so using it while the
primary WAN is up would burn LTE data.

## Failover behaviour

- Primary default route: **distance 1**.
- Edge/LTE default route: **distance 2**.
- When the primary interface goes down, its route disappears and the LTE route
  becomes active.
- When the primary returns, its distance-1 route takes over automatically.

If the primary link stays up but the ISP is unreachable, use recursive routing:

```rsc
# Replace <PRIMARY_GATEWAY> with the ISP gateway (or PPPoE interface)
/ip dhcp-client set [find interface=<PRIMARY_WAN>] add-default-route=no

/ip route add dst-address=1.1.1.1/32 gateway=<PRIMARY_GATEWAY> scope=10 \
    comment="primary probe"
/ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 distance=1 \
    check-gateway=ping comment="primary default"

/ip route add dst-address=8.8.8.8/32 gateway=192.168.2.1 scope=10 \
    comment="backup probe"
/ip route add dst-address=0.0.0.0/0 gateway=8.8.8.8 distance=2 \
    check-gateway=ping comment="LTE backup default"
```

This also disables the backup route when LTE itself is down.

## Firewall

Adding `ether1` to the `WAN` interface list is enough if the existing input and
NAT rules use `in-interface-list=WAN` / `out-interface-list=WAN`. If the rules
name the primary WAN explicitly, duplicate them for `ether1`.

New connections from `LAN` to `WAN` are allowed by the normal RouterOS defconf
(no matching drop for LAN→WAN new traffic); return traffic is
`established,related`.

## Verification

```rsc
/interface ethernet print where name=ether1
/ip route print detail where dst-address=0.0.0.0/0
/ping 192.168.2.1 count=3
/ping 1.1.1.1 count=3
/tool traceroute 1.1.1.1 count=1
```

The first hop of the traceroute should be `192.168.2.1` when the backup is
active. Disable the primary WAN to test failover, then re-enable it.

From the Edge:

```sh
ifstatus wanb
mwan3 status
/usr/bin/lte-status
```
