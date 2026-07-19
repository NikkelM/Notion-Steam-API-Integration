// Description: Core integration logic - activates a validated config, resolves secrets, connects to Notion and Steam, then polls the Notion database on an interval and fills in Steam data

import {
	CONFIG,
	localDatabase,
	initConfig,
	openLocalDatabase,
	resolveSecret,
	envVarInstructions,
	storeAPIRequired,
	steamUserAPIRequired,
	reviewAPIRequired,
	pagesToUpdate,
	addGameToLocalDatabase
} from './utils.js';
import { getSteamAppInfoDirect, getSteamAppInfoSteamUser, getSteamReviewScoreDirect, loginToSteam } from './steamAPI.js';
import { getGamesFromNotionDatabase, updateNotionPage, checkNotionPropertiesExistence, setUserIdInDatabaseIfNotSet } from './notion.js';
import { getGameProperties } from './gameProperties.js';

// Activate the given (already validated) config, connect to Notion and Steam, then start the polling loop
export async function run(config) {
	initConfig(config);

	if (!CONFIG.notionDatabaseId?.trim()) {
		throw new Error('no Notion database ID is set - add "notionDatabaseId" to your config, or pass --database-id.');
	}

	// Resolve the Notion integration key from the environment (or prompt); it is never read from or written to the config file
	CONFIG.notionIntegrationKey = await resolveSecret({
		envVar: 'NOTION_INTEGRATION_KEY',
		configValue: CONFIG.notionIntegrationKey,
		configField: 'notionIntegrationKey',
		promptMessage: 'Notion integration key (create or find it at https://www.notion.so/my-integrations):',
		label: 'Notion integration key'
	});

	// The Steam password is only ever read from STEAM_PASSWORD or a prompt, never the config file
	if (CONFIG.steamUser?.password?.trim()) {
		throw new Error(`for your security, the Steam password must not be stored in the configuration file. Remove "steamUser.password" from your config, then set the STEAM_PASSWORD environment variable instead:\n${envVarInstructions('STEAM_PASSWORD')}`);
	}

	await openLocalDatabase();

	// Verify the Notion database and its properties before doing anything else, so a misconfiguration fails fast
	try {
		await checkNotionPropertiesExistence();
		await setUserIdInDatabaseIfNotSet();
	} catch (error) {
		if (error?.code === 'unauthorized') {
			console.error("\nError: Your Notion integration key is invalid. Set a valid key via the NOTION_INTEGRATION_KEY environment variable (create or find it at https://www.notion.so/my-integrations).");
		} else if (error?.code === 'object_not_found') {
			console.error("\nError: The Notion database was not found, or your integration has not been granted access to it. Check \"notionDatabaseId\" and share the database with your integration.");
		} else {
			console.error("\nError connecting to Notion: " + (error?.message ?? error));
		}
		process.exit(1);
	}

	// Log in to Steam if any property needs the SteamUser API (anonymously, or with the account when tags are enabled)
	if (steamUserAPIRequired()) {
		await loginToSteam();
	}

	// A long-running daemon must not die on a stray promise rejection; log and keep polling
	process.on('unhandledRejection', (reason) => {
		console.error("Unhandled promise rejection (the integration will keep running):", reason?.message ?? reason);
	});

	startPolling();
}

// ---------- Main loop ----------

function startPolling() {
	updateNotionDatabase().catch(console.error);
}

