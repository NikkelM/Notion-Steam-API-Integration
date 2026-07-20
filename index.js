// Author: NikkelM
// Description: Notion integration that watches a database for Steam App IDs and fills in game data from the Steam API
// Backwards-compatible entry point - the CLI (bin/cli.js) is the primary interface

import { loadConfig } from './js/utils.js';
import { run } from './js/notionSteamIntegration.js';

try {
	await run(loadConfig());
} catch (error) {
	console.error("Error: " + (error?.message ?? error));
	process.exit(1);
}
