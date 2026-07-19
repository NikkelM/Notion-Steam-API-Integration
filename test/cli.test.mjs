// Description: Subprocess tests for the CLI command wrappers (bin/cli.js) and the config-loading guards (no network, no credentials)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'cli.js');

// A minimal valid config (no tags, so no Steam login is required)
const validConfig = {
	$schema: 'config.schema.json',
	notionDatabaseId: 'ab57a43aa82c48c9b4209807d679022a',
	updateInterval: 60000,
	steamAppIdProperty: 'Steam App ID',
	gameProperties: { storePage: { enabled: true, notionProperty: 'Store Page' } }
};

// Run the CLI in a throwaway working directory, optionally seeding files first
// Credential env vars are cleared so a local setup cannot affect the tests and a valid config stops at "key required"
function runCli(args, files = {}) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-cli-'));
	try {
		for (const [name, contents] of Object.entries(files)) {
			fs.writeFileSync(path.join(cwd, name), contents);
		}
		const result = spawnSync(process.execPath, [cli, ...args], {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, NOTION_INTEGRATION_KEY: '', STEAM_PASSWORD: '' }
		});
		return { code: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') };
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
}

describe('CLI command wrappers', () => {
	it('--version prints the package version', () => {
		const { code, out } = runCli(['--version']);
		assert.equal(code, 0);
		assert.match(out.trim(), /^\d+\.\d+\.\d+/);
	});

	it('--help lists every command', () => {
		const { code, out } = runCli(['--help']);
		assert.equal(code, 0);
		for (const command of ['run', 'init']) {
			assert.match(out, new RegExp(command));
		}
	});

	it('an unknown command exits non-zero', () => {
		const { code } = runCli(['definitelyNotACommand']);
		assert.notEqual(code, 0);
	});
});

describe('CLI configuration guards', () => {
	it('exits with a friendly message when no config file is found', () => {
		const { code, out } = runCli([]);
		assert.equal(code, 1);
		assert.match(out, /no "config\.json" found/);
	});

	it('reports a malformed config file as invalid JSON', () => {
		const { code, out } = runCli([], { 'config.json': '{ not valid json ' });
		assert.equal(code, 1);
		assert.match(out, /Error parsing configuration file/);
	});

	it('rejects an unknown top-level config key', () => {
		const config = { ...validConfig, bogusKey: true };
		const { code, out } = runCli([], { 'config.json': JSON.stringify(config) });
		assert.equal(code, 1);
		assert.match(out, /Error validating configuration file/);
	});

	it('strips a UTF-8 BOM before parsing the config', () => {
		// A BOM-prefixed valid config must parse and validate, then stop at the missing Notion key (not a load error)
		const { code, out } = runCli([], { 'config.json': '\uFEFF' + JSON.stringify(validConfig) });
		assert.equal(code, 1);
		assert.doesNotMatch(out, /Error parsing configuration file/);
		assert.match(out, /Notion integration key is required/);
	});

	it('errors when --config points at a nonexistent file', () => {
		const { code, out } = runCli(['run', '--config', 'nope.json']);
		assert.equal(code, 1);
		assert.match(out, /no configuration file found/);
	});
});
