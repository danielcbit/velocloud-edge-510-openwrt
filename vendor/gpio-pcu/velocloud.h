#ifndef _MISC_VELOCLOUD_H
#define _MISC_VELOCLOUD_H

#include <linux/dmi.h>

/*
 * Minimal stand-in for the vendor <misc/velocloud.h>.
 *
 * The vendor gpio-pcu driver only needs the board enum and two symbols that
 * the vendor vc-board module exports. We do not build vc-board under OpenWRT,
 * so the driver is compiled with a stub vc_dmi pointing at VC_EDGE510.
 */
enum {
	VC_EDGE500 = 0,
	VC_EDGE510,
	VC_EDGE520,
	VC_EDGE540,
	VC_EDGE520B,
	VC_EDGE540B,
	VC_N_BOARDS,
	VC_NONE = VC_N_BOARDS
};

extern struct dmi_system_id *vc_dmi;
extern int vc_bbfw;

#endif
