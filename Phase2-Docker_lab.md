# Phase 2: Multi-Container Docker App with API Calls, Worker Processing, and MongoDB

Container interaction:

1. A browser sends a prompt to the `api` container.
2. The `api` container saves the prompt as a job in MongoDB.
3. The `worker` container reads queued jobs from MongoDB.
4. The `worker` container calls an OpenAI-compatible ChatGPT API.
5. The `worker` container stores the API response back in MongoDB.
6. The browser refreshes the job list from the `api` container and shows the saved response.

The result is a real multi-container workflow:

```text
Browser -> api container -> mongodb container -> worker container -> ChatGPT/OpenAI API
                                      ^                              |
                                      |______________________________|
```

## What Students Will Build

Students will build a project with three containers:

| Container | Purpose |
|-----------|---------|
| `api` | Runs an Express web app. It accepts prompts, stores jobs in MongoDB, and displays results. |
| `worker` | Runs a background Node.js process. It reads queued jobs from MongoDB, calls the chat API, and saves responses. |
| `mongodb` | Stores prompts, job status, API responses, and timestamps. |

## Important API Key Note

This lab supports two modes:

1. **Real API mode**
   - Uses an OpenAI API key.
   - The worker makes a real request to the OpenAI Chat Completions API.
2. **Demo mode**
   - Does not require an API key.
   - The worker creates a fake AI-style response so the Docker and database workflow can still be tested.

If your class has OpenAI API keys available, use real API mode. If not, use demo mode. The container-to-container database interaction works in both modes.

---

# Part 1 - Create the Project Folder

Create a new folder named `phase2-docker-lab`.

```bash
mkdir phase2-docker-lab
cd phase2-docker-lab
mkdir api worker
```

After running those commands, your terminal should be inside the main `phase2-docker-lab` folder.

## Exact File Structure

Create the following file structure:

```text
phase2-docker-lab/
|
+-- .env
+-- docker-compose.yml
|
+-- api/
|   +-- Dockerfile
|   +-- package.json
|   +-- server.js
|
+-- worker/
    +-- Dockerfile
    +-- package.json
    +-- worker.js
```

The `docker-compose.yml` and `.env` files must be in the main `phase2-docker-lab` folder. The API files must be inside the `api` folder. The worker files must be inside the `worker` folder.

---

# Part 2 - Create the Environment File

Create a file named `.env` in the main `phase2-docker-lab` folder.

## Option A: Demo Mode Without an API Key

Use this version if students do not have an OpenAI API key:

```env
DEMO_MODE=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Expected behavior in demo mode:

- The app still saves prompts to MongoDB.
- The worker still reads prompts from MongoDB.
- The worker stores a demo response in MongoDB.
- No external API call is made.

## Option B: Real API Mode with an OpenAI API Key

Use this version if students have an OpenAI API key:

```env
DEMO_MODE=false
OPENAI_API_KEY=replace_this_with_your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

Replace `replace_this_with_your_openai_api_key` with the real API key.

Important:

- Do not include quotation marks around the API key.
- Do not commit or publicly share the `.env` file.
- If the API key is invalid, missing, or has no credits, the worker will mark the job as `failed`.

---

# Part 3 - Create the API Container Files

The API container runs the web app that students will open in the browser.

## api/package.json

Create `api/package.json` with this exact content:

```json
{
  "name": "phase2-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mongodb": "^6.8.0"
  }
}
```

## api/server.js

Create `api/server.js` with this exact content:

