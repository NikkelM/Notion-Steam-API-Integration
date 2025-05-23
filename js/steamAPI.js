import SteamUser from 'steam-user';
import { CONFIG, addRefreshTokenToLocalDatabase, getRefreshTokenFromLocalDatabase, steamUserLoginRequired } from './utils.js';

// ---------- Steam API ----------

let steamUserConfig = {};

if (steamUserLoginRequired) {
	let refreshToken = await getRefreshTokenFromLocalDatabase();
	if (refreshToken) {
		steamUserConfig = {
			refreshToken: refreshToken,
		};
	} else
	if (CONFIG.steamUser.accountName && CONFIG.steamUser.password) {
		steamUserConfig = {
			accountName: CONFIG.steamUser.accountName,
			password: CONFIG.steamUser.password,
		}
	} else {
		console.error("\"steamUser.useRefreshToken\" was provided in the config, but no refresh token found in local database. \"steamUser.accountName\" and \"steamUser.password\" are required in the config, but they were not provided!");
		process.exit(1);
	}
} else {
	steamUserConfig = {
		anonymous: true
	};
}

let steamClient = new SteamUser({ renewRefreshTokens: true });

steamClient.on('refreshToken', async function (refreshToken) {
	await addRefreshTokenToLocalDatabase(refreshToken);
});

console.log("Logging in to Steam", steamUserConfig.anonymous ? "anonymously..." : (steamUserConfig.accountName ? `as ${steamUserConfig.accountName}...` : "using a refresh token..."));
steamClient.logOn(steamUserConfig);
await new Promise(resolve => steamClient.on('loggedOn', resolve));

// Gets app info directly from the Steam store API
// Does not offer all info that the SteamUser API does
// For some apps, the API does not return any info, even though the app exists
export async function getSteamAppInfoDirect(appId, retryCount = 0) {
	const result = await fetch(`https://store.steampowered.com/api/appdetails/?appids=${appId}`)
		.then(response => response.json())
		.then(data => {
			if (data && data[appId]?.success) {
				return data[appId].data;
			}
			return null;
		});

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
export async function getSteamAppInfoSteamUser(appIds) {
	console.log(`\nGetting app info from the SteamUser API for ${appIds.length} games...\n`);

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

// Gets the current review score data for a game from the Steam reviews API
export async function getSteamReviewScoreDirect(appId) {
	const result = await fetch(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all`)
		.then(response => response.json())
		.then(data => {
			if (data?.success) {
				return data.query_summary;
			}
			return null;
		});

	return result;
}

export async function getSteamTagNames(storeTags, tagLanguage) {
	const tagIds = Object.keys(storeTags).map(function (key) {
		return storeTags[key];
	});

	return new Promise(async (resolve) => {
		try {
			const response = await steamClient.getStoreTagNames(tagLanguage, tagIds);

			const result = Object.keys(response.tags).map(function (key) {
				return response.tags[key].name;
			});

			resolve(result);
		} catch (error) {
			console.log("Retrieving tag names failed! The most likely cause is that you have not provided the \"steamUser\" property and are not authenticated, or the provided \"tagLanguage\" is invalid.");
			resolve(["Retrieving tags failed"]);
		}
	});
}
