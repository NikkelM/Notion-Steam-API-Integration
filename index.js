// Author: NikkelM
// Description: Notion integration that updates a database with information from the Steam API.

// Suppresses the warning about the fetch API being unstable
process.removeAllListeners('warning');

import { getSteamAppInfoDirect, getSteamAppInfoSteamUser } from './js/steamAPI.js';
import { CONFIG, localDatabase, addGameToLocalDatabase, storeAPIRequired, steamUserAPIRequired } from './js/utils.js';
import { getGamesFromNotionDatabase, updateNotionPage, checkNotionPropertiesExistence } from './js/notion.js';
import { getGameProperties } from './js/gameProperties.js';

// ---------- Setup ----------

// We need to do this here because of circular imports
await checkNotionPropertiesExistence()

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

	// Get the games currently in the Notion database
	let updatedPagesInNotionDatabase = await getGamesFromNotionDatabase();

	// Remove all pages from updatedPagesInNotionDatabase that are already in the local database
	const duplicatePages = await localDatabase.getMany(Object.keys(updatedPagesInNotionDatabase));
	for (const [pageId, steamAppId] of Object.entries(updatedPagesInNotionDatabase)) {
		if (duplicatePages.includes(steamAppId)) {
			delete updatedPagesInNotionDatabase[pageId];
		}
	}

	// Limit the number of games to avoid hitting the Steam API rate limit, if required
	if (Object.keys(updatedPagesInNotionDatabase).length > 60 && storeAPIRequired) {
		console.log(`Found ${Object.keys(updatedPagesInNotionDatabase).length} new/updated pages/games in the Notion database. The Steam API limits the allowed amount of requests in quick succession. Some games will be updated later.\n`);
		hitSteamAPILimit = true;
		updatedPagesInNotionDatabase = Object.fromEntries(Object.entries(updatedPagesInNotionDatabase).slice(0, 60));
	}

	if (Object.keys(updatedPagesInNotionDatabase).length > 0) {
		// Get info about the new games from the SteamUser API, if required
		const appInfoSteamUser = steamUserAPIRequired
			? await getSteamAppInfoSteamUser(Object.values(updatedPagesInNotionDatabase)).then((appInfoSteamUser) => { return appInfoSteamUser; })
			: null;

		// Update the Notion database with the new properties
		for (const [pageId, steamAppId] of Object.entries(updatedPagesInNotionDatabase)) {
			try {
				console.log(`Setting properties for game with Steam App ID ${steamAppId}`);

				// Get info about this game from the Steam API, if required
				const appInfoDirect = storeAPIRequired
					? await getSteamAppInfoDirect(steamAppId)
					: null;

				let notionProperties = await getGameProperties(appInfoDirect, appInfoSteamUser[steamAppId], steamAppId);

				updateNotionPage(pageId, notionProperties);
				addGameToLocalDatabase(pageId, steamAppId);

			} catch (error) {
				console.error(error);
				hadError = true;
			}
		}

		// Only update the last updated time if there were no errors during execution and we didn't hit the Steam API request limit
		// This makes sure that we can find the games that had errors or that we had to omit again the next time
		if (!hadError && !hitSteamAPILimit) {
			localDatabase.put('lastUpdatedAt', newLastUpdatedAt);
		}
	}

	console.log(`Done looking for changes in Notion database. Looking again in ${updateInterval / 60000} minute(s).\n`);

	// Run this method again in `updateInterval` milliseconds
	setTimeout(main, updateInterval);
}