async function updateNotionDatabase() {
	let hitSteamAPILimit = false;

	try {
		console.log("Looking for changes in Notion database...");

		// Update the last updated timestamp
		// Do this before fetching to make sure we don't miss changes made between now and fetching new properties below
		// Subtract 60 more seconds to make sure we have some buffer in case things get changed in between executions
		const newLastUpdatedAt = new Date(Date.now() - 60000).toISOString();

		// If we encounter an error or would hit the Steam API request limit, we don't want to update the timestamp to find the games we missed again
		let hadError = false;

		// Get the games currently in the Notion database
		let [updatedPagesSteamAppIds, updatedPagesEditedBy] = await getGamesFromNotionDatabase();
		console.log(`Found ${Object.keys(updatedPagesSteamAppIds).length} new/updated pages with the "${CONFIG.steamAppIdProperty}" property set.\n`);

		// A per-page view of the local database: pageId -> the Steam App ID we last stored for it (null if this page was never processed)
		// getMany returns values aligned to the keys, so we key by pageId to avoid a value-membership test that would wrongly skip a different page sharing an App ID
		const trackedKeys = Object.keys(updatedPagesSteamAppIds);
		const storedValues = await localDatabase.getMany(trackedKeys);
		const storedAppIdByPage = {};
		trackedKeys.forEach((pageId, index) => { storedAppIdByPage[pageId] = storedValues[index]; });

		if (CONFIG.alwaysUpdate) {
			console.log("Every page will be updated, as long as someone other than the integration has last edited it and it does not exist in the local database yet.\n");
		} else {
			console.log("Removing pages that are already present in the local database from the list of pages to update...\n");
		}
		const integrationUserId = CONFIG.alwaysUpdate ? await localDatabase.get('userId') : null;
		({ appIds: updatedPagesSteamAppIds, editedBy: updatedPagesEditedBy } = pagesToUpdate({
			steamAppIdByPage: updatedPagesSteamAppIds,
			editedByByPage: updatedPagesEditedBy,
			storedAppIdByPage,
			alwaysUpdate: CONFIG.alwaysUpdate,
			integrationUserId
		}));

		console.log(`Found ${Object.keys(updatedPagesSteamAppIds).length} new/updated pages with a "Steam App ID" in the Notion database that will be updated by the integration.`);

		// Limit the number of games to avoid hitting the Steam API rate limit, if required
		if (Object.keys(updatedPagesSteamAppIds).length > 50 && storeAPIRequired()) {
			console.log("The Steam Store API limits the allowed amount of requests in quick succession. Some games will be updated later.");
			hitSteamAPILimit = true;
			updatedPagesSteamAppIds = Object.fromEntries(Object.entries(updatedPagesSteamAppIds).slice(0, 50));
		}

		if (Object.keys(updatedPagesSteamAppIds).length > 0) {
			// Get info about the new games from the SteamUser API, if required
			const appInfoSteamUser = steamUserAPIRequired()
				? await getSteamAppInfoSteamUser(Object.values(updatedPagesSteamAppIds))
				: null;

			// Update the Notion database with the new properties
			for (const [pageId, steamAppId] of Object.entries(updatedPagesSteamAppIds)) {
				try {
					console.log(`Setting properties for game with Steam App ID ${steamAppId}`);

					// Get info about this game from the Steam API, if required
					const appInfoDirect = storeAPIRequired()
						? await getSteamAppInfoDirect(steamAppId)
						: null;

					// Get info about the game's review score from the reviews API, if required
					const appInfoReviews = reviewAPIRequired()
						? await getSteamReviewScoreDirect(steamAppId)
						: null;

					let notionProperties = await getGameProperties(appInfoDirect, appInfoSteamUser?.[steamAppId] ?? null, appInfoReviews, steamAppId);
					if (!notionProperties) {
						// Neither API returned data (the game likely does not exist on Steam); skip it and let the timestamp advance so we do not re-query a nonexistent game every cycle
						continue;
					}

					await updateNotionPage(pageId, notionProperties);
					await addGameToLocalDatabase(pageId, steamAppId);

				} catch (error) {
					console.error(error);
					hadError = true;
				}
			}
		}

		// Only update the last updated time if there were no errors during execution and we didn't hit the Steam API request limit
		// This makes sure that we can find the games that had errors or that we had to omit again the next time
		if (!hadError && !hitSteamAPILimit) {
			await localDatabase.put('lastUpdatedAt', newLastUpdatedAt);
		}
	} catch (error) {
		// A failure in the setup/query phase (a Notion 429/5xx, a Steam reconnect, etc.) must NOT kill the daemon - log it and let the finally re-arm the next tick
		console.error("Error while updating the Notion database:", error?.message ?? error);
	} finally {
		// Always reschedule, so a transient error never permanently stops the polling loop
		if (hitSteamAPILimit) {
			console.log(`Done updating Notion database. Waiting 1 minute until we can ping the Steam Store API again....\n`);
			setTimeout(startPolling, 60000);
		} else {
			console.log(`Done updating Notion database. Looking again in ${CONFIG.updateInterval / 60000} minute(s).\n`);
			setTimeout(startPolling, CONFIG.updateInterval);
		}
	}
}
