// Author: NikkelM
// Description: Notion integration that updates a database with information from the Steam API.

// Suppresses the warning about the fetch API being unstable
process.removeAllListeners('warning');

// ---------- Imports ----------

import { Client } from '@notionhq/client';
import SteamUser from 'steam-user';
import jsonschema from 'jsonschema';
import fs from 'fs';

// ---------- Setup ----------

// Utility for getting the directory of the current file
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ----- Config -----

try {
	let configFileName;
	if (fs.existsSync(__dirname + '/config.json')) {
		console.log("Loading configuration file \"config.json\"...");
		configFileName = 'config.json';
	} else if (fs.existsSync(__dirname + '/config.default.json')) {
		console.log("!!! No custom configuration file found! Loading default configuration file \"config.default.json\"...");
		configFileName = 'config.default.json';
	}
	var CONFIG = JSON.parse(fs.readFileSync(__dirname + '/' + configFileName));
} catch (error) {
	console.error("Error loading configuration file: " + error);
	process.exit(1);
}

// Validate the config file against the schema
console.log("Validating configuration file...\n");
try {
	const validator = new jsonschema.Validator();
	validator.validate(CONFIG, JSON.parse(fs.readFileSync(__dirname + '/config.schema.json')), { throwError: true });
} catch (error) {
	console.error("Error validating configuration file: " + error);
	process.exit(1);
}

// ----- Local Database -----

// Create the backend/utils directory if it doesn't exist
if (!fs.existsSync(__dirname + '/backend')) {
	fs.mkdirSync(__dirname + '/backend');
}
// Create an empty local store of all games in the database if it doesn't exist, or the user wants to reset it
if (!fs.existsSync(__dirname + '/backend/localDatabase.json') || CONFIG.forceReset) {
	console.log("Initializing/Resetting local database...");
	fs.writeFileSync(__dirname + '/backend/localDatabase.json', JSON.stringify({}, null, 2));
}

// A JSON Object to hold all games in the Notion database
let localDatabase = JSON.parse(fs.readFileSync(__dirname + '/backend/localDatabase.json'));

if (localDatabase.lastUpdatedAt) {
	console.log(`Local database was last updated at ${localDatabase.lastUpdatedAt} UTC.\n`);
} else {
	localDatabase.lastUpdatedAt = new Date(0).toISOString();
	console.log(localDatabase.lastUpdatedAt);
	console.log("Successfully initialized local database.\n");
}

// ---------- Main ----------

function main() {
	findChangesAndAddDetails().catch(console.error);
}

let steamClient = new SteamUser();

// We need to wait until we are logged into Steam before we can use the API
steamClient.on('loggedOn', (async () => {
	console.log("Successfully logged into Steam.\n");
	main();
}));

// ---------- Steam API ----------

console.log("Logging into Steam...");
steamClient.logOn();

