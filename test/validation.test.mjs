// Description: Offline tests for schema validation of the configuration file and the Notion ID normalizer

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateConfigResult, normalizeNotionId, describeGameProperties, GAME_PROPERTY_NOTION_TYPES } from '../js/utils.js';

const schema = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.schema.json'), 'utf8').replace(/^\uFEFF/, ''));

// A minimal valid config; helpers return mutated copies for the reject cases
const base = () => ({
	$schema: 'config.schema.json',
	notionDatabaseId: 'ab57a43aa82c48c9b4209807d679022a',
	updateInterval: 60000,
	steamAppIdProperty: 'Steam App ID',
	gameProperties: { storePage: { enabled: true, notionProperty: 'Store Page' } }
});
const without = (key) => { const c = base(); delete c[key]; return c; };
const accepts = (config) => validateConfigResult(config).errors.length === 0;

describe('config schema validation', () => {
	it('accepts a minimal valid config', () => {
		assert.ok(accepts(base()));
	});

	it('accepts optional top-level fields (data source ID, forceReset, alwaysUpdate, databasePath)', () => {
		const config = base();
		config.notionDataSourceId = 'ab57a43aa82c48c9b4209807d679022a';
		config.forceReset = true;
		config.alwaysUpdate = true;
		config.databasePath = 'D:/games/notion-db';
		assert.ok(accepts(config));
	});

	it('accepts a config without notionIntegrationKey (provided via env var or prompt at runtime)', () => {
		assert.ok(accepts(without('notionIntegrationKey')));
	});

	for (const key of ['notionDatabaseId', 'updateInterval', 'steamAppIdProperty', 'gameProperties']) {
		it(`rejects a config missing the required "${key}"`, () => {
			assert.ok(!accepts(without(key)));
		});
	}

	it('rejects an unknown top-level key (additionalProperties: false)', () => {
		const config = base();
		config.bogusKey = true;
		assert.ok(!accepts(config));
	});

	it('rejects an unknown key inside gameProperties', () => {
		const config = base();
		config.gameProperties.bogusProperty = { enabled: true };
		assert.ok(!accepts(config));
	});

	it('rejects an updateInterval below the one-minute minimum', () => {
		const config = base();
		config.updateInterval = 30000;
		assert.ok(!accepts(config));
	});

	it('rejects a notionDatabaseId that is not a valid Notion ID', () => {
		const config = base();
		config.notionDatabaseId = 'fd';
		assert.ok(!accepts(config));
	});

	it('accepts a dashed-UUID notionDatabaseId', () => {
		const config = base();
		config.notionDatabaseId = 'ab57a43a-a82c-48c9-b420-9807d679022a';
		assert.ok(accepts(config));
	});

	it('rejects an invalid reviewScore format', () => {
		const config = base();
		config.gameProperties.reviewScore = { enabled: true, format: 'not_a_format', notionProperty: 'Reviews' };
		assert.ok(!accepts(config));
	});

	it('requires steamUser when the tags property is enabled', () => {
		const config = base();
		config.gameProperties.tags = { enabled: true, notionProperty: 'Tags', tagLanguage: 'english' };
		assert.ok(!accepts(config), 'tags enabled without steamUser must be rejected');
		config.steamUser = { accountName: 'myacct' };
		assert.ok(accepts(config), 'tags enabled with steamUser must be accepted');
	});

	it('does not require steamUser when tags are absent or disabled', () => {
		assert.ok(accepts(base()), 'a config without a tags property must not require steamUser');
		const disabled = base();
		disabled.gameProperties.tags = { enabled: false, notionProperty: 'Tags', tagLanguage: 'english' };
		assert.ok(accepts(disabled), 'a disabled tags property must not require steamUser');
	});
});

describe('describeGameProperties', () => {
	it('covers every game property defined in the schema (so the reference cannot drift)', () => {
		const schemaKeys = Object.keys(schema.properties.gameProperties.properties).sort();
		const mapKeys = Object.keys(GAME_PROPERTY_NOTION_TYPES).sort();
		assert.deepEqual(mapKeys, schemaKeys, 'the Notion-type map must list every schema game property');
	});

	it('lists each default column name with its type, plus the Steam App ID column', () => {
		const out = describeGameProperties();
		assert.match(out, /gameName\s+Name\s+Title/);
		assert.match(out, /releaseDate\s+Release Date\s+Date/);
		assert.match(out, /tags\s+Tags\s+Multi-select/);
		assert.match(out, /Store Page\s+URL/);
		assert.match(out, /Steam App ID/);
	});
});

describe('normalizeNotionId', () => {
	const RAW = 'ab57a43aa82c48c9b4209807d679022a';

	it('accepts a bare 32-character hex ID', () => {
		assert.equal(normalizeNotionId(RAW), RAW);
	});

	it('accepts and normalizes a dashed UUID to the 32-character form', () => {
		assert.equal(normalizeNotionId('ab57a43a-a82c-48c9-b420-9807d679022a'), RAW);
	});

	it('extracts the ID from a pasted database URL with a title and query string', () => {
		assert.equal(normalizeNotionId(`https://www.notion.so/myworkspace/My-Games-${RAW}?v=abc123`), RAW);
	});

	it('lowercases an uppercase ID', () => {
		assert.equal(normalizeNotionId(RAW.toUpperCase()), RAW);
	});

	it('rejects too-short, empty or non-hex input', () => {
		assert.equal(normalizeNotionId('fd'), null);
		assert.equal(normalizeNotionId(''), null);
		assert.equal(normalizeNotionId('not-a-valid-id'), null);
		assert.equal(normalizeNotionId('g'.repeat(32)), null);
	});
});
