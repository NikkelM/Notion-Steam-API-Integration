// Description: Verifies the init wizard assembles and writes a schema-valid config (prompts mocked)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateConfigResult } from '../js/utils.js';

const DB = 'ab57a43aa82c48c9b4209807d679022a';

test('the wizard writes a schema-valid configuration file', async (t) => {
	// Mock @inquirer/prompts so the wizard runs without a TTY, answering by prompt message
	t.mock.module('@inquirer/prompts', {
		namedExports: {
			input: async ({ message }) => {
				if (message.includes('database ID')) return DB;
				if (message.includes('data source ID')) return '';
				if (message.includes('holds the Steam App ID')) return 'Steam App ID';
				if (message.includes('in minutes')) return '1';
				if (message.includes('gameName')) return 'Name';
				if (message.includes('reviewScore')) return 'Review Score';
				if (message.includes('storePage')) return 'Store Page';
				return '';
			},
			select: async () => 'percentage',
			checkbox: async () => ['gameName', 'reviewScore', 'storePage'],
			confirm: async ({ message }) => {
				if (message.includes('page title')) return true;
				// re-update entries / start now / overwrite
				return false;
			},
			password: async () => ''
		}
	});

	const { runWizard } = await import('../js/wizard.js');

	const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-wiz-')), 'config.json');
	await runWizard(outputPath);

	assert.ok(fs.existsSync(outputPath), 'the wizard should write the config file');
	const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

	assert.ok(!('notionIntegrationKey' in written), 'the integration key must never be written to the config file');
	assert.equal(written.notionDatabaseId, DB);
	assert.equal(written.updateInterval, 60000);
	assert.equal(written.steamAppIdProperty, 'Steam App ID');
	assert.ok(!('steamUser' in written), 'no steamUser when tags are not selected');
	assert.deepEqual(Object.keys(written.gameProperties), ['gameName', 'reviewScore', 'storePage']);
	assert.equal(written.gameProperties.gameName.isPageTitle, true);
	assert.equal(written.gameProperties.reviewScore.format, 'percentage');
	assert.equal(validateConfigResult(written).errors.length, 0, 'the written config should validate against the schema');

	fs.rmSync(path.dirname(outputPath), { recursive: true, force: true });
});
