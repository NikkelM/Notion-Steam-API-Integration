import SteamUser from 'steam-user';
import { CONFIG, addRefreshTokenToLocalDatabase, getRefreshTokenFromLocalDatabase, resolveSecret, steamUserLoginRequired } from './utils.js';

// ---------- Steam login ----------

// The Steam client, created and logged in once by loginToSteam() before any product/tag lookups
let steamClient = null;

function logOn(client, config) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			client.removeListener('loggedOn', onLoggedOn);
			client.removeListener('error', onError);
		};
		const onLoggedOn = () => { cleanup(); resolve(); };
		const onError = (err) => { cleanup(); reject(err); };
		client.once('loggedOn', onLoggedOn);
		client.once('error', onError);
		client.logOn(config);
	});
}

// Resolve the Steam password from the STEAM_PASSWORD environment variable or an interactive prompt
function resolveSteamPassword(accountName) {
	return resolveSecret({
		envVar: 'STEAM_PASSWORD',
		promptMessage: `Steam password for "${accountName}":`,
		label: 'Steam password'
	});
}

// Log in to Steam: anonymously when only public data is needed, or with the account when tag data is required
// Uses a stored refresh token when available, falling back to account name + password (STEAM_PASSWORD)
export async function loginToSteam() {
	let steamUserConfig;
	if (steamUserLoginRequired()) {
		// Reuse a stored refresh token unless the user explicitly set useRefreshToken: false (e.g. to force a fresh login after a password change)
		const useStoredToken = CONFIG.steamUser?.useRefreshToken !== false;
		const refreshToken = useStoredToken ? await getRefreshTokenFromLocalDatabase() : null;
		if (refreshToken) {
			steamUserConfig = { refreshToken };
		} else {
			const accountName = CONFIG.steamUser?.accountName?.trim();
			if (!accountName) {
				console.error("Fetching tags requires a Steam login. Provide \"steamUser.accountName\" in your config and your password via the STEAM_PASSWORD environment variable, or disable the \"tags\" property.");
				process.exit(1);
			}
			steamUserConfig = { accountName, password: await resolveSteamPassword(accountName) };
		}
	} else {
		steamUserConfig = { anonymous: true };
	}

	steamClient = new SteamUser({ renewRefreshTokens: true });
	steamClient.on('refreshToken', async function (refreshToken) {
		try {
			await addRefreshTokenToLocalDatabase(refreshToken);
		} catch (error) {
			console.error("Could not store the Steam refresh token:", error?.message ?? error);
		}
	});

	console.log("Logging in to Steam", steamUserConfig.anonymous ? "anonymously..." : (steamUserConfig.accountName ? `as ${steamUserConfig.accountName}...` : "using a refresh token..."));

	try {
		await logOn(steamClient, steamUserConfig);
	} catch (error) {
		// A stored refresh token can be stale (e.g. the password was changed); drop it and fall back to account/password
		if (steamUserConfig.refreshToken) {
			console.log("Login with refresh token failed. Removing it and trying account/password...");
			await addRefreshTokenToLocalDatabase(null);

			const accountName = CONFIG.steamUser?.accountName?.trim();
			if (accountName) {
				steamUserConfig = { accountName, password: await resolveSteamPassword(accountName) };
				await logOn(steamClient, steamUserConfig);
			} else {
				console.error("The stored refresh token is no longer valid. Provide \"steamUser.accountName\" and the STEAM_PASSWORD environment variable to log in again.");
				process.exit(1);
			}
		} else {
			console.error("Login to Steam failed:", error?.message || error);
			process.exit(1);
		}
	}
}

// ---------- Steam API ----------

// Gets app info directly from the Steam Store API
// Does not offer all info that the SteamUser API does
// For some apps, the API does not return any info, even though the app exists
export async function getSteamAppInfoDirect(appId, retryCount = 0) {
	let result = null;
	try {
		const response = await fetch(`https://store.steampowered.com/api/appdetails/?appids=${appId}`);
		// A non-OK status (e.g. a 429 rate limit) often returns an HTML body, so guard before parsing
		if (response.ok) {
			const data = await response.json();
			if (data && data[appId]?.success) {
				result = data[appId].data;
			}
		}
	} catch (error) {
		// Network error or a non-JSON (e.g. HTML) response - fall through to the retry below
	}

	// If the request failed, we try again
	if (!result && retryCount < 3) {
		retryCount++;
		console.log(`Failed to get app info for app ${appId} from the Steam Store API. Retrying in ${retryCount ** 2} second(s)...`);
		await new Promise(r => setTimeout(r, (retryCount ** 2) * 1000));
		return getSteamAppInfoDirect(appId, retryCount);
	} else if (retryCount >= 3) {
		console.log(`Failed to get app info for app ${appId} from the Steam Store API. Some info may still be available using the SteamUser API.`);
		return null;
	}

	return result;
}

// Gets app info from the SteamUser API
// Does not offer all info that the Steam Store API does
export async function getSteamAppInfoSteamUser(appIds) {
	console.log(`\nGetting app info from the SteamUser API for ${appIds.length} games...\n`);

	// Passing true as the third argument automatically requests access tokens, which are required for some apps
	const response = await steamClient.getProductInfo(appIds, [], true);

	let result = {};
	for (const key of Object.keys(response.apps)) {
		// Some app types (DLC, tools) have no appinfo.common; skip them rather than crashing the whole update cycle
		const common = response.apps[key]?.appinfo?.common;
		if (common) {
			result[key] = common;
		}
	}

	return result;
}

// Gets the current review score data for a game from the Steam reviews API
export async function getSteamReviewScoreDirect(appId) {
	try {
		const response = await fetch(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all`);
		if (!response.ok) {
			return null;
		}
		const data = await response.json();
		if (data?.success) {
			return data.query_summary;
		}
	} catch (error) {
		// Network error or a non-JSON (e.g. HTML) response
	}

	return null;
}

export async function getSteamTagNames(storeTags, tagLanguage) {
	const tagIds = Object.keys(storeTags).map(function (key) {
		return storeTags[key];
	});

	try {
		const response = await steamClient.getStoreTagNames(tagLanguage, tagIds);
		return Object.keys(response.tags).map(function (key) {
			return response.tags[key].name;
		});
	} catch (error) {
		console.log("Retrieving tag names failed! The most likely cause is that you have not provided the \"steamUser\" property and are not authenticated, or the provided \"tagLanguage\" is invalid.");
		return ["Retrieving tags failed"];
	}
}
