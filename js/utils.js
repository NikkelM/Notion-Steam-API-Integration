import fs from 'fs';
import jsonschema from 'jsonschema';

// ---------- Exported variables ----------

export const CONFIG = getConfig();
export let localDatabase = loadLocalDatabase();
export const storeAPIRequired = isStoreAPIRequired();
export const steamUserAPIRequired = isSteamUserAPIRequired();

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

// Load the contents of the local database
function loadLocalDatabase() {
	// Create the backend directory if it doesn't exist
	if (!fs.existsSync('backend')) {
		fs.mkdirSync('backend');
	}

	// Create an empty local store of all games in the database if it doesn't exist, or the user wants to reset it
	if (!fs.existsSync('backend/localDatabase.json') || CONFIG.forceReset) {
		console.log("Initializing/Resetting local database...");
		fs.writeFileSync('backend/localDatabase.json', JSON.stringify({}, null, 2));
	}

	// A JSON Object to hold all games in the Notion database
	let localDatabase = JSON.parse(fs.readFileSync('backend/localDatabase.json'));

	if (!localDatabase.lastUpdatedAt) {
		localDatabase.lastUpdatedAt = new Date(0).toISOString();
		console.log("Successfully initialized local database.\n");
	}
	return localDatabase;
}

// ---------- Required APIs ----------

function isStoreAPIRequired() {
	const propertiesRequiringStoreAPI = [
		"coverImage",
		"gameDescription",
		"gamePrice"
	];
	return propertiesRequiringStoreAPI.some(property => Object.keys(CONFIG.gameProperties).includes(property));
}

function isSteamUserAPIRequired() {
	const propertiesRequiringSteamUserAPI = [
		"gameName",
		"releaseDate",
		"reviewScore",
		"tags",
		"gameIcon"
	];
	return propertiesRequiringSteamUserAPI.some(property => Object.keys(CONFIG.gameProperties).includes(property));
}