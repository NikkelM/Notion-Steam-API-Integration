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
				if(cover) { result["cover"] = cover; }
				break;
			case "gameIcon":
				icon = getGameIcon(propertyValue, appInfoSteamUser);
				if(cover) { result["icon"] = icon; }
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

function getGameCoverImage(imageProperty, appInfoDirect, appInfoSteamUser) {
	if (!imageProperty) { return null; }

	// Get the URL for the cover image. Default value has a Steam theme
	const coverUrl = appInfoDirect.header_image
		? appInfoDirect.header_image
		: (appInfoSteamUser.header_image?.english
			? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appInfoSteamUser.gameid}/${appInfoSteamUser.header_image.english}`
			: DEFAULT_COVER_URL);

	return {
		"type": "external",
		"external": {
			"url": coverUrl
		}
	};
}

function getGameIcon(iconProperty, appInfoSteamUser) {
	if (!iconProperty) { return null; }

	// Get the URL for the game icon. Default value has a Steam theme
	// Game icon URL is not available through the Steam store API, so we have to use the SteamUser API
	const iconUrl = appInfoSteamUser.icon
		? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appInfoSteamUser.gameid}/${appInfoSteamUser.icon}.jpg`
		: DEFAULT_ICON_URL;

	return {
		"type": "external",
		"external": {
			"url": iconUrl
		}
	};
}

function getGameReleaseDate(releaseDateProperty, appInfoSteamUser, outputProperties) {
	if (!releaseDateProperty.enabled) { return outputProperties; }

	// Get the release date. If no release date is available, use the Unix epoch
	// The releaseDate format from the Steam API is not in ISO format, so we use the SteamUser API instead
	let releaseDate;
	if (appInfoSteamUser.original_release_date) {
		releaseDate = new Date(parseInt(appInfoSteamUser.original_release_date) * 1000).toISOString();
	} else if (appInfoSteamUser.steam_release_date) {
		releaseDate = new Date(parseInt(appInfoSteamUser.steam_release_date) * 1000).toISOString();
	} else if (appInfoSteamUser.store_asset_mtime) {
		releaseDate = new Date(parseInt(appInfoSteamUser.store_asset_mtime) * 1000).toISOString();
	} else {
		releaseDate = new Date(0);
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
	if (!reviewScoreProperty.enabled) { return outputProperties; }

	// Get the Steam user review score as a percentage
	// The reviewScore is not available through the Steam store API, so we have to use the SteamUser API instead
	const steamReviewScore = appInfoSteamUser.review_percentage
		? parseInt(appInfoSteamUser.review_percentage) / 100
		: null;

	outputProperties[reviewScoreProperty.notionProperty] = {
		"number": steamReviewScore
	};

	return outputProperties;
}

async function getGameTags(tagsProperty, appInfoSteamUser, outputProperties) {
	if (!tagsProperty.enabled) { return outputProperties; }

	// Parse the tags from the Steam API. If no tags are found, set a "No tags found" placeholder
	// The tags are not available through the Steam store API, so we have to use the SteamUser API instead
	const tags = appInfoSteamUser.store_tags
		? await getSteamTagNames(appInfoSteamUser.store_tags, tagsProperty.tagLanguage).then((tags) => { return tags; })
		: ["No tags found"];

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
	if (!gameDescriptionProperty.enabled) { return outputProperties; }

	// Get the game description. If no description is available, set a null
	const gameDescription = appInfoDirect.short_description
		? appInfoDirect.short_description
		: "";

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