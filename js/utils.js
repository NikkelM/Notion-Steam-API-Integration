import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import jsonschema from 'jsonschema';
import { Level } from 'level';
import { password, confirm } from '@inquirer/prompts';

// The package root, so the shipped config schema is found no matter the working directory
const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------- Exported variables ----------

// Live bindings, set once a config has been loaded (initConfig) and the database opened (openLocalDatabase)
export let CONFIG;
export let localDatabase;

// ---------- Saving a config ----------

// Write a flag-built config to disk for reuse, stripping any secret fields so they are never persisted
// Prompts before overwriting an existing file in an interactive shell and refuses to overwrite non-interactively
export async function saveConfigToFile(config, outputPath, secretFields = []) {
	const toWrite = { ...config };
	for (const field of secretFields) {
		delete toWrite[field];
	}
	if (fs.existsSync(outputPath)) {
		if (!process.stdin.isTTY) {
			throw new Error(`"${outputPath}" already exists - remove it, or pass --save-config <path> with a different path.`);
		}
		const overwrite = await confirm({ message: `"${outputPath}" already exists. Overwrite it?`, default: false });
		if (!overwrite) {
			console.log('The existing configuration file was not changed.');
			return;
		}
	}
	fs.writeFileSync(outputPath, JSON.stringify(toWrite, null, 2));
	console.log(`Wrote configuration to "${outputPath}".`);
}

// ---------- Config ----------

// Load a config from the given path, or discover ./config.json in the current directory, then validate it against the shipped schema
export function loadConfig(configPath) {
	let configFileName = configPath;
	if (!configFileName) {
		if (fs.existsSync('config.json')) {
			console.log("Loading configuration file \"config.json\"...");
			configFileName = 'config.json';
		} else {
			console.error("Error loading configuration file: no \"config.json\" found in the current directory. Run \"notion-steam-api-integration init\" to create one, or pass --config <path>.");
			process.exit(1);
		}
	} else if (!fs.existsSync(configFileName)) {
		console.error(`Error loading configuration file: no configuration file found at "${configFileName}".`);
		process.exit(1);
	} else {
		console.log(`Loading configuration file "${configFileName}"...`);
	}

	let config;
	try {
		config = JSON.parse(fs.readFileSync(configFileName, 'utf8').replace(/^\uFEFF/, ''));
	} catch (error) {
		console.error(`Error parsing configuration file "${configFileName}" as JSON: ${error.message ?? error}`);
		process.exit(1);
	}

	validateConfig(config);
	return config;
}

// Validate a config against the shipped schema, returning the raw jsonschema result
export function validateConfigResult(config) {
	const validator = new jsonschema.Validator();
	return validator.validate(config, JSON.parse(fs.readFileSync(path.join(packageDir, 'config.schema.json'), 'utf8').replace(/^\uFEFF/, '')));
}

// Validate a config against the schema, exiting the process on failure
export function validateConfig(config) {
	console.log("Validating configuration file...");
	const result = validateConfigResult(config);
	if (result.errors.length > 0) {
		console.error("Error validating configuration file: " + result.errors.map((error) => error.stack).join('; '));
		process.exit(1);
	}
	console.log("Configuration file validated successfully!\n");
}

// Activate a validated config in the live binding
export function initConfig(config) {
	CONFIG = config;
}

// ---------- Game property reference ----------

// The Notion column type each game property fills in, surfaced by the "properties" command and the wizard
// gameName is the page Title by default; reviewScore's type depends on its format; coverImage/gameIcon need no column
export const GAME_PROPERTY_NOTION_TYPES = {
	gameName: 'Title',
	coverImage: '(page cover)',
	gameIcon: '(page icon)',
	releaseDate: 'Date',
	reviewScore: 'Number',
	tags: 'Multi-select',
	gameDescription: 'Text',
	storePage: 'URL',
	gamePrice: 'Number',
	steamDeckCompatibility: 'Select',
	gameDevelopers: 'Multi-select',
	gamePublishers: 'Multi-select'
};

