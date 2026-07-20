// Description: Offline tests for the flag-driven config builder (js/cliConfig.js), the CLI flag-driven path, and saveConfigToFile

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig, parseInterval, MIN_UPDATE_INTERVAL } from '../js/cliConfig.js';
import { validateConfigResult, saveConfigToFile, defaultDatabasePath, resolveDatabasePath, initConfig } from '../js/utils.js';

const DB = 'ab57a43aa82c48c9b4209807d679022a';
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'cli.js');
const isValid = (config) => validateConfigResult(config).errors.length === 0;

describe('parseInterval', () => {
	it('accepts an integer at or above the schema minimum', () => {
		assert.equal(parseInterval(String(MIN_UPDATE_INTERVAL)), MIN_UPDATE_INTERVAL);
		assert.equal(parseInterval('120000'), 120000);
	});

	it('rejects values below the minimum or non-integers', () => {
		assert.throws(() => parseInterval('30000'), /at least 60000/);
		assert.throws(() => parseInterval('abc'), /at least 60000/);
		assert.throws(() => parseInterval('60000.5'), /at least 60000/);
	});
});

describe('buildConfig', () => {
	it('builds a schema-valid config from just a database ID (tags disabled, no Steam login needed)', () => {
		const config = buildConfig({ databaseId: DB });
		assert.equal(config.notionDatabaseId, DB);
		assert.equal(config.updateInterval, MIN_UPDATE_INTERVAL);
		assert.equal(config.steamAppIdProperty, 'Steam App ID');
		assert.equal(config.gameProperties.tags.enabled, false);
		assert.ok(!('steamUser' in config), 'no steamUser without an account name');
		assert.ok(!('notionIntegrationKey' in config), 'the secret must never be built into the config');
		assert.ok(isValid(config));
	});

	it('enables tags and sets steamUser when an account name is given', () => {
		const config = buildConfig({ databaseId: DB, steamAccountName: 'myacct' });
		assert.equal(config.gameProperties.tags.enabled, true);
		assert.deepEqual(config.steamUser, { accountName: 'myacct' });
		assert.ok(isValid(config));
	});

	it('normalizes a dashed database and data source ID', () => {
		const config = buildConfig({ databaseId: 'ab57a43a-a82c-48c9-b420-9807d679022a', dataSourceId: 'ab57a43a-a82c-48c9-b420-9807d679022a' });
		assert.equal(config.notionDatabaseId, DB);
		assert.equal(config.notionDataSourceId, DB);
	});

	it('threads interval, app-id property, the boolean flags and the database path', () => {
		const config = buildConfig({ databaseId: DB, interval: 300000, appIdProperty: 'AppID', forceReset: true, alwaysUpdate: true, dbPath: 'D:/games/notion-db' });
		assert.equal(config.updateInterval, 300000);
		assert.equal(config.steamAppIdProperty, 'AppID');
		assert.equal(config.forceReset, true);
		assert.equal(config.alwaysUpdate, true);
		assert.equal(config.databasePath, 'D:/games/notion-db');
		assert.ok(isValid(config));
	});

	it('throws without a database ID', () => {
		assert.throws(() => buildConfig({}), /--database-id/);
	});

	it('throws on an invalid database ID', () => {
		assert.throws(() => buildConfig({ databaseId: 'fd' }), /not a valid Notion database ID/);
	});

	it('throws on an invalid data source ID', () => {
		assert.throws(() => buildConfig({ databaseId: DB, dataSourceId: 'nope' }), /not a valid Notion data source ID/);
	});
});

describe('CLI flag-driven mode', () => {
	function runCli(args) {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-flags-'));
		try {
			const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NOTION_INTEGRATION_KEY: '', STEAM_PASSWORD: '' } });
			return { code: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') };
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	}

	it('runs entirely from flags with no config.json (reaching the missing Notion key)', () => {
		const { code, out } = runCli(['--database-id', DB]);
		assert.equal(code, 1);
		assert.match(out, /Notion integration key is required/);
	});

	it('reports an invalid database ID provided via flags', () => {
		const { code, out } = runCli(['--database-id', 'not-valid']);
		assert.notEqual(code, 0);
		assert.match(out, /not a valid Notion database ID/);
	});
});

describe('database path resolution', () => {
	it('defaultDatabasePath is an absolute per-user path ending in a "db" folder', () => {
		const p = defaultDatabasePath();
		assert.ok(path.isAbsolute(p), 'the default database path should be absolute');
		assert.equal(path.basename(p), 'db');
		assert.ok(p.includes('notion-steam-api-integration'), 'the default path should live under an app-named directory');
	});

	it('resolveDatabasePath prefers an explicit databasePath from the config', () => {
		initConfig({ databasePath: 'D:/games/notion-db' });
		assert.equal(resolveDatabasePath(), path.resolve('D:/games/notion-db'));
	});

	it('resolveDatabasePath falls back to the OS-native default when databasePath is unset or blank', () => {
		initConfig({});
		assert.equal(resolveDatabasePath(), defaultDatabasePath());
		initConfig({ databasePath: '   ' });
		assert.equal(resolveDatabasePath(), defaultDatabasePath());
	});
});

describe('saveConfigToFile', () => {
	it('writes a validated flag-built config and strips secret fields', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-save-'));
		const out = path.join(dir, 'config.json');
		try {
			const config = { ...buildConfig({ databaseId: DB }), notionIntegrationKey: 'secret_should_not_persist' };
			await saveConfigToFile(config, out, ['notionIntegrationKey']);
			const written = JSON.parse(fs.readFileSync(out, 'utf8'));
			assert.ok(!('notionIntegrationKey' in written), 'the secret must never be written to disk');
			assert.equal(written.notionDatabaseId, DB);
			assert.equal(validateConfigResult(written).errors.length, 0);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses to overwrite an existing file non-interactively', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-save-'));
		const out = path.join(dir, 'config.json');
		try {
			fs.writeFileSync(out, '{"existing":true}');
			const originalIsTTY = process.stdin.isTTY;
			process.stdin.isTTY = false;
			try {
				await assert.rejects(saveConfigToFile(buildConfig({ databaseId: DB }), out), /already exists/);
			} finally {
				process.stdin.isTTY = originalIsTTY;
			}
			assert.equal(fs.readFileSync(out, 'utf8'), '{"existing":true}', 'the existing file must be left untouched');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
