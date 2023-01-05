import { Client } from '@notionhq/client';
import { CONFIG, localDatabase } from './utils.js';

// ---------- Notion API ----------

const NOTION = new Client({ auth: CONFIG.notionIntegrationKey });
const databaseId = CONFIG.notionDatabaseId;

// Get a list of games in the Notion database that have the `Steam App ID` field set and were last edited after our last check. 
export async function getGamesFromDatabase() {
	const games = {}

	async function getPageOfGames(cursor) {
		// While there are more pages left in the query, get pages from the database. 
		const currentPages = await queryDatabase(cursor);

		currentPages.results.forEach(page => games[page.id] = page.properties["Steam App ID"].number);

		if (currentPages.has_more) {
			await getPageOfGames(currentPages.next_cursor)
		}
	}

	await getPageOfGames();
	return games;
};

// Fetch all pages from the database that have been edited since we last accessed the database, and that have a Steam App ID set
async function queryDatabase(cursor) {
	return await NOTION.databases.query({
		database_id: databaseId,
		page_size: 100,
		start_cursor: cursor,
		filter: {
			"and": [
				{
					"timestamp": "last_edited_time",
					"last_edited_time": {
						"after": localDatabase.lastUpdatedAt
					}
				},
				{
					property: "Steam App ID",
					"number": {
						"is_not_empty": true
					}
				}
			]
		}
	});
}

export function updateNotionPage(pageId, properties) {
	// Update the game's page in the database with the new info
	NOTION.pages.update({
		page_id: pageId,
		properties: properties.properties,
		cover: properties.cover,
		icon: properties.icon
	});
}

// Sends a simple request to the database to check if all properties exist in the database
export async function checkNotionPropertiesExistence() {
	const properties = Object.values(CONFIG.gameProperties).map(property => {
		// Skip properties that are disabled or do not have a notionProperty value (e.g. coverImage)
		if (!property.enabled || !property.notionProperty) { return; }
		return property.notionProperty
	}).filter(property => property !== undefined);

	const response = await NOTION.databases.retrieve({
		database_id: databaseId
	});

	for (const property of properties) {
		if (!response.properties[property]) {
			console.error(`Error validating configuration file: Notion database does not contain the property "${property}" specified in the configuration file.`);
			process.exit(1);
		}
	}
}