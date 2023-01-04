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

if (!localDatabase.lastUpdatedAt) {
	localDatabase.lastUpdatedAt = new Date(0).toISOString();
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
// For some apps, the API does not return any info, even though the app exists
async function getSteamAppInfoDirect(appId, retryCount = 0) {
	const result = await fetch(`https://store.steampowered.com/api/appdetails/?appids=${appId}`)
		.then(response => response.json())
		.then(data => {
			if (data && data[appId]?.success) {
				return data[appId].data;
			}
			return null;
		}
		);

	// If the request failed, we try again
	if (!result && retryCount < 3) {
		retryCount++;
		console.log(`Failed to get app info for app ${appId} from the Steam store API. Retrying in ${retryCount} second(s)...`);
		await new Promise(r => setTimeout(r, retryCount * 1000));
		return getSteamAppInfoDirect(appId, retryCount);
	} else if (retryCount >= 3) {
		console.log(`Failed to get app info for app ${appId} from the Steam store API. Some info may still be available using the SteamUser API.`);
		return {};
	}

	return result;
}

// Gets app info from the SteamUser API
// Does not offer all info that the Steam store API does
async function getSteamAppInfoSteamUser(appIds) {
	console.log(`Getting app info from SteamUser API for ${appIds.length} games...`);

	return new Promise(async (resolve) => {
		// Passing true as the third argument automatically requests access tokens, which are required for some apps
		let response = await steamClient.getProductInfo(appIds, [], true);

		let result = {};
		for (const key of Object.keys(response.apps)) {
			result[key] = response.apps[key].appinfo.common;
		}

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
	// If we encounter an error or would hit the Steam API request limit, we don't want to update the timestamp to find the games we missed again
	let hadError = false;
	let hitSteamAPILimit = false;

	// Get the games currently in the database
	let newGamesInNotionDatabase = await getGamesFromDatabase();

	// Remove all games from newGamesInNotionDatabase that are already in the localDatabase
	console.log("Removing games that are already in the local database...");
	for (const pageId of Object.keys(newGamesInNotionDatabase)) {
		if (pageId in localDatabase) {
			delete newGamesInNotionDatabase[pageId];
		}
	}

	// Limit the number of games to avoid hitting the Steam API rate limit
	if (Object.keys(newGamesInNotionDatabase).length > 50) {
		console.log(`Found ${Object.keys(newGamesInNotionDatabase).length} new games in the Notion database. The Steam API limits the allowed amount of requests in quick succession. Some games will be updated later.\n`);
		hitSteamAPILimit = true;
		newGamesInNotionDatabase = Object.fromEntries(Object.entries(newGamesInNotionDatabase).slice(0, 50));
	}

	if (Object.keys(newGamesInNotionDatabase).length > 0) {
		// Get info about the new games from the SteamUser API
		const appInfoSteamUser = await getSteamAppInfoSteamUser(Object.values(newGamesInNotionDatabase)).then((appInfoSteamUser) => { return appInfoSteamUser; });

		// Update the Notion database with the new properties
		let gamesThisBatch = 0;
		for (const [pageId, steamAppId] of Object.entries(newGamesInNotionDatabase)) {
			try {
				console.log(`Updating properties for game with Steam App ID ${steamAppId}`);

				// Get info about this game from the Steam API
				const appInfoDirect = await getSteamAppInfoDirect(steamAppId);

				// The properties that will be passed to the Notion API call
				let properties = {};
				let cover = null;
				let icon = null;

				if (CONFIG.gameProperties.gameName?.enabled) {
					const gameTitle = appInfoDirect.name
						? appInfoDirect.name
						: appInfoSteamUser[steamAppId].name;

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
					const coverUrl = appInfoDirect.header_image
						? appInfoDirect.header_image
						: (appInfoSteamUser[steamAppId].header_image?.english
							? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/${appInfoSteamUser[steamAppId].header_image.english}`
							: "https://www.metal-hammer.de/wp-content/uploads/2022/11/22/19/steam-logo.jpg");

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
					const iconUrl = appInfoSteamUser[steamAppId].icon ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${steamAppId}/${appInfoSteamUser[steamAppId].icon}.jpg` : "https://iconarchive.com/download/i75918/martz90/circle/steam.ico";

					icon = {
						"type": "external",
						"external": {
							"url": iconUrl
						}
					}
				}

				if (CONFIG.gameProperties.releaseDate?.enabled) {
					// Get the release date. If no release date is available, use the Unix epoch
					// The releaseDate format from the Steam API is not in ISO format, so we use the SteamUser API instead
					let releaseDate;
					if (appInfoSteamUser[steamAppId].original_release_date) {
						releaseDate = new Date(parseInt(appInfoSteamUser[steamAppId].original_release_date) * 1000).toISOString();
					} else if (appInfoSteamUser[steamAppId].steam_release_date) {
						releaseDate = new Date(parseInt(appInfoSteamUser[steamAppId].steam_release_date) * 1000).toISOString();
					} else if (appInfoSteamUser[steamAppId].store_asset_mtime) {
						releaseDate = new Date(parseInt(appInfoSteamUser[steamAppId].store_asset_mtime) * 1000).toISOString();
					} else {
						releaseDate = new Date(0);
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
					const steamReviewScore = appInfoSteamUser[steamAppId].review_percentage ? parseInt(appInfoSteamUser[steamAppId].review_percentage) / 100 : null;

					properties[CONFIG.gameProperties.reviewScore.notionProperty] = {
						"number": steamReviewScore
					}
				}

				if (CONFIG.gameProperties.tags?.enabled) {
					// Parse the tags from the Steam API. If no tags are found, set a "No tags found" placeholder
					// The tags are not available through the Steam store API, so we have to use the SteamUser API instead
					const tags = appInfoSteamUser[steamAppId].store_tags ? await getSteamTagNames(appInfoSteamUser[steamAppId].store_tags).then((tags) => { return tags; }) : ["No tags found"];

					properties[CONFIG.gameProperties.tags.notionProperty] = {
						"multi_select": tags.map((tag) => {
							return {
								"name": tag
							}
						})
					}
				}

				if (CONFIG.gameProperties.gameDescription?.enabled) {
					// Get the game description. If no description is available, set a null
					const gameDescription = appInfoDirect.short_description ? appInfoDirect.short_description : "";

					properties[CONFIG.gameProperties.gameDescription.notionProperty] = {
						"rich_text": [
							{
								"text": {
									"content": gameDescription
								}
							}
						]
					}
				}

				// Update the game's page in the database with the new info
				notion.pages.update({
					page_id: pageId,
					properties: properties,
					cover: cover,
					icon: icon
				});

				// Add this game to the local database
				// Do this after all the rest to make sure we don't add a game to the local database if something goes wrong
				localDatabase[pageId] = steamAppId;

				gamesThisBatch++;
				if (gamesThisBatch >= 10) {
					// Write the updated local store to disk in batches of 10 games to prevent data loss
					fs.writeFileSync(__dirname + '/backend/localDatabase.json', JSON.stringify(localDatabase, null, 2));
					gamesThisBatch = 0;
				}
			} catch (error) {
				console.error(error);
				hadError = true;
			}
		}

		// Only update the last updated time if there were no errors during execution
		// This makes sure that we can find the games that had errors again the next time
		if (!hadError && !hitSteamAPILimit) {
			localDatabase.lastUpdatedAt = newLastUpdatedAt;
		}

		// Write the updated local store to disk
		fs.writeFileSync(__dirname + '/backend/localDatabase.json', JSON.stringify(localDatabase, null, 2));
	}

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