// A human-readable reference of the default Notion columns the integration fills in, built from the schema defaults
export function describeGameProperties() {
	const schema = JSON.parse(fs.readFileSync(path.join(packageDir, 'config.schema.json'), 'utf8').replace(/^\uFEFF/, ''));
	const gameProps = schema.properties.gameProperties.properties;
	const appIdColumn = schema.properties.steamAppIdProperty.default;

	const rows = Object.keys(GAME_PROPERTY_NOTION_TYPES).map((key) => ({
		key,
		column: gameProps[key]?.default?.notionProperty ?? '-',
		type: GAME_PROPERTY_NOTION_TYPES[key]
	}));

	const keyWidth = Math.max('Property'.length, ...rows.map((row) => row.key.length));
	const colWidth = Math.max('Default Notion column'.length, appIdColumn.length, ...rows.map((row) => row.column.length));

	const lines = [
		'Default Notion columns the integration fills in. Create these in your database, rename them in your config,',
		'or disable the ones you do not want. Column names are the defaults; the Notion type is what each column must be.',
		'',
		`${'Property'.padEnd(keyWidth)}  ${'Default Notion column'.padEnd(colWidth)}  Notion type`,
		`${'-'.repeat(keyWidth)}  ${'-'.repeat(colWidth)}  ${'-'.repeat(11)}`
	];
	for (const row of rows) {
		lines.push(`${row.key.padEnd(keyWidth)}  ${row.column.padEnd(colWidth)}  ${row.type}`);
	}
	lines.push('');
	lines.push(`Plus the column the integration watches: "${appIdColumn}" (Number) - set "steamAppIdProperty" to match its name.`);
	lines.push('Notes:');
	lines.push('  - gameName is the page Title by default; set "isPageTitle": false to write it to a Text column instead.');
	lines.push('  - reviewScore is a Number for the default "percentage" format (also total/positive/negative); "sentiment" needs a Select column and "positive/negative" a Text column.');
	lines.push('  - coverImage and gameIcon set the page cover and icon, so they need no column.');
	lines.push('  - tags requires a Steam login (see the README Security section).');
	return lines.join('\n');
}

// ---------- Notion IDs ----------

