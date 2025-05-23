import fs from 'fs';
import jsonschema from 'jsonschema';
import { Level } from 'level';

// ---------- Exported variables ----------

export const CONFIG = getConfig();
export const localDatabase = await loadLocalDatabase();
export const storeAPIRequired = isStoreAPIRequired();
export const steamUserAPIRequired = isSteamUserAPIRequired();
export const steamUserLoginRequired = isSteamUserLoginRequired();
export const reviewAPIRequired = isReviewAPIRequired();

// ---------- Config ----------

// Load the config file and validate it
function getConfig() {
	let configFileName;
	try {
		if (fs.existsSync('config.json')) {
			console.log("Loading configuration file \"config.json\"...");
			configFileName = 'config.json';
		} else if (fs.existsSync('config.default.json')) {
			console.log("!!! No custom configuration file found! Loading default configuration file \"config.default.json\"...");
			configFileName = 'config.default.json';
		}
	} catch (error) {
		console.error("Error loading configuration file: " + error);
		process.exit(1);
	}

	const CONFIG = JSON.parse(fs.readFileSync(configFileName));

	// Validate the config file
	console.log("Validating configuration file...\n");
	try {
		const validator = new jsonschema.Validator();
		validator.validate(CONFIG, JSON.parse(fs.readFileSync('config.schema.json')), { throwError: true });
	} catch (error) {
		console.error("Error validating configuration file: " + error);
		process.exit(1);
	}

	return CONFIG;
}

// ---------- Local Database ----------

async function loadLocalDatabase() {
	console.log("Loading local database...");
	const db = new Level('./db', { valueEncoding: 'json' });

	// Reset the local database if the user wants to
	if (CONFIG.forceReset) {
		// Set a timer of 10 seconds to give the user time to cancel the reset
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

	return db;
}

export async function addGameToLocalDatabase(pageId, steamAppId) {
	await localDatabase.put(pageId, steamAppId);
}

export async function addRefreshTokenToLocalDatabase(refreshToken) {
	await localDatabase.put("steamUserRefreshToken", refreshToken);
}

export async function getRefreshTokenFromLocalDatabase() {
	try {
		var refreshToken = await localDatabase.get("steamUserRefreshToken");
	} catch (error) {
		if (error.notFound) {
			console.log("No refresh token found in local database, prompting for login...");
			return null;
		} else {
			console.error(`Could not access database: ${error.message}. Perhaps another instance of the integration is already running?`);
			process.exit(1);
		}
	}
	// Decode the JWT
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

function isStoreAPIRequired() {
	return (
		CONFIG.gameProperties.coverImage?.enabled ||
		CONFIG.gameProperties.releaseDate?.enabled ||
		CONFIG.gameProperties.gameDescription?.enabled ||
		CONFIG.gameProperties.gamePrice?.enabled ||
		CONFIG.gameProperties.gameDevelopers?.enabled ||
		CONFIG.gameProperties.gamePublishers?.enabled
	)
}

function isSteamUserAPIRequired() {
	return (
		CONFIG.gameProperties.gameName?.enabled ||
		CONFIG.gameProperties.tags?.enabled ||
		CONFIG.gameProperties.gameIcon?.enabled ||
		CONFIG.gameProperties.coverImage?.enabled ||
		CONFIG.gameProperties.steamDeckCompatibility?.enabled
	);
}

function isSteamUserLoginRequired() {
	return (
		CONFIG.gameProperties.tags?.enabled
	);
}

function isReviewAPIRequired() {
	return (
		CONFIG.gameProperties.reviewScore?.enabled
	);
}
