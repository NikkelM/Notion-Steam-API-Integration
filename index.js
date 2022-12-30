import { Client } from '@notionhq/client';
import SteamUser from 'steam-user';
import fs from 'fs';

import SECRETS from './secrets.json' assert { type: "json" };

// ---------- Steam API ----------

let steamClient = new SteamUser();
steamClient.logOn();

async function getSteamAppInfo(appId) {
	return new Promise(async (resolve, reject) => {
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

	return new Promise(async (resolve, reject) => {
		let response = await steamClient.getStoreTagNames("english", tagIds);

		const result = Object.keys(response.tags).map(function (key) {
			return response.tags[key].englishName;
		});

		resolve(result);
	});
}

// ---------- Notion API ----------

const notion = new Client({ auth: SECRETS.NOTION_KEY });
const databaseId = SECRETS.NOTION_DATABASE_ID;
const updateInterval = 60000; // 1 minute

// Create an empty local store of all games in the database if it doesn't exist
if (!fs.existsSync('./gamesInDatabase.json')) {
	fs.writeFileSync('./gamesInDatabase.json', JSON.stringify({}));
}

// A JSON Object to hold all games in the Notion database
let gamesInDatabase = JSON.parse(fs.readFileSync('./gamesInDatabase.json'));

async function findChangesAndAddDetails() {
	console.log();
	console.log("Looking for changes in Notion database...");

	// Get the games currently in the database
	const currGamesInDatabase = await getGamesFromDatabase();

	// Iterate over the current games and compare them to games in our local store (gamesInDatabase)
	for (const [pageId, steamAppId] of Object.entries(currGamesInDatabase)) {
		// If this game hasn't been seen before
		if (!(pageId in gamesInDatabase)) {
			try {
				console.log("New game found with Steam App Id: " + steamAppId);

				// Get info about this game from the Steam API
				const appInfo = await getSteamAppInfo(steamAppId).then((appInfo) => { return appInfo; });

				const gameTitle = appInfo.common.name ?? "CouldNotFetchTitle";
				const coverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;

				let releaseDate;
				if (appInfo.common.original_release_date) {
					releaseDate = new Date(parseInt(appInfo.common.original_release_date) * 1000).toISOString().split("T")[0]
				} else if (appInfo.common.steam_release_date) {
					releaseDate = new Date(parseInt(appInfo.common.steam_release_date) * 1000).toISOString().split("T")[0]
				} else if (appInfo.common.store_asset_mtime) {
					releaseDate = new Date(parseInt(appInfo.common.store_asset_mtime) * 1000).toISOString().split("T")[0]
				} else {
					releaseDate = null;
				}

				const tags = await getSteamTagNames(appInfo.common.store_tags).then((tags) => { return tags; }) ?? null;

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
					}
				});

				// Add this game to the local store of all games
				// Do this after all the rest to make sure we don't add a game to the local store if something goes wrong
				gamesInDatabase[pageId] = steamAppId;
				fs.writeFileSync('gamesInDatabase.json', JSON.stringify(gamesInDatabase));
			} catch (error) {
				console.error(error);
			}
		}
	}

	console.log("Done looking for changes in Notion database. Looking again in " + updateInterval / 1000 + " seconds.");
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
