// Pure builder that turns parsed CLI options into a configuration object
// Kept separate from bin/cli.js so it can be unit tested, and it throws on invalid input so the CLI can report the error and exit

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InvalidArgumentError } from 'commander';

import { normalizeNotionId } from './utils.js';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = JSON.parse(fs.readFileSync(path.join(packageDir, 'config.schema.json'), 'utf8').replace(/^\uFEFF/, ''));

// The default set of game properties, taken straight from the schema so it stays in sync with it
const DEFAULT_GAME_PROPERTIES = schema.properties.gameProperties.default;

// The smallest interval the schema allows, in milliseconds
export const MIN_UPDATE_INTERVAL = schema.properties.updateInterval.minimum;

// Commander parser for --interval: an integer of at least the schema minimum (in milliseconds)
export function parseInterval(value) {
	const interval = Number.parseInt(value, 10);
	if (Number.isNaN(interval) || String(interval) !== String(value).trim() || interval < MIN_UPDATE_INTERVAL) {
		throw new InvalidArgumentError(`the update interval must be an integer of at least ${MIN_UPDATE_INTERVAL} (milliseconds).`);
	}
	return interval;
}

// True if any config-building flag was provided on the command line (so we build from flags instead of a config file)
export function usedBuildingFlags(command) {
	return ['databaseId', 'dataSourceId', 'interval', 'appIdProperty', 'steamAccountName', 'forceReset', 'alwaysUpdate']
		.some((name) => command.getOptionValueSource(name) === 'cli');
}

// Build a full configuration object from parsed CLI options
export function buildConfig(options) {
	if (!options.databaseId) {
		throw new Error('provide --database-id (the Notion database ID), or a config.json.');
	}
	const notionDatabaseId = normalizeNotionId(options.databaseId);
	if (!notionDatabaseId) {
		throw new Error(`"${options.databaseId}" is not a valid Notion database ID (expected a 32-character hex ID or dashed UUID).`);
	}

	const config = {
		$schema: 'config.schema.json',
		notionDatabaseId
	};
	if (options.dataSourceId) {
		const notionDataSourceId = normalizeNotionId(options.dataSourceId);
		if (!notionDataSourceId) {
			throw new Error(`"${options.dataSourceId}" is not a valid Notion data source ID (expected a 32-character hex ID or dashed UUID).`);
		}
		config.notionDataSourceId = notionDataSourceId;
	}
	config.updateInterval = options.interval ?? MIN_UPDATE_INTERVAL;
	config.steamAppIdProperty = options.appIdProperty ?? 'Steam App ID';
	if (options.forceReset) {
		config.forceReset = true;
	}
	if (options.alwaysUpdate) {
		config.alwaysUpdate = true;
	}
	if (options.dbPath) {
		config.databasePath = options.dbPath;
	}

	const accountName = options.steamAccountName?.trim();
	const gameProperties = structuredClone(DEFAULT_GAME_PROPERTIES);
	if (accountName) {
		config.steamUser = { accountName };
	} else {
		// Fetching tags requires a Steam login, so disable it in the quick flag-driven path unless an account name is given
		gameProperties.tags.enabled = false;
	}
	config.gameProperties = gameProperties;

	return config;
}
