// Author: NikkelM
// Description: Notion integration that updates a database with information from the Steam API.

// Suppresses the warning about the fetch API being unstable
process.removeAllListeners('warning');

import { getSteamAppInfoDirect, getSteamAppInfoSteamUser } from './js/steamAPI.js';
import { CONFIG, localDatabase, addGameToLocalDatabase, storeAPIRequired, steamUserAPIRequired } from './js/utils.js';
import { getGamesFromNotionDatabase, updateNotionPage, checkNotionPropertiesExistence, setUserIdInDatabaseIfNotSet } from './js/notion.js';
import { getGameProperties } from './js/gameProperties.js';

// ---------- Setup ----------

// We need to do this here because of circular imports
await checkNotionPropertiesExistence();

await setUserIdInDatabaseIfNotSet();

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
	let [updatedPagesSteamAppIds, updatedPagesEditedBy] = await getGamesFromNotionDatabase();
	console.log(`Found ${Object.keys(updatedPagesSteamAppIds).length} updated pages with a "${CONFIG.steamAppIdProperty}" property.\n`);

	if (CONFIG.alwaysUpdate) {
		console.log("All pages will be updated, even if they already exist in the local database.\n");
		const integrationUserId = await localDatabase.get('userId');
		const pagesInDatabase = await localDatabase.getMany(Object.keys(updatedPagesSteamAppIds));
		for (const [pageId, lastEditedBy] of Object.entries(updatedPagesEditedBy)) {
			if (lastEditedBy === integrationUserId && pagesInDatabase.includes(updatedPagesSteamAppIds[pageId])) {
				delete updatedPagesEditedBy[pageId];
				delete updatedPagesSteamAppIds[pageId];
			}
		}
	} else {
		console.log("Removing pages that are already present in the local database from the list of pages to update...\n");
		// Remove all pages from updatedPagesSteamAppIds that are already in the local database
		const pagesInDatabase = await localDatabase.getMany(Object.keys(updatedPagesSteamAppIds));
		for (const [pageId, steamAppId] of Object.entries(updatedPagesSteamAppIds)) {
			if (pagesInDatabase.includes(steamAppId)) {
				delete updatedPagesSteamAppIds[pageId];
				delete updatedPagesEditedBy[pageId];
			}
		}
	}

	// Limit the number of games to avoid hitting the Steam API rate limit, if required
	if (Object.keys(updatedPagesSteamAppIds).length > 50 && storeAPIRequired) {
		console.log(`Found ${Object.keys(updatedPagesSteamAppIds).length} new/updated pages with a "Steam App ID" in the Notion database. The Steam store API limits the allowed amount of requests in quick succession. Some games will be updated later.`);
		hitSteamAPILimit = true;
		updatedPagesSteamAppIds = Object.fromEntries(Object.entries(updatedPagesSteamAppIds).slice(0, 50));
	}

	if (Object.keys(updatedPagesSteamAppIds).length > 0) {
		// Get info about the new games from the SteamUser API, if required
		const appInfoSteamUser = steamUserAPIRequired
			? await getSteamAppInfoSteamUser(Object.values(updatedPagesSteamAppIds)).then((appInfoSteamUser) => { return appInfoSteamUser; })
			: null;

		// Update the Notion database with the new properties
		for (const [pageId, steamAppId] of Object.entries(updatedPagesSteamAppIds)) {
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