// Suppresses the warning about the fetch API being unstable
process.removeAllListeners('warning');

import fs from 'fs';
import readline from 'readline';
import stringSimilarity from 'string-similarity';

// ---------- Setup ----------

const platformName = "Epic Games";
console.log("Assuming the platform of the games is called \"" + platformName + "\". If this is not correct, change the variable \"platformName\" in the script. This is only used for the resulting .csv files.\n")

// Create the output directory if it doesn't exist
if (!fs.existsSync('./output')) {
	fs.mkdirSync('./output');
}

// A JSON object with all Steam games
console.log("Fetching Steam games...");
const steamApps = await fetch("https://api.steampowered.com/ISteamApps/GetAppList/v2/")
	.then((response) => response.json())
	.then((data) => data.applist.apps);

console.log("Found " + steamApps.length + " Steam games.\n");

// ---------- Import the game names ----------

let gameNames = {}

const readLine = readline.createInterface({
	input: fs.createReadStream('./input/gameNames.txt')
});

// Set a default App ID value of -1 for each game
readLine.on('line', (line) => {
	gameNames[line] = -1;
});

await new Promise((res) => readLine.once('close', res));

const numGameNames = Object.keys(gameNames).length;
console.log("\"./input/gameNames.txt\" contained " + numGameNames + " game names for which to find the Steam App Id's.\n");

// ---------- Find a Steam App ID for each game ----------

// ----- Full matches -----

console.log("Searching for full matches...\n");

// Get all games where the name is a full match
let steamIDsFullMatch = {};
for (const game in gameNames) {
	const bestMatch = steamApps.find((app) => app.name === game);
	if (bestMatch) {
		steamIDsFullMatch[game] = bestMatch.appid;
		// Remove the found game from gameNames to not be searched again in the next step
		delete gameNames[game];
	}
}

console.log("Found a full match for " + Object.keys(steamIDsFullMatch).length + "/" + numGameNames + " games.");
console.log("Writing game names and Steam App Id's to \"./output/steamAppIds_fullMatch.json\"...\n");

// Save the full matches to a .json file
var json = JSON.stringify(steamIDsFullMatch);
fs.writeFileSync('./output/steamAppIds_fullMatch.json', json);

// ----- Best matches -----

console.log("Searching for best matches using string similarity...\n");

// For all games we couldn't get a full match, find the most similar title
// Some manual cleanup may be necessary
let steamIDsBestMatch = {};
for (const game in gameNames) {
	const bestMatch = stringSimilarity.findBestMatch(game, steamApps.map((app) => app.name));
	steamIDsBestMatch[game] = {
		"appId": steamApps[bestMatch.bestMatchIndex].appid,
		"similarity": bestMatch.bestMatch.rating,
		"steamName": steamApps[bestMatch.bestMatchIndex].name
	}
}

console.log("Found a partial match for the remaining " + (numGameNames - Object.keys(steamIDsFullMatch).length) + " games.");
console.log("Writing game names and Steam App Id's to \"./output/steamAppIds_bestMatch.json\"...\n");

// Save the best matches to a .json file
var json = JSON.stringify(steamIDsBestMatch);
fs.writeFileSync('./output/steamAppIds_bestMatch.json', json);

// ---------- Create .csv files for Notion import ----------

console.log("Creating .csv files with default values for Notion import...");

// Create a .csv to import to Notion for the full matches
let csvFullMatch = "Steam App ID,Platform,Status,My Review\n";
for (const game in steamIDsFullMatch) {
	csvFullMatch += `${steamIDsFullMatch[game]},${platformName},Backlog,Unreviewed\n`;
}
fs.writeFileSync('./output/steamAppIds_fullMatch.csv', csvFullMatch);

// Create a .csv to import to Notion for the best matches
// Make sure to clean this up before importing to Notion if you want to make sure the games are correct
let csvBestMatch = "Steam App ID,Platform,Status,My Review\n";
for (const game in steamIDsBestMatch) {
	csvBestMatch += `${steamIDsBestMatch[game].appId},${platformName},Backlog,Unreviewed\n`;
}
fs.writeFileSync('./output/steamAppIds_bestMatch.csv', csvBestMatch);