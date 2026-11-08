'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var POLL_INTERVAL = 30;

function dash(v) {
	return (v === null || v === undefined || v === '') ? '–' : v;
}

function unit(v, u) {
	return (v === null || v === undefined || v === '') ? '–' : '%s %s'.format(v, u);
}

function bytes(v) {
	if (v === null || v === undefined || v === '')
		return '–';

	var n = Number(v);
	var u = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ];
	var i = 0;

	while (n >= 1024 && i < u.length - 1) {
		n /= 1024;
		i++;
	}

	return (i ? n.toFixed(2) : n) + ' ' + u[i];
}

function signalLabel(rsrp) {
	if (rsrp === null || rsrp === undefined)
		return E('span', { 'class': 'label' }, '–');

	var cls = 'label label-danger';
	if (rsrp >= -80)
		cls = 'label label-success';
	else if (rsrp >= -100)
		cls = 'label label-warning';

	return E('span', { 'class': cls }, '%s dBm'.format(rsrp));
}

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '38%' }, label),
		E('td', { 'class': 'td left' }, value)
	]);
}

function section(title, rows) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		E('table', { 'class': 'table' }, rows)
	]);
}

var HISTORY_KEY = 'luci-lte-history';
var HISTORY_MAX = 90;

function emptyHistory() {
	return { rsrp: [], rsrq: [], snr: [], last: 0 };
}

function loadHistory() {
	try {
		var h = JSON.parse(window.localStorage.getItem(HISTORY_KEY));
		if (h && Array.isArray(h.rsrp) && Array.isArray(h.rsrq) && Array.isArray(h.snr) &&
		    h.last && (Date.now() - h.last) < 3600000)
			return {
				rsrp: h.rsrp.slice(-HISTORY_MAX),
				rsrq: h.rsrq.slice(-HISTORY_MAX),
				snr: h.snr.slice(-HISTORY_MAX),
				last: h.last
			};
	} catch (e) {}
	return emptyHistory();
}

function saveHistory(h) {
	try {
		window.localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
	} catch (e) {}
}

function sparkline(values, min, max, color) {
	if (!values || values.length < 1)
		return '';

	var w = 320, h = 64, pad = 4;
	var innerW = w - pad * 2, innerH = h - pad * 2;
	var pts = [];

	for (var i = 0; i < values.length; i++) {
		var x = pad + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
		var v = Math.min(max, Math.max(min, values[i]));
		var y = pad + (1 - (v - min) / (max - min)) * innerH;
		pts.push(x.toFixed(1) + ',' + y.toFixed(1));
	}

	var grid = '';
	for (var g = 1; g < 4; g++) {
		var gy = (pad + (g / 4) * innerH).toFixed(1);
		grid += '<line x1="' + pad + '" y1="' + gy + '" x2="' + (w - pad) + '" y2="' + gy +
			'" stroke="#e3e3e3" stroke-width="1"/>';
	}

	var dot = '';
	if (values.length === 1) {
		var p = pts[0].split(',');
		dot = '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + color + '"/>';
	}

	return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" ' +
		'style="width:100%;height:64px;display:block;background:#fafafa;border:1px solid #ddd;border-radius:4px">' +
		grid + dot +
		'<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color +
		'" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>' +
		'</svg>';
}

function graphCard(title, current, values, min, max, color, unit) {
	var el = E('div', { 'style': 'flex:1 1 220px;min-width:200px;margin:4px 0 8px 0' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px' }, [
			E('strong', {}, title),
			E('span', { 'style': 'color:#555' }, current != null ? '%s %s'.format(current, unit) : '–')
		]),
		E('div', { 'style': 'display:flex;justify-content:space-between;font-size:80%;color:#888;margin-bottom:2px' }, [
			E('span', {}, '%s %s'.format(min, unit)),
			E('span', {}, '%s %s'.format(max, unit))
		])
	]);

	var box = E('div');
	box.innerHTML = sparkline(values, min, max, color);
	el.appendChild(box);

	return el;
}

