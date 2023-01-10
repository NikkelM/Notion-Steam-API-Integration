import { getSteamTagNames } from './steamAPI.js';
import { CONFIG } from './utils.js';

export async function getGameProperties(appInfoDirect, appInfoSteamUser, steamAppId) {
	let outputProperties = {};
	let cover;
	let icon;
	let result = {};

	for (const [propertyName, propertyValue] of Object.entries(CONFIG.gameProperties)) {
		switch (propertyName) {
			case "gameName":
				outputProperties = getGameNameProperty(propertyValue, appInfoSteamUser, outputProperties);
				break;
			case "releaseDate":
				outputProperties = getGameReleaseDate(propertyValue, appInfoSteamUser, outputProperties);
				break;
			case "reviewScore":
				outputProperties = getGameReviewScore(propertyValue, appInfoSteamUser, outputProperties);
				break;
			case "tags":
				outputProperties = await getGameTags(propertyValue, appInfoSteamUser, outputProperties);
				break;
			case "gameDescription":
				outputProperties = getGameDescription(propertyValue, appInfoDirect, outputProperties);
				break;
			case "storePage":
				outputProperties = getGameStorePage(propertyValue, steamAppId, outputProperties);
				break;
			case "coverImage":
				cover = getGameCoverImage(propertyValue, appInfoDirect, appInfoSteamUser);
				if (cover) { result["cover"] = cover; }
				break;
			case "gameIcon":
				icon = getGameIcon(propertyValue, appInfoSteamUser);
				if (cover) { result["icon"] = icon; }
				break;
			case "gamePrice":
				outputProperties = getGamePrice(propertyValue, appInfoDirect, outputProperties);
				break;
			case "steamDeckCompatibility":
				outputProperties = getSteamDeckCompatibility(propertyValue, appInfoSteamUser, outputProperties);
				break;
		}
	}

	result["properties"] = outputProperties;

	return result;
}

function getGameNameProperty(nameProperty, appInfoSteamUser, outputProperties) {
	if (!nameProperty.enabled || !appInfoSteamUser.name) { return outputProperties; }

	// We use the title from the Steam User API as this stops us from always having to ping the Steam store API, as most users will want to get the game name
	const gameTitle = appInfoSteamUser.name;

	const propertyType = nameProperty.isPageTitle
		? "title"
		: "rich_text";

	outputProperties[nameProperty.notionProperty] = {
		[propertyType]: [
			{
				"type": "text",
				"text": {
					"content": gameTitle
				}
			}
		]
	};

	return outputProperties;
}

function getGameCoverImage(coverProperty, appInfoDirect, appInfoSteamUser) {
	// Don't set a cover image if it is disabled, or if there is no cover image available
	if (!coverProperty.enabled || (!appInfoDirect.header_image && !appInfoSteamUser.header_image?.english && !coverProperty.default)) { return null; }

	// Use the URL from the Steam store API if available, else use the SteamUser API if available, else use the default image
	const coverUrl = appInfoDirect.header_image
		? appInfoDirect.header_image
		: (appInfoSteamUser.header_image?.english
			? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appInfoSteamUser.gameid}/${appInfoSteamUser.header_image.english}`
			: coverProperty.default);

	return {
		"type": "external",
		"external": {
			"url": coverUrl
		}
	};
}

function getGameIcon(iconProperty, appInfoSteamUser) {
	if (!iconProperty.enabled || (!appInfoSteamUser.icon && !iconProperty.default)) { return null; }

	// Game icon URL is not available through the Steam store API, so we have to use the SteamUser API
	const iconUrl = appInfoSteamUser.icon
		? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appInfoSteamUser.gameid}/${appInfoSteamUser.icon}.jpg`
		: iconProperty.default;

	return {
		"type": "external",
		"external": {
			"url": iconUrl
		}
	};
}

