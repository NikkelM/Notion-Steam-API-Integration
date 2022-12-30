import { Client } from "@notionhq/client";
import fs from 'fs';

import SECRETS from './secrets.json' assert { type: "json" };

const notion = new Client({ auth: SECRETS.NOTION_KEY });

const databaseId = SECRETS.NOTION_DATABASE_ID;

// Create an empty local store of all games in the database if it doesn't exist
if (!fs.existsSync('./gamesInDatabase.json')) {
	fs.writeFileSync('./gamesInDatabase.json', JSON.stringify({}));
}

// A JSON Object to hold all games in the Notion database
let gamesInDatabase = JSON.parse(fs.readFileSync('./gamesInDatabase.json'));

async function findChangesAndAddDetails() {
	console.log("Looking for changes in Notion database...");

	// Get the games currently in the database
	const currGamesInDatabase = await getGamesFromDatabase();

	// Iterate over the current games and compare them to games in our local store (gamesInDatabase)
	for (const [pageId, SteamAppId] of Object.entries(currGamesInDatabase)) {
		// If this game hasn't been seen before
		if (!(pageId in gamesInDatabase)) {
			console.log("New game found: " + pageId);
			// Add this game to the local store of all games
			gamesInDatabase[pageId] = SteamAppId;
			fs.writeFileSync('gamesInDatabase.json', JSON.stringify(gamesInDatabase));
			// TODO: Add details in db
		}
	}
	// Run this method every 5 seconds (5000 milliseconds)
	setTimeout(main, 5000)
}


function main() {
	findChangesAndAddDetails().catch(console.error);
}

(async () => {
	// gamesInDatabase = await getGamesFromDatabase();
	console.log(gamesInDatabase);
	main();
})();

// Get a paginated list of Games currently in the database. 
async function getGamesFromDatabase() {

	const games = {}

	async function getPageOfGames(cursor) {
		let requestPayload = "";
		// Create the request payload based on the presense of a start_cursor
		if (cursor == undefined) {
			requestPayload = {
				path: 'databases/' + databaseId + '/query',
				method: 'POST',
			}
		} else {
			requestPayload = {
				path: 'databases/' + databaseId + '/query',
				method: 'POST',
				body: {
					"start_cursor": cursor
				}
			}
		}
		// While there are more pages left in the query, get pages from the database. 
		const currentPages = await notion.request(requestPayload)

		for (const page of currentPages.results) {
			// If the page has a set Steam App ID, we can work with it, so we save it to the local cache
			if (page.properties["Steam App ID"].number !== null) {
				games[page.id] = page.properties["Steam App ID"].number;
			}
		}
		if (currentPages.has_more) {
			await getPageOfGames(currentPages.next_cursor)
		}

	}
	await getPageOfGames();
	return games;
}; 
