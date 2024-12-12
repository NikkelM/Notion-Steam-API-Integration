import { getSteamTagNames } from './steamAPI.js';
import { CONFIG } from './utils.js';

export async function getGameProperties(appInfoDirect, appInfoSteamUser, appInfoReviews, steamAppId) {
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
				outputProperties = getGameReleaseDate(propertyValue, appInfoDirect, outputProperties);
				break;
			case "reviewScore":
				outputProperties = getGameReviewScore(propertyValue, appInfoReviews, outputProperties);
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
			case "gameDevelopers":
				outputProperties = await getGameDevelopers(propertyValue, appInfoDirect, outputProperties);
				break;
			case "gamePublishers":
				outputProperties = await getGamePublishers(propertyValue, appInfoDirect, outputProperties);
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

function getGameReleaseDate(releaseDateProperty, appInfoDirect, outputProperties) {
	if (!releaseDateProperty.enabled) { return outputProperties; }

	// Note: If no release date is available, we don't set it at all in the database
	let releaseDate;
	if (appInfoDirect.release_date?.date) {
		// We need to distinguish three cases: Only the year is given ('2023'), year and month ('March 2023'), or year, month and day ('13 Mar, 2023')
		// In cases where data is missing, we add the last day of the year or the first day of the month (as the last day of the month differs between months)
		// We always add 00:00 UTC as the time, as the date is always given in UTC and we don't want to convert it to the local timezone
		try {
			// We wrap this in a try-catch block as developers can set things other than dates, such as 'To be announced', which will raise an error during conversion
			const parsedDate = new Date(appInfoDirect.release_date.date).toISOString();
		} catch (error) {
			return outputProperties;
		}

		const dateSpecificity = appInfoDirect.release_date.date.split(" ").length;
		if (dateSpecificity == 1) {
			releaseDate = new Date(appInfoDirect.release_date.date + '-12-31 00:00 UTC').toISOString();
		} else if (dateSpecificity == 2) {
			releaseDate = new Date(appInfoDirect.release_date.date + '-01 00:00 UTC').toISOString();
		} else if (dateSpecificity == 3) {
			releaseDate = new Date(appInfoDirect.release_date.date + ' 00:00 UTC').toISOString();
		} else {
			console.warn('!!!The release date format received from the Steam store API is unknown to the integration.\n!!!Please report this to the developer and include the following output:');
			console.log(appInfoDirect);
			return outputProperties;
		}
	} else {
		return outputProperties;
	}

	// We only want the date, not the time, as the store API doesn't provide the time
	releaseDate = releaseDate.split("T")[0];

	outputProperties[releaseDateProperty.notionProperty] = {
		"date": {
			"start": releaseDate
		}
	};

	return outputProperties;
}

function getGameReviewScore(reviewScoreProperty, appInfoReviews, outputProperties) {
	if (!reviewScoreProperty.enabled || !appInfoReviews) { return outputProperties; }
	let notionReviewObject;

	switch (reviewScoreProperty.format) {
		case "percentage":
			notionReviewObject = {
				"number": parseFloat((appInfoReviews.total_positive / appInfoReviews.total_reviews).toFixed(2))
			};
			break;
		case "sentiment":
			notionReviewObject = {
				"select": {
					"name": appInfoReviews.review_score_desc
				}
			};
			break;
		case "total":
			notionReviewObject = {
				"number": appInfoReviews.total_reviews
			};
			break;
		case "positive":
			notionReviewObject = {
				"number": appInfoReviews.total_positive
			};
			break;
		case "negative":
			notionReviewObject = {
				"number": appInfoReviews.total_negative
			};
			break;
		case "positive/negative":
			notionReviewObject = {
				"rich_text": [
					{
						"text": {
							"content": `${appInfoReviews.total_positive} positive / ${appInfoReviews.total_negative} negative`
						}
					}
				]
			};
			break;
	}

	outputProperties[reviewScoreProperty.notionProperty] = notionReviewObject;

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

function getGameDevelopers(developerProperty, appInfoDirect, outputProperties) {
	if (!developerProperty.enabled || !appInfoDirect.developers) { return outputProperties; }

	// Output property is multi-select, as games can have multiple developers in the API
	outputProperties[developerProperty.notionProperty] = {
		"multi_select": appInfoDirect.developers.map((developer) => {
			return {
				"name": developer
			}
		})
	};

	return outputProperties;
}

function getGamePublishers(publisherProperty, appInfoDirect, outputProperties) {
	if (!publisherProperty.enabled || !appInfoDirect.publishers) { return outputProperties; }

	// Output property is multi-select, as games can have multiple publishers in the API
	outputProperties[publisherProperty.notionProperty] = {
		"multi_select": appInfoDirect.publishers.map((publisher) => {
			return {
				"name": publisher
			}
		})
	};

	return outputProperties;
}
