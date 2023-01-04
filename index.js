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
				const appInfo = await getSteamAppInfo(steamAppId).then((appInfo) => { return appInfo; });

				// The properties that will be passed to the Notion API call
				let properties = {};
				let cover = null;
				let icon = null;

				if (CONFIG.notionProperties.gameName?.enabled) {
					// Get the game's title. If no title is available, use a placeholder
					const gameTitle = appInfo.common.name ? appInfo.common.name : "CouldNotFetchTitle";
					const propertyType = CONFIG.notionProperties.gameName.isPageTitle ? "title" : "rich_text";

					properties[CONFIG.notionProperties.gameName.notionProperty] = {
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

				if (CONFIG.notionProperties.coverImage) {
					// Get the URL for the cover image. Default value has a Steam theme
					const coverUrl = appInfo.common.header_image?.english ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/${appInfo.common.header_image.english}` : "https://www.metal-hammer.de/wp-content/uploads/2022/11/22/19/steam-logo.jpg";

					cover = {
						"type": "external",
						"external": {
							"url": coverUrl
						}
					}
				}

				if (CONFIG.notionProperties.gameIcon) {
					// Get the URL for the game icon. Default value has a Steam theme
					const iconUrl = appInfo.common.icon ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${steamAppId}/${appInfo.common.icon}.jpg` : "https://iconarchive.com/download/i75918/martz90/circle/steam.ico";

					icon = {
						"type": "external",
						"external": {
							"url": iconUrl
						}
					}
				}

				if (CONFIG.notionProperties.releaseDate?.enabled) {
					// Get the release date. If no release date is available, set null
					let releaseDate;
					if (appInfo.common.original_release_date) {
						releaseDate = new Date(parseInt(appInfo.common.original_release_date) * 1000).toISOString();
					} else if (appInfo.common.steam_release_date) {
						releaseDate = new Date(parseInt(appInfo.common.steam_release_date) * 1000).toISOString();
					} else if (appInfo.common.store_asset_mtime) {
						releaseDate = new Date(parseInt(appInfo.common.store_asset_mtime) * 1000).toISOString();
					} else {
						releaseDate = null;
					}

					if (releaseDate && CONFIG.notionProperties.releaseDate.format == "date") {
						releaseDate = releaseDate.split("T")[0];
					}

					properties[CONFIG.notionProperties.releaseDate.notionProperty] = {
						"date": {
							"start": releaseDate
						}
					}
				}

				if (CONFIG.notionProperties.reviewScore?.enabled) {
					// Get the Steam user review score as a percentage
					const steamReviewScore = appInfo.common.review_percentage ? parseInt(appInfo.common.review_percentage) / 100 : null;

					properties[CONFIG.notionProperties.reviewScore.notionProperty] = {
						"number": steamReviewScore
					}
				}

				if (CONFIG.notionProperties.tags?.enabled) {
					// Parse the tags from the Steam API. If no tags are found, set a "No tags found" placeholder
					const tags = appInfo.common.store_tags ? await getSteamTagNames(appInfo.common.store_tags).then((tags) => { return tags; }) : ["No tags found"];

					properties[CONFIG.notionProperties.tags.notionProperty] = {
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