```javascript
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://mongodb:27017/phase2';
const dbName = process.env.DB_NAME || 'phase2';

app.use(express.json());

let jobs;

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Phase 2 Docker AI Worker Lab</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
      line-height: 1.5;
    }
    textarea {
      width: 100%;
      min-height: 90px;
      font-size: 16px;
      padding: 10px;
    }
    button {
      margin-top: 10px;
      padding: 10px 14px;
      cursor: pointer;
    }
    .job {
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 12px;
      margin: 12px 0;
      background: #f8f8f8;
    }
    .status {
      font-weight: bold;
    }
    pre {
      white-space: pre-wrap;
      background: #fff;
      padding: 10px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <h1>Phase 2 Docker AI Worker Lab</h1>
  <p>
    Submit a prompt. The API container saves it to MongoDB.
    The worker container reads it, calls the chat API or demo mode,
    then stores the response back in MongoDB.
  </p>

  <form id="promptForm">
    <label for="prompt"><strong>Prompt</strong></label>
    <textarea id="prompt" placeholder="Example: Explain Docker volumes in one paragraph."></textarea>
    <br />
    <button type="submit">Submit Prompt Job</button>
  </form>

  <p id="message"></p>

  <h2>Recent Jobs</h2>
  <button id="refreshButton" type="button">Refresh Jobs</button>
  <div id="jobs"></div>

  <script>
    const form = document.getElementById('promptForm');
    const promptInput = document.getElementById('prompt');
    const message = document.getElementById('message');
    const jobsContainer = document.getElementById('jobs');
    const refreshButton = document.getElementById('refreshButton');

    function formatDate(value) {
      return value ? new Date(value).toLocaleString() : 'not set';
    }

    function renderJobs(jobs) {
      jobsContainer.innerHTML = '';

      if (jobs.length === 0) {
        jobsContainer.textContent = 'No jobs have been submitted yet.';
        return;
      }

      jobs.forEach((job) => {
        const item = document.createElement('div');
        item.className = 'job';

        const prompt = document.createElement('pre');
        prompt.textContent = job.prompt;

        const response = document.createElement('pre');
        response.textContent = job.response || job.error || 'No response yet. Refresh again in a few seconds.';

        item.innerHTML = '<div><span class="status">Status:</span> ' + job.status + '</div>' +
          '<div><strong>Job ID:</strong> ' + job._id + '</div>' +
          '<div><strong>Created:</strong> ' + formatDate(job.createdAt) + '</div>' +
          '<div><strong>Updated:</strong> ' + formatDate(job.updatedAt) + '</div>' +
          '<div><strong>Prompt:</strong></div>';

        item.appendChild(prompt);
        item.insertAdjacentHTML('beforeend', '<div><strong>Response:</strong></div>');
        item.appendChild(response);
        jobsContainer.appendChild(item);
      });
    }

    async function loadJobs() {
      const res = await fetch('/api/jobs');
      const jobs = await res.json();
      renderJobs(jobs);
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = 'Submitting job...';

      const prompt = promptInput.value.trim();
      if (!prompt) {
        message.textContent = 'Please enter a prompt first.';
        return;
      }

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      });

      const job = await res.json();
      message.textContent = 'Created job ' + job._id + '. Refresh in a few seconds to see the worker result.';
      promptInput.value = '';
      await loadJobs();
    });

    refreshButton.addEventListener('click', loadJobs);
    loadJobs();
    setInterval(loadJobs, 4000);
  </script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.type('html').send(page);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/jobs', async (req, res) => {
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const result = await jobs.insertOne({
    prompt,
    status: 'queued',
    response: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const created = await jobs.findOne({ _id: result.insertedId });
  res.status(201).json(created);
});

app.get('/api/jobs', async (req, res) => {
  const recentJobs = await jobs
    .find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  res.json(recentJobs);
});

app.get('/api/jobs/:id', async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid job ID.' });
  }

  const job = await jobs.findOne({ _id: new ObjectId(req.params.id) });

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  res.json(job);
});

async function start() {
  const client = new MongoClient(mongoUrl);
  await client.connect();

  const db = client.db(dbName);
  jobs = db.collection('jobs');
  await jobs.createIndex({ status: 1, createdAt: 1 });

  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
    console.log(`Connected to MongoDB database "${dbName}"`);
  });
}

start().catch((error) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
```

## api/Dockerfile

Create `api/Dockerfile` with this exact content:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY server.js .

EXPOSE 3000

CMD ["npm", "start"]
```

---

# Part 4 - Create the Worker Container Files

The worker container does not serve a web page. It runs in the background and repeatedly checks MongoDB for queued jobs.

## worker/package.json

Create `worker/package.json` with this exact content:

```json
{
  "name": "phase2-worker",
  "version": "1.0.0",
  "main": "worker.js",
  "scripts": {
    "start": "node worker.js"
  },
  "dependencies": {
    "mongodb": "^6.8.0"
  }
}
```

## worker/worker.js

Create `worker/worker.js` with this exact content:

```javascript
const { MongoClient } = require('mongodb');

