// Interactive configuration builder for the CLI (`notion-steam-api-integration init`)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { input, select, checkbox, confirm } from '@inquirer/prompts';

import { validateConfig, envVarInstructions, normalizeNotionId, GAME_PROPERTY_NOTION_TYPES } from './utils.js';

// Read the review-score formats straight from the schema so the prompt stays in sync with it
const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = JSON.parse(fs.readFileSync(path.join(packageDir, 'config.schema.json'), 'utf8').replace(/^\uFEFF/, ''));
const MIN_UPDATE_INTERVAL = schema.properties.updateInterval.minimum;
const REVIEW_FORMATS = schema.properties.gameProperties.properties.reviewScore.properties.format.oneOf.map((option) => option.const);

// The selectable game properties, in the order they are offered, with the default Notion property name for each
const PROPERTY_CHOICES = [
	{ value: 'gameName', name: 'gameName - the game title (page title)', notionProperty: 'Name', checked: true },
	{ value: 'coverImage', name: 'coverImage - the store header image (page cover)', checked: true },
	{ value: 'gameIcon', name: 'gameIcon - the library icon (page icon)', checked: true },
	{ value: 'releaseDate', name: 'releaseDate - the release date', notionProperty: 'Release Date', checked: true },
	{ value: 'reviewScore', name: 'reviewScore - the user review score', notionProperty: 'Review Score', checked: true },
	{ value: 'gameDescription', name: 'gameDescription - the short store description', notionProperty: 'Description', checked: true },
	{ value: 'storePage', name: 'storePage - the store page URL', notionProperty: 'Store Page', checked: true },
	{ value: 'gamePrice', name: 'gamePrice - the base price', notionProperty: 'Price', checked: true },
	{ value: 'steamDeckCompatibility', name: 'steamDeckCompatibility - the Steam Deck compatibility Score', notionProperty: 'Steam Deck Compatibility', checked: true },
	{ value: 'gameDevelopers', name: 'gameDevelopers - the developer(s)', notionProperty: 'Developers', checked: true },
	{ value: 'gamePublishers', name: 'gamePublishers - the publisher(s)', notionProperty: 'Publishers', checked: true },
	{ value: 'tags', name: 'tags - the store tags (requires a Steam login)', notionProperty: 'Tags', checked: false }
];

const DEFAULT_COVER_IMAGE = schema.properties.gameProperties.properties.coverImage.properties.default.default;
const DEFAULT_GAME_ICON = schema.properties.gameProperties.properties.gameIcon.properties.default.default;

// Prompt for the Notion property name a value should be written to, showing the Notion column type it must be
function askNotionProperty(propertyKey, defaultName) {
	const notionType = GAME_PROPERTY_NOTION_TYPES[propertyKey];
	const typeHint = notionType ? ` (Notion column type: ${notionType})` : '';
	return input({
		message: `  ${propertyKey}: Notion column name${typeHint}:`,
		default: defaultName,
		validate: (value) => value.trim() ? true : 'A Notion property name is required.'
	});
}