// Gets app info directly from the Steam store API
// Does not offer all info that the SteamUser API does
async function getSteamAppInfoDirect(appId) {
	return await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`)
		.then(response => response.json())
		.then(data => {
			return data[appId].data;
		}
	);
}

// Gets app info from the SteamUser API
// Does not offer all info that the Steam store API does
async function getSteamAppInfoSteamUser(appId) {
	return new Promise(async (resolve) => {
		// Passing true as the third argument automatically requests access tokens, which are required for some apps
		let response = await steamClient.getProductInfo([appId], [], true);

		const result = response.apps[appId].appinfo;

		resolve(result);
	});
}

async function getSteamTagNames(storeTags) {
	const tagIds = Object.keys(storeTags).map(function (key) {
		return storeTags[key];
	});

	return new Promise(async (resolve) => {
		let response = await steamClient.getStoreTagNames("english", tagIds);

		const result = Object.keys(response.tags).map(function (key) {
			return response.tags[key].englishName;
		});

		resolve(result);
	});
}

// ---------- Notion API ----------

const notion = new Client({ auth: CONFIG.notionIntegrationKey });
const databaseId = CONFIG.notionDatabaseId;
const updateInterval = CONFIG.updateInterval;

async function findChangesAndAddDetails() {
	console.log("Looking for changes in Notion database...");

	// Update the last updated timestamp
	// Do this before fetching to make sure we don't miss changes made between now and fetching new properties below
	// Subtract 60 more seconds to make sure we have some buffer in case things get changed inbetween executions
	const newLastUpdatedAt = new Date(Date.now() - 60000).toISOString();
	let hadError = false;

	// Get the games currently in the database
	const newGamesInNotionDatabase = await getGamesFromDatabase();

	// Iterate over the current games and compare them to games in our local store (localDatabase)
	for (const [pageId, steamAppId] of Object.entries(newGamesInNotionDatabase)) {
		// If this game hasn't been seen before
		if (!(pageId in localDatabase)) {
			try {
				console.log(`New game found with Steam App ID: ${steamAppId}`);

				// Get info about this game from the Steam API
				const appInfoDirect = await getSteamAppInfoDirect(steamAppId);

				// Get info about this game from the SteamUser API
				const appInfoSteamUser = await getSteamAppInfoSteamUser(steamAppId).then((appInfoSteamUser) => { return appInfoSteamUser; });

				// The properties that will be passed to the Notion API call
				let properties = {};
				let cover = null;
				let icon = null;

				if (CONFIG.gameProperties.gameName?.enabled) {
					const gameTitle = appInfoDirect.name
					const propertyType = CONFIG.gameProperties.gameName.isPageTitle ? "title" : "rich_text";

					properties[CONFIG.gameProperties.gameName.notionProperty] = {
						[propertyType]: [
							{
								"type": "text",
								"text": {
									"content": gameTitle
								}
							}
						]
					}
				}

				if (CONFIG.gameProperties.coverImage) {
					// Get the URL for the cover image. Default value has a Steam theme
					const coverUrl = appInfoDirect.header_image ? appInfoDirect.header_image : "https://www.metal-hammer.de/wp-content/uploads/2022/11/22/19/steam-logo.jpg";

					cover = {
						"type": "external",
						"external": {
							"url": coverUrl
						}
					}
				}

				if (CONFIG.gameProperties.gameIcon) {
					// Get the URL for the game icon. Default value has a Steam theme
					// Game icon URL is not available through the Steam store API, so we have to use the SteamUser API
					const iconUrl = appInfoSteamUser.common.icon ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${steamAppId}/${appInfoSteamUser.common.icon}.jpg` : "https://iconarchive.com/download/i75918/martz90/circle/steam.ico";

					icon = {
						"type": "external",
						"external": {
							"url": iconUrl
						}
					}
				}

				if (CONFIG.gameProperties.releaseDate?.enabled) {
					// Get the release date. If no release date is available, set null
					// The releaseDate format from the Steam API is not in ISO format, so we use the SteamUser API instead
					let releaseDate;
					if (appInfoSteamUser.common.original_release_date) {
						releaseDate = new Date(parseInt(appInfoSteamUser.common.original_release_date) * 1000).toISOString();
					} else if (appInfoSteamUser.common.steam_release_date) {
						releaseDate = new Date(parseInt(appInfoSteamUser.common.steam_release_date) * 1000).toISOString();
					} else if (appInfoSteamUser.common.store_asset_mtime) {
						releaseDate = new Date(parseInt(appInfoSteamUser.common.store_asset_mtime) * 1000).toISOString();
					} else {
						releaseDate = null;
					}

					if (releaseDate && CONFIG.gameProperties.releaseDate.format == "date") {
						releaseDate = releaseDate.split("T")[0];
					}

					properties[CONFIG.gameProperties.releaseDate.notionProperty] = {
						"date": {
							"start": releaseDate
						}
					}
				}

				if (CONFIG.gameProperties.reviewScore?.enabled) {
					// Get the Steam user review score as a percentage
					// The reviewScore is not available through the Steam store API, so we have to use the SteamUser API instead
					const steamReviewScore = appInfoSteamUser.common.review_percentage ? parseInt(appInfoSteamUser.common.review_percentage) / 100 : null;

					properties[CONFIG.gameProperties.reviewScore.notionProperty] = {
						"number": steamReviewScore
					}
				}

				if (CONFIG.gameProperties.tags?.enabled) {
					// Parse the tags from the Steam API. If no tags are found, set a "No tags found" placeholder
					// The tags are not available through the Steam store API, so we have to use the SteamUser API instead
					const tags = appInfoSteamUser.common.store_tags ? await getSteamTagNames(appInfoSteamUser.common.store_tags).then((tags) => { return tags; }) : ["No tags found"];

					properties[CONFIG.gameProperties.tags.notionProperty] = {
						"multi_select": tags.map((tag) => {
							return {
								"name": tag
							}
						})
					}
				}

				// Update the game's page in the database with the new info
				await notion.pages.update({
					page_id: pageId,
					properties: properties,
					cover: cover,
					icon: icon
				});

				// Add this game to the local database
				// Do this after all the rest to make sure we don't add a game to the local database if something goes wrong
				localDatabase[pageId] = steamAppId;
			} catch (error) {
				console.error(error);
				hadError = true;
			}
		}
	}

	// Only update the last updated time if there were no errors during execution
	if (!hadError) {
		localDatabase.lastUpdatedAt = newLastUpdatedAt;
	}

	// Write the updated local store to disk
	fs.writeFileSync(__dirname + '/backend/localDatabase.json', JSON.stringify(localDatabase, null, 2));

	console.log(`Done looking for changes in Notion database. Looking again in ${updateInterval / 60000} minute(s).\n`);

	// Run this method again in `updateInterval` milliseconds
	setTimeout(main, updateInterval);
}

// Get a list of games in the Notion database that have the `Steam App ID` field set and were last edited after our last check. 
async function getGamesFromDatabase() {

	const games = {}

	async function getPageOfGames(cursor) {
		// While there are more pages left in the query, get pages from the database. 
		const currentPages = await queryDatabase(cursor);

		currentPages.results.forEach(page => games[page.id] = page.properties["Steam App ID"].number);

		if (currentPages.has_more) {
			await getPageOfGames(currentPages.next_cursor)
		}
	}

	await getPageOfGames();
	return games;
};

// Fetch all pages from the database that have been edited since we last accessed the database, and that have a Steam App ID set
async function queryDatabase(cursor) {
	return await notion.databases.query({
		database_id: databaseId,
		page_size: 100,
		start_cursor: cursor,
		filter: {
			"and": [
				{
					"timestamp": "last_edited_time",
					"last_edited_time": {
						"after": localDatabase.lastUpdatedAt
					}
				},
				{
					property: "Steam App ID",
					"number": {
						"is_not_empty": true
					}
				}
			]
		}
	});
}