const mongoUrl = process.env.MONGO_URL || 'mongodb://mongodb:27017/phase2';
const dbName = process.env.DB_NAME || 'phase2';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 3000);
const demoMode = process.env.DEMO_MODE !== 'false';
const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let jobs;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDemoResponse(prompt) {
  return [
    'Demo mode response:',
    `You asked: "${prompt}"`,
    'This response was generated by the worker container without calling an external API.',
    'The important Docker concept is that this text was saved back into MongoDB by a different container.'
  ].join('\n');
}

async function callOpenAi(prompt) {
  if (demoMode || !openAiApiKey) {
    return createDemoResponse(prompt);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: openAiModel,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant for a Docker lab. Keep answers concise and educational.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function claimNextJob() {
  return jobs.findOneAndUpdate(
    { status: 'queued' },
    {
      $set: {
        status: 'processing',
        updatedAt: new Date()
      }
    },
    {
      sort: { createdAt: 1 },
      returnDocument: 'after',
      includeResultMetadata: false
    }
  );
}

async function processJob(job) {
  console.log(`Processing job ${job._id}`);

  try {
    const response = await callOpenAi(job.prompt);

    await jobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'completed',
          response,
          error: null,
          updatedAt: new Date()
        }
      }
    );

    console.log(`Completed job ${job._id}`);
  } catch (error) {
    await jobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'failed',
          response: null,
          error: error.message,
          updatedAt: new Date()
        }
      }
    );

    console.error(`Failed job ${job._id}:`, error.message);
  }
}

async function workLoop() {
  while (true) {
    const job = await claimNextJob();

    if (job) {
      await processJob(job);
    } else {
      await sleep(pollIntervalMs);
    }
  }
}

async function start() {
  const client = new MongoClient(mongoUrl);
  await client.connect();

  const db = client.db(dbName);
  jobs = db.collection('jobs');
  await jobs.createIndex({ status: 1, createdAt: 1 });

  console.log(`Worker connected to MongoDB database "${dbName}"`);
  console.log(`Worker demo mode: ${demoMode}`);
  console.log(`Worker polling every ${pollIntervalMs} ms`);

  await workLoop();
}

start().catch((error) => {
  console.error('Worker failed:', error);
  process.exit(1);
});
```

## worker/Dockerfile

Create `worker/Dockerfile` with this exact content:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY worker.js .

CMD ["npm", "start"]
```

---

# Part 5 - Create the Docker Compose File

Create `docker-compose.yml` in the main `phase2-docker-lab` folder with this exact content:

```yaml
services:
  api:
    build: ./api
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      MONGO_URL: mongodb://mongodb:27017/phase2
      DB_NAME: phase2
      PORT: 3000
    depends_on:
      mongodb:
        condition: service_healthy

  worker:
    build: ./worker
    env_file:
      - .env
    environment:
      MONGO_URL: mongodb://mongodb:27017/phase2
      DB_NAME: phase2
      POLL_INTERVAL_MS: 3000
    depends_on:
      mongodb:
        condition: service_healthy

  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - phase2-mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  phase2-mongo-data:
```

## What This Compose File Does

- Builds the `api` image from the `api` folder.
- Builds the `worker` image from the `worker` folder.
- Pulls the official `mongo:7` image for the database.
- Creates a named volume called `phase2-mongo-data`.
- Gives the API and worker the same MongoDB connection string.
- Waits for MongoDB to become healthy before starting the API and worker.
- Places all three services on the same default Docker Compose network.

The API and worker can reach MongoDB using this hostname:

```text
mongodb
```

That hostname works because `mongodb` is the service name in `docker-compose.yml`.

---

# Part 6 - Build and Start the Application

Make sure docker/rancher desktop are up and running. 
Make sure your terminal is in the main `phase2-docker-lab` folder.

Run:

```bash
docker compose up --build
```

Expected output will be long the first time because Docker installs Node dependencies and pulls MongoDB. The output should eventually show lines similar to these:

```text
[+] Building
 ✔ api                         Built
 ✔ worker                      Built
[+] Running
 ✔ Network phase2-docker-lab_default             Created
 ✔ Volume "phase2-docker-lab_phase2-mongo-data"  Created
 ✔ Container phase2-docker-lab-mongodb-1         Created
 ✔ Container phase2-docker-lab-api-1             Created
 ✔ Container phase2-docker-lab-worker-1          Created
api-1      | API listening on port 3000
api-1      | Connected to MongoDB database "phase2"
worker-1   | Worker connected to MongoDB database "phase2"
worker-1   | Worker demo mode: true
worker-1   | Worker polling every 3000 ms
mongodb-1  | ... Waiting for connections
```

