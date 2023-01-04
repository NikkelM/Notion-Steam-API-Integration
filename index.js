// Author: NikkelM
// Description: Notion integration that updates a database with information from the Steam API.

// Suppresses the warning about the fetch API being unstable
process.removeAllListeners('warning');

import fs from 'fs';

import { getSteamAppInfoDirect, getSteamAppInfoSteamUser } from './js/steamAPI.js';
import { CONFIG, localDatabase } from './js/utils.js';
import { getGamesFromDatabase, updateNotionPage } from './js/notion.js';
import { getGameProperties } from './js/gameProperties.js';

const updateInterval = CONFIG.updateInterval;

// ---------- Main Loop ----------

function main() {
	updateNotionDatabase().catch(console.error);
}

main();

async function updateNotionDatabase() {
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

		let gamesThisBatch = 0;

		// Update the Notion database with the new properties
		for (const [pageId, steamAppId] of Object.entries(newGamesInNotionDatabase)) {
			try {
				console.log(`Updating properties for game with Steam App ID ${steamAppId}`);

				// Get info about this game from the Steam API
				const appInfoDirect = await getSteamAppInfoDirect(steamAppId);

				let notionProperties = await getGameProperties(appInfoDirect, appInfoSteamUser[steamAppId]);

				updateNotionPage(pageId, notionProperties);

				// Add this game to the local database
				// Do this after all the rest to make sure we don't add a game to the local database if something goes wrong
				localDatabase[pageId] = steamAppId;

				gamesThisBatch++;
				if (gamesThisBatch >= 10) {
					// Write the updated local store to disk in batches of 10 games to prevent data loss
					fs.writeFileSync('./backend/localDatabase.json', JSON.stringify(localDatabase, null, 2));
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
		fs.writeFileSync('./backend/localDatabase.json', JSON.stringify(localDatabase, null, 2));
	}

	console.log(`Done looking for changes in Notion database. Looking again in ${updateInterval / 60000} minute(s).\n`);

	// Run this method again in `updateInterval` milliseconds
	setTimeout(main, updateInterval);
}