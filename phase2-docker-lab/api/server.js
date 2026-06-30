const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || "mongodb://mongodb:27017/phase2";
const dbName = process.env.DB_NAME || "phase2";

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

app.get("/", (req, res) => {
  res.type("html").send(page);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/jobs", async (req, res) => {
  const prompt =
    typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required." });
  }

  const result = await jobs.insertOne({
    prompt,
    status: "queued",
    response: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const created = await jobs.findOne({ _id: result.insertedId });
  res.status(201).json(created);
});

app.get("/api/jobs", async (req, res) => {
  const recentJobs = await jobs
    .find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  res.json(recentJobs);
});

app.get("/api/jobs/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid job ID." });
  }

  const job = await jobs.findOne({ _id: new ObjectId(req.params.id) });

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  res.json(job);
});

async function start() {
  const client = new MongoClient(mongoUrl);
  await client.connect();

  const db = client.db(dbName);
  jobs = db.collection("jobs");
  await jobs.createIndex({ status: 1, createdAt: 1 });

  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
    console.log(`Connected to MongoDB database "${dbName}"`);
  });
}

start().catch((error) => {
  console.error("API failed to start:", error);
  process.exit(1);
});