return view.extend({
	load: function() {
		return this.fetch().catch(function(e) {
			return { error: e.message || String(e) };
		});
	},

	fetch: function() {
		return fs.exec('/usr/bin/lte-status', []).then(function(res) {
			if (res.code !== 0)
				throw new Error(res.stderr || _('Unable to read LTE status'));
			return JSON.parse(res.stdout);
		});
	},

	render: function(data) {
		var body = E('div', { 'id': 'lte-status-live' });
		var self = this;

		this.update(body, data);

		poll.add(function() {
			return self.fetch().then(function(d) {
				self.update(body, d);
			}).catch(function() {});
		}, POLL_INTERVAL);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('LTE status')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Live status of the EM7455 LTE modem via QMI. Refreshes every %d seconds.').format(POLL_INTERVAL)),
			body
		]);
	},

	update: function(body, d) {
		body.innerHTML = '';

		if (d.error) {
			body.appendChild(E('div', { 'class': 'alert-message warning' }, d.error));
			return;
		}

		var self = this;
		this.history = this.history || loadHistory();

		[ 'rsrp', 'rsrq', 'snr' ].forEach(function(k) {
			var v = d[k];
			if (typeof v === 'number' && isFinite(v)) {
				self.history[k].push(v);
				while (self.history[k].length > HISTORY_MAX)
					self.history[k].shift();
			}
		});

		this.history.last = Date.now();
		saveHistory(this.history);

		var updated = d.timestamp ? new Date(d.timestamp * 1000).toLocaleString() : '–';

		body.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-map-descr' }, _('Updated: %s').format(updated)),
			E('div', { 'class': 'cbi-section-node' }, [
				signalLabel(d.rsrp),
				' ',
				E('strong', {}, d.operator || _('Unknown operator')),
				d.plmn ? ' (%s)'.format(d.plmn) : ''
			])
		]));

		body.appendChild(section(_('Signal'), [
			row(_('RSRP'), signalLabel(d.rsrp)),
			row(_('RSRQ'), unit(d.rsrq, 'dB')),
			row(_('RSSI'), unit(d.rssi, 'dBm')),
			row(_('SNR'), unit(d.snr, 'dB')),
			row(_('TX power'), unit(d.tx_power, 'dBm'))
		]));

		body.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Signal history')),
			E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px' }, [
				graphCard(_('RSRP'), d.rsrp, this.history.rsrp, -130, -50, '#1565c0', 'dBm'),
				graphCard(_('RSRQ'), d.rsrq, this.history.rsrq, -20, 0, '#ef6c00', 'dB'),
				graphCard(_('SNR'), d.snr, this.history.snr, -10, 30, '#2e7d32', 'dB')
			]),
			E('div', { 'class': 'cbi-map-descr' },
				_('Last %d samples at 30 s intervals; history is kept in this browser.').format(HISTORY_MAX))
		]));

		body.appendChild(section(_('Network'), [
			row(_('Operator'), dash(d.operator)),
			row(_('PLMN'), dash(d.plmn)),
			row(_('Registration'), dash(d.registration) + (d.roaming === true ? ' / roaming' : '')),
			row(_('Radio'), dash(d.radio)),
			row(_('Service'), dash(d.service_status))
		]));

		body.appendChild(section(_('Cell'), [
			row(_('Band'), d.band != null ? 'B%s'.format(d.band) : '–'),
			row(_('Frequency'), unit(d.frequency, 'MHz')),
			row(_('Channel'), dash(d.channel)),
			row(_('PCI'), dash(d.pci)),
			row(_('TAC'), dash(d.tac)),
			row(_('eNodeB'), dash(d.enodeb)),
			row(_('Cell ID'), dash(d.cell_id)),
			row(_('Duplex'), dash(d.duplex))
		]));

		body.appendChild(section(_('Data'), [
			row(_('Data status'), dash(d.data_status)),
			row(_('IPv4'), dash(d.ipv4)),
			row(_('Gateway'), dash(d.gateway)),
			row(_('DNS'), [d.dns1, d.dns2].filter(function(x) { return x; }).join(', ') || '–'),
			row(_('MTU'), dash(d.mtu)),
			row(_('Interface'), d.up === true ? _('up') : _('down')),
			row(_('Uptime'), d.uptime != null ? '%d s'.format(d.uptime) : '–'),
			row(_('RX / TX'), '%s / %s'.format(bytes(d.rx_bytes), bytes(d.tx_bytes)))
		]));

		body.appendChild(section(_('SIM'), [
			row(_('SIM state'), dash(d.sim_state)),
			row(_('PIN1'), dash(d.pin1)),
			row(_('Selected slot'), dash(d.slot))
		]));
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
