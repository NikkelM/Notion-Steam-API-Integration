import { Client } from "@notionhq/client";

import SECRETS from './secrets.json' assert { type: "json" };

const notion = new Client({ auth: SECRETS.NOTION_KEY });

const databaseId = SECRETS.NOTION_DATABASE_ID;

console.log(SECRETS.NOTION_KEY);

async function addItem(text) {
  try {
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        title: {
          title:[
            {
              "text": {
                "content": text
              }
            }
          ]
        }
      },
    })
    console.log(response)
    console.log("Success! Entry added.")
  } catch (error) {
    console.error(error.body)
  }
}

addItem("Yurts in Big Sur, California")
