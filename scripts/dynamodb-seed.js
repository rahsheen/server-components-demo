/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {v4: uuidv4} = require('uuid');
const {readdir, unlink, writeFile} = require('fs/promises');
const startOfYear = require('date-fns/startOfYear');
const credentials = require('../credentials');

const NOTES_PATH = './notes';
/**
 * AWS
 */
const AWS = require('aws-sdk');

AWS.config.update({
  region: 'us-west-2',
  endpoint: 'http://dynamodb:8000',
});

const dynamodb = new AWS.DynamoDB();
const docClient = new AWS.DynamoDB.DocumentClient();

const now = new Date();
const startOfThisYear = startOfYear(now);
// Thanks, https://stackoverflow.com/a/9035732
function randomDateBetween(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime())
  );
}

const table = {
  TableName: 'Notes',
  KeySchema: [
    {AttributeName: 'PK', KeyType: 'HASH'}, // Partition key
    {AttributeName: 'SK', KeyType: 'RANGE'}, // Sort key
  ],
  AttributeDefinitions: [
    {AttributeName: 'PK', AttributeType: 'S'},
    {AttributeName: 'SK', AttributeType: 'S'},
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5,
  },
};

const seedData = [
  [
    'Meeting Notes',
    'This is an example note. It contains **Markdown**!',
    randomDateBetween(startOfThisYear, now),
  ],
  [
    'Make a thing',
    `It's very easy to make some words **bold** and other words *italic* with
Markdown. You can even [link to React's website!](https://www.reactjs.org).`,
    randomDateBetween(startOfThisYear, now),
  ],
  [
    'A note with a very long title because sometimes you need more words',
    `You can write all kinds of [amazing](https://en.wikipedia.org/wiki/The_Amazing)
notes in this app! These note live on the server in the \`notes\` folder.

![This app is powered by React](https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/React_Native_Logo.png/800px-React_Native_Logo.png)`,
    randomDateBetween(startOfThisYear, now),
  ],
  ['I wrote this note today', 'It was an excellent note.', now],
];

async function seed() {
  await dynamodb
    .describeTable({TableName: 'Notes'})
    .promise()
    .then(() =>
      dynamodb
        .deleteTable({
          TableName: 'Notes',
        })
        .promise()
    )
    .then(() => console.log('Deleted existing Notes table.'))
    .catch(() => console.log("Table didn't exist."));

  const createres = await dynamodb
    .createTable(table)
    .promise()
    .catch((err) =>
      console.log(
        'Unable to create table. Error JSON:',
        JSON.stringify(err, null, 2)
      )
    );

  console.log('Created?', !!createres);

  const data = seedData.map(([title, body, createdAt, PK = uuidv4()]) => ({
    TableName: 'Notes',
    Item: {
      PK,
      SK: `note-${PK}`,
      title,
      body,
      createdAt,
      updatedAt: createdAt,
    },
  }));

  await Promise.all(
    data.map((params) => {
      return docClient.put(params).promise();
    })
  ).catch((err) => console.log('Error adding stuff', err));

  console.log('Deleting old notes');
  const oldNotes = await readdir(path.resolve(NOTES_PATH)).catch((e) =>
    console.log('Error getting old notes', e)
  );

  await Promise.all(
    oldNotes
      .filter((filename) => filename.endsWith('.md'))
      .map((filename) => unlink(path.resolve(NOTES_PATH, filename)))
  ).catch((err) => console.log('Error deleting notes', err));

  console.log('Creating new notes files...');
  await Promise.all(
    data.map(({Item}) => {
      const id = Item.PK;
      const content = Item.body;
      const data = new Uint8Array(Buffer.from(content));
      return writeFile(path.resolve(NOTES_PATH, `${id}.md`), data, (err) => {
        if (err) {
          throw err;
        }
      });
    })
  ).catch((e) => console.log('Error creating new notes', e));
}

seed();
