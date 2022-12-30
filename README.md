# Notion Steam API Integration

Notion integration for automatically updating database entries containing a `Steam App Id` with data from the Steam API.
Given a `Steam App Id`, the integration fetches data from the Steam API and fills in a number of database fields with the corresponding data.

## Setup

Start by installing the needed dependencies:

```bash
npm install
```

Continue with creating a `secrets.json` file in the root folder that will hold your Notion integration's secret key as well as the id of your database, in the following format:

```json
{
	"NOTION_KEY": "<SECRET_KEY>",
	"NOTION_DATABASE_ID": "<DATABASE_ID>"
}
```

If you haven't already done so, you can obtain a Notion integration key by creating an (internal) Notion integration for your workspace.
You can follow [this guide](https://developers.notion.com/docs/create-a-notion-integration) to learn how to do so.

**IMPORTANT: Don't forget to connect the integration to your database, as described in the guide! Otherwise, the integration won't work.**

## Database structure

The integration makes a number of assumptions about your database's structure, more specifically that it has the following properties:

| Property name | Data type |
|---|---|
| Release | Date |
| Store page | URL |
| Steam Reviews | Number shown as percentage |
| Tags | Multi-select |

Additionally, the `Title` of a database entry must be named `Name`.

## Usage

Whenever you want to update the database with new (Steam) games, simply run `node index.js`.
The integration will search the database for new entries that have the `Steam App Id` field set and then fetch the corresponding data from the Steam API.
Following this, the database entry will be updated with cleaned up data from the API, such as Steam user review scores and the game's tags.

You are able to have the integration running in the background whilst editing the database.
You can also have database entries without a `Steam App Id` set, which will be ignored by the integration.