export async function runWizard(outputPath = 'config.json') {
	// If a configuration file already exists, confirm overwriting up front so the user can abort early
	if (fs.existsSync(outputPath)) {
		const overwrite = await confirm({ message: `"${outputPath}" already exists. Overwrite it?`, default: false });
		if (!overwrite) {
			console.log('Aborted - the existing configuration file was not changed.');
			return;
		}
	}

	console.log('\nYour Notion integration key is read from the NOTION_INTEGRATION_KEY environment variable and is never written to the configuration file.');
	if (process.env.NOTION_INTEGRATION_KEY?.trim()) {
		console.log('NOTION_INTEGRATION_KEY is set - it will be used automatically.\n');
	} else {
		console.log('NOTION_INTEGRATION_KEY is not set - you will be asked for your key when the integration runs, which works fine.');
		console.log('To avoid entering it every time, set it as an environment variable and re-run:');
		console.log(envVarInstructions('NOTION_INTEGRATION_KEY') + '\n');
	}

	const notionDatabaseId = await input({
		message: 'Notion database ID (from the database URL):',
		validate: (value) => normalizeNotionId(value) ? true : 'Enter a valid Notion database ID - a 32-character ID (or dashed UUID) from the database URL.'
	});

	const notionDataSourceId = await input({
		message: 'Notion data source ID (optional - only needed if the database has multiple data sources):',
		default: '',
		validate: (value) => !value.trim() || normalizeNotionId(value) ? true : 'Enter a valid Notion data source ID, or leave it empty.'
	});

	const steamAppIdProperty = await input({
		message: 'Name of the Notion property that holds the Steam App ID:',
		default: 'Steam App ID',
		validate: (value) => value.trim() ? true : 'A property name is required.'
	});

	const intervalMinutes = await input({
		message: 'How often should the database be checked for changes, in minutes?',
		default: String(MIN_UPDATE_INTERVAL / 60000),
		validate: (value) => {
			const minutes = Number.parseFloat(value);
			return (!Number.isNaN(minutes) && minutes * 60000 >= MIN_UPDATE_INTERVAL) ? true : `Enter a number of minutes of at least ${MIN_UPDATE_INTERVAL / 60000}.`;
		}
	});

	const alwaysUpdate = await confirm({ message: 'Also re-update entries that were edited by someone other than the integration (even if already known)?', default: false });

	// Choose which properties to fetch; at least one is required
	const selected = await checkbox({
		message: 'Which game properties should be fetched?',
		required: true,
		choices: PROPERTY_CHOICES.map(({ value, name, checked }) => ({ value, name, checked }))
	});

	const gameProperties = {};
	for (const choice of PROPERTY_CHOICES) {
		if (!selected.includes(choice.value)) { continue; }
		gameProperties[choice.value] = await buildPropertyConfig(choice);
	}

	// Assemble the config, keeping a natural key order
	const config = {
		$schema: 'config.schema.json',
		notionDatabaseId: normalizeNotionId(notionDatabaseId)
	};
	if (notionDataSourceId.trim()) {
		config.notionDataSourceId = normalizeNotionId(notionDataSourceId);
	}
	config.updateInterval = Math.round(Number.parseFloat(intervalMinutes) * 60000);
	config.steamAppIdProperty = steamAppIdProperty.trim();
	config.alwaysUpdate = alwaysUpdate;

	// Fetching tags requires a Steam login, so collect the account name (the password is provided via STEAM_PASSWORD)
	if (selected.includes('tags')) {
		console.log('\nFetching tags requires a Steam login. Your password is read from the STEAM_PASSWORD environment variable and is never written to the configuration file.');
		if (process.env.STEAM_PASSWORD?.trim()) {
			console.log('STEAM_PASSWORD is set - it will be used automatically.\n');
		} else {
			console.log('STEAM_PASSWORD is not set - you will be asked for your password when the integration runs, which works fine.');
			console.log('To avoid entering it every time, set it as an environment variable and re-run:');
			console.log(envVarInstructions('STEAM_PASSWORD') + '\n');
		}
		const accountName = await input({ message: 'Steam account name:', validate: (value) => value.trim() ? true : 'A Steam account name is required to fetch tags.' });
		config.steamUser = { accountName: accountName.trim() };
	}

	config.gameProperties = gameProperties;

	// Sanity-check the assembled configuration against the schema before writing it
	validateConfig(config);

	fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
	console.log(`\nWrote configuration to "${outputPath}".`);

	const runNow = await confirm({ message: 'Start the integration with this configuration now?', default: false });
	if (runNow) {
		// The core (and its steam-user dependency) is imported lazily so writing a config never loads it
		const { run } = await import('./notionSteamIntegration.js');
		await run(config);
	}
}

// Build the config object for a single selected game property, prompting for any per-property options
async function buildPropertyConfig(choice) {
	switch (choice.value) {
		case 'coverImage':
			return { enabled: true, default: DEFAULT_COVER_IMAGE };
		case 'gameIcon':
			return { enabled: true, default: DEFAULT_GAME_ICON };
		case 'gameName': {
			const notionProperty = (await askNotionProperty('gameName', choice.notionProperty)).trim();
			const isPageTitle = await confirm({ message: '  gameName: is this the page title?', default: true });
			return { enabled: true, notionProperty, isPageTitle };
		}
		case 'reviewScore': {
			const format = await select({
				message: '  reviewScore: which format?',
				choices: REVIEW_FORMATS.map((value) => ({ value, name: value })),
				default: 'percentage'
			});
			const notionProperty = (await askNotionProperty('reviewScore', choice.notionProperty)).trim();
			return { enabled: true, format, notionProperty };
		}
		case 'tags': {
			const notionProperty = (await askNotionProperty('tags', choice.notionProperty)).trim();
			const tagLanguage = (await input({ message: '  tags: tag language:', default: 'english', validate: (value) => value.trim() ? true : 'A tag language is required.' })).trim();
			return { enabled: true, notionProperty, tagLanguage };
		}
		default: {
			const notionProperty = (await askNotionProperty(choice.value, choice.notionProperty)).trim();
			return { enabled: true, notionProperty };
		}
	}
}
