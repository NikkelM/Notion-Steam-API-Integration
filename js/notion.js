import { Client } from '@notionhq/client';
import { CONFIG, localDatabase } from './utils.js';

// ---------- Notion API ----------

const NOTION = new Client({ auth: CONFIG.notionIntegrationKey });
const databaseId = CONFIG.notionDatabaseId;

// Get a list of games in the Notion database that have the `Steam App ID` field set and were last edited after our last check. 
export async function getGamesFromNotionDatabase() {
	const appIds = {};
	const lastEditedBy = {};
	const lastUpdatedAt = await localDatabase.get('lastUpdatedAt');

	async function getPageOfGames(cursor) {
		// While there are more pages left in the query, get pages from the database. 
		const currentPages = await queryDatabase(cursor, lastUpdatedAt);

		currentPages.results.forEach(page => {
			appIds[page.id] = page.properties[CONFIG.steamAppIdProperty].number;
			lastEditedBy[page.id] = page.last_edited_by.id;
		});

		if (currentPages.has_more) {
			await getPageOfGames(currentPages.next_cursor)
		}
	}

	await getPageOfGames();

	return [appIds, lastEditedBy];
};

// Fetch all pages from the database that have been edited since we last accessed the database, and that have a Steam App ID set
async function queryDatabase(cursor, lastUpdatedAt) {
	return await NOTION.databases.query({
		database_id: databaseId,
		page_size: 100,
		start_cursor: cursor,
		filter: {
			"and": [
				{
					"timestamp": "last_edited_time",
					"last_edited_time": {
						"after": lastUpdatedAt
					}
				},
				{
					property: CONFIG.steamAppIdProperty,
					"number": {
						"is_not_empty": true
					}
				}
			]
		}
	});
}

export async function updateNotionPage(pageId, properties) {
	// Update the game's page in the database with the new info
	await NOTION.pages.update({
		page_id: pageId,
		properties: properties.properties,
		cover: properties.cover,
		icon: properties.icon
	});
}

export async function updateNotionBlock(blockId, children) {
	// Update the game's page in the database with the new info
	await NOTION.blocks.children.append({
		block_id: blockId,
		// children is a lost of blocks
		children: children
	});
}

// Sends a simple request to the database to check if all properties exist in the database
export async function checkNotionPropertiesExistence() {
	// Get a list of all enabled properties
	let properties = Object.values(CONFIG.gameProperties).map(property => {
		// Skip properties that are disabled or do not have a notionProperty value (e.g. coverImage)
		if (!property.enabled || !property.notionProperty) { return; }
		return property.notionProperty
	}).filter(property => property !== undefined);

	// Add the Steam App ID property to the list of properties to check
	properties.push(CONFIG.steamAppIdProperty);

	const response = await NOTION.databases.retrieve({
		database_id: databaseId
	});

	// If any of the properties are not found in the database, exit the program
	for (const property of properties) {
		if (!response.properties[property]) {
			console.error(`Error validating configuration file: Notion database does not contain the property "${property}" specified in the configuration file.`);
			process.exit(1);
		}
	}
}

export async function setUserIdInDatabaseIfNotSet() {
	try {
		await localDatabase.get('userId');
	} catch (error) {
		// If the user ID is not set, set it
		const response = await NOTION.users.me();
		await localDatabase.put('userId', response.id);
	}
}