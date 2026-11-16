#!/usr/bin/env node
// bin/watch-remote.mjs — the off-box watcher's loop body: probe the declared public hostnames (probe-public.mjs),
// compare with the last run, and notify on a CHANGE, never on every tick. Run it from a scheduler on a machine
// that hosts none of the targets; a watcher on the watched box cannot report its own absence.
//
//   CW_REGISTRY=monitor/private/watch.json node bin/watch-remote.mjs
//
// Every host is unreachable at once ⇒ this machine is offline, not the fleet: reported as `watcher-offline`,
// never as N outages (an unknown is not a failure). A host that stays bad is re-notified every
// CW_WATCH_REALERT_HOURS (default 6) so a long outage is not one forgotten toast.
//
// Exit: 0 every host as declared · 1 a host is not · 2 the watcher itself could not run or is offline.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeAll, targetsFromRegistry } from './probe-public.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const statePath = () => resolve(process.env.CW_WATCH_STATE || join(homedir(), '.commitwork', 'watch-state.json'));
const logPath = () => resolve(process.env.CW_WATCH_LOG || join(homedir(), '.commitwork', 'watch.log.jsonl'));
const registryFile = () => resolve(process.env.CW_REGISTRY || join(HERE, '..', 'monitor', 'private', 'watch.json'));
const realertMs = () => Number(process.env.CW_WATCH_REALERT_HOURS || 6) * 3_600_000;

/**
 * Pure: the next state and the notifications owed, from the previous state, this run's rows and the clock.
 * A host's state is its probe state ('ok' or a failure kind); 'watcher-offline' replaces all of them when
 * every host failed to connect, and leaves each host's last known state untouched.
 */
export function decide(prev, rows, nowMs, { realert = 6 * 3_600_000 } = {}) {
	const hosts = { ...(prev?.hosts ?? {}) };
	const notes = [];
	const offline = rows.length > 0 && rows.every((r) => r.state === 'unreachable' || r.state === 'timeout');
	if (offline) {
		if (!prev?.offlineSince) notes.push({ kind: 'offline', text: 'watcher offline: no declared host answered; this machine may have lost its connection' });
		return { next: { hosts, offlineSince: prev?.offlineSince ?? nowMs, lastRunAt: nowMs }, notes, offline: true };
	}
	if (prev?.offlineSince) notes.push({ kind: 'online', text: 'watcher back online' });
	for (const r of rows) {
		const was = hosts[r.hostname];
		const state = r.state;
		const detail = r.ok ? `${r.status}` : (r.detail || `${r.state}${r.status ? ` ${r.status}` : ''}`);
		if (!was) {
			hosts[r.hostname] = { state, since: nowMs, lastNotifiedAt: r.ok ? null : nowMs };
			if (!r.ok) notes.push({ kind: 'bad', host: r.hostname, text: `${r.hostname}: ${detail}` });
			continue;
		}
		if (was.state !== state) {
			hosts[r.hostname] = { state, since: nowMs, lastNotifiedAt: nowMs };
			notes.push(r.ok
				? { kind: 'recovered', host: r.hostname, text: `${r.hostname} recovered (${detail}) after ${minutes(nowMs - was.since)}` }
				: { kind: 'bad', host: r.hostname, text: `${r.hostname}: ${detail}` });
			continue;
		}
		if (!r.ok && (was.lastNotifiedAt == null || nowMs - was.lastNotifiedAt >= realert)) {
			hosts[r.hostname] = { ...was, lastNotifiedAt: nowMs };
			notes.push({ kind: 'still-bad', host: r.hostname, text: `${r.hostname} still not as declared for ${minutes(nowMs - was.since)}: ${detail}` });
		}
	}
	return { next: { hosts, offlineSince: null, lastRunAt: nowMs }, notes, offline: false };
}

const minutes = (ms) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/** Desktop notification on this platform; returns false when there is no way to show one. */
export function notify(title, body) {
	if (process.env.CW_WATCH_NOTIFY === '0') return false;
	const os = platform();
	if (os === 'win32') {
		const esc = (s) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
		const xml = `<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual></toast>`;
		const ps = [
			'[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
			'[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
			'$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
			'$x.LoadXml($env:CW_TOAST_XML)',
			'$app = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
			'[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))',
		].join('; ');
		const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
			env: { ...process.env, CW_TOAST_XML: xml },
			windowsHide: true,
			timeout: 20_000,
		});
		return r.status === 0;
	}
	if (os === 'darwin') {
		const q = (s) => JSON.stringify(s);
		return spawnSync('osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`], { timeout: 20_000 }).status === 0;
	}
	return spawnSync('notify-send', [title, body], { timeout: 20_000 }).status === 0;
}

function readState() {
	try {
		return JSON.parse(readFileSync(statePath(), 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return null;
		throw new Error(`watch state unreadable at ${statePath()}: ${e.message}`);
	}
}

async function main() {
	const nowMs = Number(process.env.CW_NOW_MS) || Date.now();
	const reg = registryFile();
	if (!existsSync(reg)) throw new Error(`watch list not found: ${reg}`);
	const targets = targetsFromRegistry(reg);
	if (!targets.length) throw new Error(`watch list ${reg} declares no public hostnames`);

	let { rows } = await probeAll(targets);
	// One confirmation round for the failures: a single dropped packet is not an incident.
	const failing = rows.filter((r) => !r.ok);
	if (failing.length && failing.length < rows.length) {
		await new Promise((r) => setTimeout(r, Number(process.env.CW_WATCH_CONFIRM_MS ?? 20_000)));
		const again = await probeAll(targets.filter((t) => failing.some((f) => f.hostname === t.hostname)));
		const byHost = new Map(again.rows.map((r) => [r.hostname, r]));
		rows = rows.map((r) => byHost.get(r.hostname) ?? r);
	}

	const prev = readState();
	const { next, notes, offline } = decide(prev, rows, nowMs, { realert: realertMs() });
	writeAtomic(statePath(), JSON.stringify(next, null, '\t') + '\n', { mkdir: true });
	mkdirSync(dirname(logPath()), { recursive: true });
	appendFileSync(
		logPath(),
		JSON.stringify({ at: new Date(nowMs).toISOString(), offline, rows: rows.map(({ hostname, state, status, ms }) => ({ hostname, state, status, ms })), notes: notes.map((n) => n.text) }) + '\n',
	);

	for (const n of notes) {
		const title = n.kind === 'recovered' || n.kind === 'online' ? 'commitwork watch: recovered' : 'commitwork watch: ALERT';
		const shown = notify(title, n.text);
		console.log(`${shown ? 'notified' : 'NOT notified'}: ${n.text}`);
	}
	const bad = rows.filter((r) => !r.ok);
	console.log(offline ? 'watcher offline' : `${rows.length - bad.length} of ${rows.length} as declared`);
	return offline ? 2 : bad.length ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
	main().then((code) => process.exit(code), (e) => {
		console.error(`watch-remote: ${e.message}`);
		notify('commitwork watch: cannot run', e.message);
		process.exit(2);
	});
}
