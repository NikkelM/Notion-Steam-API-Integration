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

// ----- Backend -----

// Create the backend/utils directory if it doesn't exist
if (!fs.existsSync(__dirname + '/backend')) {
	fs.mkdirSync(__dirname + '/backend');
}
// Create an empty local store of all games in the database if it doesn't exist
if (!fs.existsSync(__dirname + '/backend/gamesInDatabase.json')) {
	fs.writeFileSync(__dirname + '/backend/gamesInDatabase.json', JSON.stringify({}, null, 2));
}

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

// ---------- Steam API ----------

let steamClient = new SteamUser();
steamClient.logOn();

async function getSteamAppInfo(appId) {
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
const updateInterval = 60000; // 1 minute

// A JSON Object to hold all games in the Notion database
let gamesInDatabase = JSON.parse(fs.readFileSync(__dirname + '/backend/gamesInDatabase.json'));

async function findChangesAndAddDetails() {
	console.log("Looking for changes in Notion database...");

	// Get the games currently in the database
	const currGamesInDatabase = await getGamesFromDatabase();

	// Iterate over the current games and compare them to games in our local store (gamesInDatabase)
	for (const [pageId, steamAppId] of Object.entries(currGamesInDatabase)) {
		// If this game hasn't been seen before
		if (!(pageId in gamesInDatabase)) {
			try {
				console.log("New game found with Steam App ID: " + steamAppId);

				// Get info about this game from the Steam API
				const appInfo = await getSteamAppInfo(steamAppId).then((appInfo) => { return appInfo; });

				// Get the game's title. If no title is available, use a placeholder
				const gameTitle = appInfo.common.name ? appInfo.common.name : "CouldNotFetchTitle";

				// Get the URL's for the cover image and icon. Default values have a Steam theme
				// TODO: Don't set it at all if not found, to not overwrite potential custom images
				const coverUrl = appInfo.common.header_image?.english ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/${appInfo.common.header_image.english}` : "https://www.metal-hammer.de/wp-content/uploads/2022/11/22/19/steam-logo.jpg";
				const iconUrl = appInfo.common.icon ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${steamAppId}/${appInfo.common.icon}.jpg` : "https://iconarchive.com/download/i75918/martz90/circle/steam.ico";

				// Get the release date. If no version is available, use the Unix epoch
				// Formatted as YYYY-MM-DD
				let releaseDate;
				if (appInfo.common.original_release_date) {
					releaseDate = new Date(parseInt(appInfo.common.original_release_date) * 1000).toISOString().split("T")[0];
				} else if (appInfo.common.steam_release_date) {
					releaseDate = new Date(parseInt(appInfo.common.steam_release_date) * 1000).toISOString().split("T")[0];
				} else if (appInfo.common.store_asset_mtime) {
					releaseDate = new Date(parseInt(appInfo.common.store_asset_mtime) * 1000).toISOString().split("T")[0];
				} else {
					releaseDate = new Date(0).toISOString().split("T")[0];
				}

				// Get the Steam user review score as a percentage
				const steamReviewScore = appInfo.common.review_percentage ? parseInt(appInfo.common.review_percentage) / 100 : null;

				// Parse the tags from the Steam API. If no tags are found, set a "No tags found" placeholder
				const tags = appInfo.common.store_tags ? await getSteamTagNames(appInfo.common.store_tags).then((tags) => { return tags; }) : ["No tags found"];

				// Update the game's page in the database with the new info
				await notion.pages.update({
					page_id: pageId,
					properties: {
						"Name": {
							"title": [
								{
									"type": "text",
									"text": {
										"content": gameTitle
									}
								}
							]
						},
						"Release": {
							"date": {
								"start": releaseDate
							}
						},
						"Store page": {
							"url": `https://store.steampowered.com/app/${steamAppId}`
						},
						"Steam Reviews": {
							"number": steamReviewScore
						},
						"Tags": {
							"multi_select": tags.map((tag) => {
								return {
									"name": tag
								}
							})
						}
					},
					cover: {
						"type": "external",
						"external": {
							"url": coverUrl
						}
					},
					icon: {
						"type": "external",
						"external": {
							"url": iconUrl
						}
					}
				});

				// Add this game to the local store of all games
				// Do this after all the rest to make sure we don't add a game to the local store if something goes wrong
				gamesInDatabase[pageId] = steamAppId;
				fs.writeFileSync(__dirname + '/backend/gamesInDatabase.json', JSON.stringify(gamesInDatabase, null, 2));
			} catch (error) {
				console.error(error);
			}
		}
	}

	console.log("Done looking for changes in Notion database. Looking again in " + updateInterval / 1000 + " seconds.\n");
	// Run this method every updateInterval milliseconds
	setTimeout(main, updateInterval);
}


function main() {
	findChangesAndAddDetails().catch(console.error);
}

(async () => {
	main();
})();

// Get a paginated list of Games currently in the database. 
async function getGamesFromDatabase() {

	const games = {}

	async function getPageOfGames(cursor) {
		let requestPayload = "";
		// Create the request payload based on the presense of a start_cursor
		if (cursor == undefined) {
			requestPayload = {
				path: 'databases/' + databaseId + '/query',
				method: 'POST',
			}
		} else {
			requestPayload = {
				path: 'databases/' + databaseId + '/query',
				method: 'POST',
				body: {
					"start_cursor": cursor
				}
			}
		}
		// While there are more pages left in the query, get pages from the database. 
		const currentPages = await notion.request(requestPayload);

		for (const page of currentPages.results) {
			// If the page has a set Steam App ID, we can work with it, so we save it to the local cache
			if (page.properties["Steam App ID"].number !== null) {
				games[page.id] = page.properties["Steam App ID"].number;
			}
		}
		if (currentPages.has_more) {
			await getPageOfGames(currentPages.next_cursor)
		}

	}
	await getPageOfGames();
	return games;
}; 
