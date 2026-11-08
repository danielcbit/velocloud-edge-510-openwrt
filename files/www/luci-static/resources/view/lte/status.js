'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var POLL_INTERVAL = 10;

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