function getGameReleaseDate(releaseDateProperty, appInfoSteamUser, outputProperties) {
	if (!releaseDateProperty.enabled) { return outputProperties; }

	// If no release date is available, don't set it at all in the database
	// The releaseDate format from the Steam API is not in ISO format, so we use the SteamUser API instead
	let releaseDate;
	if (appInfoSteamUser.original_release_date) {
		releaseDate = new Date(parseInt(appInfoSteamUser.original_release_date) * 1000).toISOString();
	} else if (appInfoSteamUser.steam_release_date) {
		releaseDate = new Date(parseInt(appInfoSteamUser.steam_release_date) * 1000).toISOString();
	} else if (appInfoSteamUser.store_asset_mtime) {
		releaseDate = new Date(parseInt(appInfoSteamUser.store_asset_mtime) * 1000).toISOString();
	} else {
		return outputProperties;
	}

	if (releaseDate && releaseDateProperty.format == "date") {
		releaseDate = releaseDate.split("T")[0];
	}

	outputProperties[releaseDateProperty.notionProperty] = {
		"date": {
			"start": releaseDate
		}
	};

	return outputProperties;
}

function getGameReviewScore(reviewScoreProperty, appInfoSteamUser, outputProperties) {
	if (!reviewScoreProperty.enabled || !appInfoSteamUser.review_percentage) { return outputProperties; }

	// The reviewScore is not available through the Steam store API, so we have to use the SteamUser API instead
	const steamReviewScore = parseInt(appInfoSteamUser.review_percentage) / 100;

	outputProperties[reviewScoreProperty.notionProperty] = {
		"number": steamReviewScore
	};

	return outputProperties;
}

async function getGameTags(tagsProperty, appInfoSteamUser, outputProperties) {
	if (!tagsProperty.enabled) { return outputProperties; }

	// The tags are not available through the Steam store API, so we have to use the SteamUser API instead
	const tags = appInfoSteamUser.store_tags
		? await getSteamTagNames(appInfoSteamUser.store_tags, tagsProperty.tagLanguage).then((tags) => { return tags; })
		: null;

	if (tags === null) { return outputProperties; }

	outputProperties[tagsProperty.notionProperty] = {
		"multi_select": tags.map((tag) => {
			return {
				"name": tag
			}
		})
	};

	return outputProperties;
}

function getGameDescription(gameDescriptionProperty, appInfoDirect, outputProperties) {
	// Set no description if the value doesn't exist in the Steam store API response, or it is an empty string
	if (!gameDescriptionProperty.enabled || !appInfoDirect.short_description) { return outputProperties; }

	// Notion limits text fields to 2000 characters
	const gameDescription = appInfoDirect.short_description.substring(0, 2000);

	outputProperties[gameDescriptionProperty.notionProperty] = {
		"rich_text": [
			{
				"text": {
					"content": gameDescription
				}
			}
		]
	};

	return outputProperties;
}

function getGameStorePage(storePageProperty, steamAppId, outputProperties) {
	if (!storePageProperty.enabled) { return outputProperties; }

	outputProperties[storePageProperty.notionProperty] = {
		"url": `https://store.steampowered.com/app/${steamAppId}`
	};

	return outputProperties;
}

function getGamePrice(priceProperty, appInfoDirect, outputProperties) {
	if (!priceProperty.enabled || appInfoDirect.price_overview?.initial === undefined || appInfoDirect.price_overview?.initial === null) { return outputProperties; }

	const price = appInfoDirect.price_overview.initial / 100;

	outputProperties[priceProperty.notionProperty] = {
		"number": price
	};

	return outputProperties;
}

function getSteamDeckCompatibility(steamDeckCompatibilityProperty, appInfoSteamUser, outputProperties) {
	if (!steamDeckCompatibilityProperty.enabled) { return outputProperties; }

	let compatibility = "Unknown";
	switch (appInfoSteamUser.steam_deck_compatibility?.category) {
		case "1":
			compatibility = "Unsupported";
			break;
		case "2":
			compatibility = "Playable";
			break;
		case "3":
			compatibility = "Verified";
			break;
		default:
			compatibility = "Unknown";
	}

	outputProperties[steamDeckCompatibilityProperty.notionProperty] = {
		"select": {
			"name": compatibility
		}
	};

	return outputProperties;
}