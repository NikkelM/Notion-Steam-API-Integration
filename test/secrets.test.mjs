// Description: Offline tests for runtime secret resolution (env var, config rejection, non-interactive error)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSecret } from '../js/utils.js';

describe('resolveSecret', () => {
	it('prefers an explicit flag value over the env var and trims it', async () => {
		process.env.NSI_TEST_SECRET = 'from-env';
		try {
			const value = await resolveSecret({ flagValue: '  from-flag  ', envVar: 'NSI_TEST_SECRET', promptMessage: 'x', label: 'test secret' });
			assert.equal(value, 'from-flag');
		} finally {
			delete process.env.NSI_TEST_SECRET;
		}
	});

	it('uses the environment variable when no flag is given, and trims it', async () => {
		process.env.NSI_TEST_SECRET = '  env-value  ';
		try {
			const value = await resolveSecret({ envVar: 'NSI_TEST_SECRET', promptMessage: 'x', label: 'test secret' });
			assert.equal(value, 'env-value');
		} finally {
			delete process.env.NSI_TEST_SECRET;
		}
	});

	it('rejects a secret stored in the config file', async () => {
		delete process.env.NSI_TEST_SECRET;
		await assert.rejects(
			resolveSecret({ envVar: 'NSI_TEST_SECRET', configValue: '  config-value  ', configField: 'notionIntegrationKey', promptMessage: 'x', label: 'Notion integration key' }),
			/must not be stored in the configuration file/
		);
	});

	it('throws when no secret is available in a non-interactive shell', async () => {
		delete process.env.NSI_TEST_SECRET;
		const originalIsTTY = process.stdin.isTTY;
		process.stdin.isTTY = false;
		try {
			await assert.rejects(
				resolveSecret({ envVar: 'NSI_TEST_SECRET', configValue: '', promptMessage: 'x', label: 'test secret' }),
				/test secret is required/
			);
		} finally {
			process.stdin.isTTY = originalIsTTY;
		}
	});
});
