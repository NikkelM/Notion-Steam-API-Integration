import SteamUser from 'steam-user';

// ---------- Steam API ----------

let steamClient = new SteamUser();
steamClient.logOn();
await new Promise(resolve => steamClient.on('loggedOn', resolve));

// Gets app info directly from the Steam store API
// Does not offer all info that the SteamUser API does
// For some apps, the API does not return any info, even though the app exists
export async function getSteamAppInfoDirect(appId, retryCount = 0) {
	const result = await fetch(`https://store.steampowered.com/api/appdetails/?appids=${appId}&cc=us`)
		.then(response => response.json())
		.then(data => {
			if (data && data[appId]?.success) {
				return data[appId].data;
			}
			return null;
		}
		);

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
	console.log(`Getting app info from SteamUser API for ${appIds.length} games...`);

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

export async function getSteamTagNames(storeTags, tagLanguage) {
	const tagIds = Object.keys(storeTags).map(function (key) {
		return storeTags[key];
	});

	return new Promise(async (resolve) => {
		let response = await steamClient.getStoreTagNames(tagLanguage, tagIds);


		const result = Object.keys(response.tags).map(function (key) {
			return response.tags[key].name;
		});

		resolve(result);
	});
}
