# Notion Steam API Integration

![Notion Steam API Integration banner](images/NotionSteamAPIIntegration.png)

Notion integration for automatically updating database entries containing a `Steam App ID` with data from the Steam API.
Given a `Steam App ID`, the integration fetches data from the Steam API and fills in a number of pre-determined database fields with the corresponding data.

## Setup

Run `npm install` to install the required dependencies first.

Following this, create a `config.json` file in the root directory of the project and fill it with your desired [configuration](#configuration).

If you haven't already done so, you can obtain a Notion integration key by creating an (internal) Notion integration for your workspace.
You can follow [this guide](https://developers.notion.com/docs/create-a-notion-integration) to learn how to do so.
You will need this key to run the integration locally.

**IMPORTANT: Don't forget to connect the integration to your database, as described in the guide! Otherwise, the integration won't work.**

## Usage

After providing the `config.json` [configuration](#configuration) file, you can run the script using

```bash
node index.js
```

The integration will search the database for new entries that have the `Steam App ID` field set to a value other than `null` and then fetch the corresponding data from the Steam API.
Following this, the database entry will be updated with cleaned up data from the API, such as Steam user review scores and the game's tags.

You are able to have the integration running in the background whilst editing the database.
You can also have database entries without the `Steam App ID` set, these will be ignored by the integration.

If you change the configuration to include new game properties, you will need to run the integration with the `forceReset` flag set to `true` in the configuration, in order to also set the new value for all previously discovered games.

There currently is no way to reset a value that was previously set in the Notion database.

## Configuration

### Schema validation

The project provides a JSON validation schema for the required configuration file, which makes sure that all required information is provided.

The schema can be found in the `config.schema.json` file and used within your `config.json` by adding the following property:

```json
"$schema": "config.schema.json"
```

*NOTE: The script will test your provided `config.json` against this schema, so make sure your configuration is valid.*

### Properties

The following is a list of all configuration items, their defaults and the values they can take.

<details>
<summary><code>notionIntegrationKey</code></summary>

The secret integration key for your Notion integration. Find it on your integration dashboard after creating a new integration on https://www.notion.so/my-integrations.

| Type | Default value | Possible values | Required |
|---|---|---|---|
| `string` | `""` | A valid Notion integration key | Yes |
</details>

<details>
<summary><code>notionDatabaseId</code></summary>

The ID of the database you want to run the integration on. You can find the ID in the URL of your database, e.g. https://www.notion.so/myworkspace/your-database-id.

| Type | Default value | Possible values | Required |
|---|---|---|---|
| `string` | `""` | A valid Notion database ID | Yes |
</details>

<details>
<summary><code>updateInterval</code></summary>

The interval in which the integration will check for updates to your Notion database. The value is in milliseconds. Must be at least 60000 (1 minute).

| Type | Default value | Possible values | Required |
|---|---|---|---|
| `integer` | 60000 | Integers >= 60000 | Yes |
</details>

<details>
<summary><code>forceReset</code></summary>

If true, the integration will reset the local database, fetch all Steam App ID's from the Notion database and refresh all game properties. This may take longer, depending on the size of your Notion database.

| Type | Default value | Possible values | Required |
|---|---|---|---|
| `boolean` | `false` | `true` or `false` | No |
</details>