// A Notion database or data source ID is a UUID: 32 hex characters, or the 8-4-4-4-12 dashed form
// Accepts a bare ID or extracts it from a pasted database URL, returning the 32-character ID (or null if none is found)
export function normalizeNotionId(value) {
	const candidate = String(value).trim().split(/[?#]/)[0];
	const match = candidate.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
	return match ? match[1].replace(/-/g, '').toLowerCase() : null;
}

// ---------- Secrets ----------

export function envVarInstructions(envVar, value = '<value>') {
	return [
		`  Permanently (recommended; then open a new terminal):`,
		`    PowerShell:  setx ${envVar} "${value}"`,
		`    bash/zsh:    echo 'export ${envVar}="${value}"' >> ~/.profile`,
		`  For the current session only:`,
		`    PowerShell:  $env:${envVar} = '${value}'`,
		`    bash/zsh:    export ${envVar}='${value}'`
	].join('\n');
}

// Resolve a secret from an explicit flag, then the environment, then an interactive prompt
export async function resolveSecret({ flagValue, envVar, configValue, configField, promptMessage, label }) {
	if (configValue?.trim()) {
		throw new Error(`for your security, the ${label} must not be stored in the configuration file. Remove "${configField}" from your config, then set the ${envVar} environment variable instead:\n${envVarInstructions(envVar)}`);
	}
	const fromFlag = flagValue?.trim();
	if (fromFlag) {
		return fromFlag;
	}
	const fromEnv = process.env[envVar]?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	if (process.stdin.isTTY) {
		console.log(`Tip: to skip this prompt next time, set ${envVar} permanently ("setx ${envVar} <value>" on Windows, or add an export to your shell profile on macOS/Linux).`);
		const entered = await password({ message: promptMessage, mask: true, validate: (value) => value.trim() ? true : `The ${label} is required.` });
		return entered.trim();
	}
	throw new Error(`the ${label} is required - set the ${envVar} environment variable (or run in an interactive terminal to be prompted):\n${envVarInstructions(envVar)}`);
}

// ---------- Local database ----------

// The OS-native per-user data directory the local database lives in by default, so it is stable across working directories and survives package updates (unlike a folder in the current directory)
export function defaultDatabasePath() {
	const appDir = 'notion-steam-api-integration';
	if (process.platform === 'win32') {
		const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
		return path.join(base, appDir, 'db');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support', appDir, 'db');
	}
	const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
	return path.join(base, appDir, 'db');
}

// The database directory to use: an explicit databasePath from the config (or --db-path), else the OS-native default
export function resolveDatabasePath() {
	if (CONFIG.databasePath?.trim()) {
		return path.resolve(CONFIG.databasePath.trim());
	}
	return defaultDatabasePath();
}

// Open the on-disk LevelDB store and set the live binding
export async function openLocalDatabase() {
	const dbPath = resolveDatabasePath();

	// Point out a legacy ./db in the current directory that a pre-existing install may have created, so its state is not silently orphaned
	if (!CONFIG.databasePath?.trim()) {
		const legacyPath = path.resolve('db');
		if (legacyPath !== dbPath && fs.existsSync(legacyPath) && !fs.existsSync(dbPath)) {
			console.log(`Note: found an existing local database at "${legacyPath}" that is no longer used by default. It is now stored at "${dbPath}". Move the old folder there, or set "databasePath" (or --db-path), to keep your existing state. Continuing now with the database in the new path.`);
		}
	}

	console.log(`Loading local database from "${dbPath}"...`);
	fs.mkdirSync(dbPath, { recursive: true });
	const db = new Level(dbPath, { valueEncoding: 'json' });

	if (CONFIG.forceReset) {
		// Give the user time to cancel the reset before it happens
		console.log("Resetting local database in 10 seconds. Kill the process to cancel (using Ctrl+C on Windows or Cmd+C on Mac).");
		await new Promise(resolve => setTimeout(resolve, 10000));
		console.log("Resetting local database...\n");
		await db.clear();
	}

	// Initialize the lastUpdatedAt property if it doesn't exist
	try {
		await db.get('lastUpdatedAt');
	} catch (error) {
		try {
			await db.put('lastUpdatedAt', new Date(0).toISOString());
		} catch (error) {
			console.error(`Could not access database: ${error.message}. Perhaps another instance of the integration is already running?`);
			process.exit(1);
		}
		console.log("Successfully initialized local database.\n");
	}

	localDatabase = db;
	return db;
}

export async function addGameToLocalDatabase(pageId, steamAppId) {
	await localDatabase.put(pageId, steamAppId);
}

export async function addRefreshTokenToLocalDatabase(refreshToken) {
	await localDatabase.put("steamUserRefreshToken", refreshToken);
}

export async function getRefreshTokenFromLocalDatabase() {
	let refreshToken;
	try {
		refreshToken = await localDatabase.get("steamUserRefreshToken");
	} catch (error) {
		if (error.notFound) {
			console.log("No refresh token found in local database, prompting for login...");
			return null;
		} else {
			console.error(`Could not access database: ${error.message}. Perhaps another instance of the integration is already running?`);
			process.exit(1);
		}
	}
	// Decode the JWT to check its expiry
	if (refreshToken) {
		const parts = refreshToken.split('.');
		if (parts.length !== 3) {
			console.error("Invalid refresh token format.");
			return null;
		}
		const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp < now) {
			console.error("Refresh token expired.");
			return null;
		}
		return refreshToken;
	}
}

// ---------- Required APIs ----------

// Which upstream APIs are needed depends on which game properties are enabled in the active config

export function storeAPIRequired() {
	return !!(
		CONFIG.gameProperties.coverImage?.enabled ||
		CONFIG.gameProperties.releaseDate?.enabled ||
		CONFIG.gameProperties.gameDescription?.enabled ||
		CONFIG.gameProperties.gamePrice?.enabled ||
		CONFIG.gameProperties.gameDevelopers?.enabled ||
		CONFIG.gameProperties.gamePublishers?.enabled
	);
}

export function steamUserAPIRequired() {
	return !!(
		CONFIG.gameProperties.gameName?.enabled ||
		CONFIG.gameProperties.tags?.enabled ||
		CONFIG.gameProperties.gameIcon?.enabled ||
		CONFIG.gameProperties.coverImage?.enabled ||
		CONFIG.gameProperties.steamDeckCompatibility?.enabled
	);
}

export function steamUserLoginRequired() {
	return !!(CONFIG.gameProperties.tags?.enabled);
}

export function reviewAPIRequired() {
	return !!(CONFIG.gameProperties.reviewScore?.enabled);
}
