// Author: NikkelM
// Description: Notion integration that updates a database with information from the Steam API.

// Suppresses the warning about the fetch API being unstable
process.removeAllListeners('warning');

import fs from 'fs';

import { getSteamAppInfoDirect, getSteamAppInfoSteamUser, getSteamTagNames } from './js/steamAPI.js';
import { CONFIG, localDatabase } from './js/utils.js';
import { getGamesFromDatabase, updateNotionPage } from './js/notion.js';

const updateInterval = CONFIG.updateInterval;

// ---------- Main ----------

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

				updateNotionPage(pageId, properties, cover, icon);

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