If using real API mode, the worker line should say:

```text
worker-1   | Worker demo mode: false
```

Keep this terminal open because it shows logs from all containers.

---

# Part 7 - Verify the Containers Are Running

Open a second terminal window. Go to the same project folder:

```bash
cd phase2-docker-lab
docker compose ps
```

Expected output should show three services:

```text
NAME                           IMAGE                    SERVICE   STATUS
phase2-docker-lab-api-1        phase2-docker-lab-api    api       Up
phase2-docker-lab-mongodb-1    mongo:7                  mongodb   Up (healthy)
phase2-docker-lab-worker-1     phase2-docker-lab-worker worker    Up
```

The exact spacing, image names, and container names may vary slightly. The important details are:

- `api` is running.
- `mongodb` is running and healthy.
- `worker` is running.

---

# Part 8 - Open the Web App

Open this URL in a browser:

```text
http://localhost:3000
```

Students should see a page titled:

```text
Phase 2 Docker AI Worker Lab
```

The page should include:

- A prompt text box.
- A `Submit Prompt Job` button.
- A `Refresh Jobs` button.
- A `Recent Jobs` section.

Before submitting anything, the Recent Jobs section should say:

```text
No jobs have been submitted yet.
```

---

# Part 9 - Submit a Prompt Job

In the browser text box, enter this prompt:

```text
Explain Docker volumes in one short paragraph.
```

Click:

```text
Submit Prompt Job
```

Expected browser message:

```text
Created job <job-id>. Refresh in a few seconds to see the worker result.
```

The job should first appear with a status such as:

```text
Status: queued
```

or:

```text
Status: processing
```

After a few seconds, the status should change to:

```text
Status: completed
```

In demo mode, the response should look similar to this:

```text
Demo mode response:
You asked: "Explain Docker volumes in one short paragraph."
This response was generated by the worker container without calling an external API.
The important Docker concept is that this text was saved back into MongoDB by a different container.
```

In real API mode, the response should be a real ChatGPT-style answer about Docker volumes.

---

# Part 10 - Watch the Worker Logs

Return to the terminal running `docker compose up --build`.

When a prompt is submitted, students should see worker logs similar to:

```text
worker-1  | Processing job 6661a2b3c4d5e6f789012345
worker-1  | Completed job 6661a2b3c4d5e6f789012345
```

This proves that the worker container found a job in MongoDB and processed it.

If using real API mode and the API key is invalid, students may see:

```text
worker-1  | Failed job 6661a2b3c4d5e6f789012345: OpenAI API request failed with status 401
```

If that happens:

1. Check the `.env` file.
2. Confirm `DEMO_MODE=false`.
3. Confirm `OPENAI_API_KEY` contains a valid key.
4. Restart the containers with:

```bash
docker compose down
docker compose up --build
```

---

# Part 11 - Verify the Data Is Stored in MongoDB

Open a second terminal in the main `phase2-docker-lab` folder.

Find the MongoDB container:

```bash
docker compose ps
```

The MongoDB container name should be similar to:

```text
phase2-docker-lab-mongodb-1
```

Open the MongoDB shell inside the running MongoDB container:

```bash
docker exec -it phase2-docker-lab-mongodb-1 mongosh
```

If the command works, students should see output similar to:

```text
Current Mongosh Log ID: 6661a2b3c4d5e6f789012345
Connecting to:          mongodb://127.0.0.1:27017/
Using MongoDB:          7.0.x
Using Mongosh:          2.x.x

test>
```

Run these MongoDB commands:

```javascript
use phase2
db.jobs.find().pretty()
```

Expected output should include one or more job documents:

```text
[
  {
    _id: ObjectId('6661a2b3c4d5e6f789012345'),
    prompt: 'Explain Docker volumes in one short paragraph.',
    status: 'completed',
    response: 'Demo mode response:\nYou asked: "Explain Docker volumes in one short paragraph."...',
    error: null,
    createdAt: ISODate('2026-06-17T18:00:00.000Z'),
    updatedAt: ISODate('2026-06-17T18:00:04.000Z')
  }
]
```

The ObjectId values and timestamps will be different.

This proves the database is not unrelated to the app. The app and worker are both using the same MongoDB database:

- The `api` container inserted the job.
- The `worker` container updated the job.
- The `api` container read the completed job back and displayed it in the browser.

Exit the MongoDB shell:

```javascript
exit
```

---

# Part 12 - Show Container Interaction Clearly

Use these commands to demonstrate the full interaction.

## 1. Show all containers

```bash
docker compose ps
```

Expected:

```text
api       Up
mongodb   Up (healthy)
worker    Up
```

## 2. Show API logs

```bash
docker compose logs api
```

Expected:

```text
api-1  | API listening on port 3000
api-1  | Connected to MongoDB database "phase2"
```

## 3. Show worker logs

```bash
docker compose logs worker
```

Expected:

```text
worker-1  | Worker connected to MongoDB database "phase2"
worker-1  | Worker demo mode: true
worker-1  | Worker polling every 3000 ms
worker-1  | Processing job <job-id>
worker-1  | Completed job <job-id>
```

In real API mode, the demo mode line should be:

```text
worker-1  | Worker demo mode: false
```

## 4. Show database contents

```bash
docker exec -it phase2-docker-lab-mongodb-1 mongosh
```

Then inside `mongosh`:

```javascript
use phase2
db.jobs.find({}, { prompt: 1, status: 1, response: 1 }).pretty()
```

Expected:

```text
[
  {
    _id: ObjectId('6661a2b3c4d5e6f789012345'),
    prompt: 'Explain Docker volumes in one short paragraph.',
    status: 'completed',
    response: 'Demo mode response:\nYou asked: "Explain Docker volumes in one short paragraph."...'
  }
]
```

This is the main evidence for the lab: the containers are not just running next to each other. They are communicating through MongoDB.

---

# Part 13 - Stop and Restart the App

Stop the containers:

```bash
docker compose down
```

Start them again:

```bash
docker compose up --build
```

Open the browser again:

```text
http://localhost:3000
```

Expected result:

- The previous job should still appear.
- The response should still be visible.

This happens because MongoDB stores data in the named Docker volume:

```text
phase2-mongo-data
```

The containers were stopped and recreated, but the database files remained in the volume.

---

# Part 14 - Reset the Lab Completely

Only use this command if the instructor wants students to delete all saved MongoDB data:

```bash
docker compose down -v
```

The `-v` flag removes the named Docker volume. After running this command, start again:

```bash
docker compose up --build
```

Expected browser result:

```text
No jobs have been submitted yet.
```

This means the database was reset.

---

# Part 15 - Troubleshooting

## Problem: The browser cannot open localhost:3000

Check that the API container is running:

```bash
docker compose ps
```

If port 3000 is already in use, change this line in `docker-compose.yml`:

```yaml
- "3000:3000"
```

to:

```yaml
- "3001:3000"
```

Then open:

```text
http://localhost:3001
```

## Problem: MongoDB is not healthy

Check MongoDB logs:

```bash
docker compose logs mongodb
```

If needed, restart:

```bash
docker compose down
docker compose up --build
```

## Problem: Jobs stay queued

Check worker logs:

```bash
docker compose logs worker
```

Common causes:

- The worker container is not running.
- The worker cannot connect to MongoDB.
- The `.env` file is missing.
- Real API mode is enabled but the API key is invalid.

## Problem: Job status is failed

Check the error stored in MongoDB:

```bash
docker exec -it phase2-docker-lab-mongodb-1 mongosh
```

Then:

```javascript
use phase2
db.jobs.find({ status: "failed" }).pretty()
```

If the error mentions the OpenAI API, either fix the API key or switch back to demo mode:

```env
DEMO_MODE=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Then restart:

```bash
docker compose down
docker compose up --build
```

---

# Final Student Deliverables

Students should submit screenshots showing:

1. The exact project file structure.
2. `docker compose ps` with `api`, `worker`, and `mongodb` running.
3. The browser page at `http://localhost:3000`.
4. A submitted prompt with status `completed`.
5. Worker logs showing `Processing job` and `Completed job`.
6. MongoDB output showing the saved prompt and response in the `jobs` collection.

Students should also submit these files. If real API mode was used, the API key in `.env` must be removed or replaced with `REDACTED` before submission.

- `.env` with the API key removed or redacted
- `docker-compose.yml`
- `api/Dockerfile`
- `api/package.json`
- `api/server.js`
- `worker/Dockerfile`
- `worker/package.json`
- `worker/worker.js`
