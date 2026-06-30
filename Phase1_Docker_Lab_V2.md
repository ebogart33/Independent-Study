# Phase 1: Introduction to Containerization with Docker
## Learning Objectives
- Explain the difference between virtual machines and containers.
- Build Docker images using a Dockerfile.
- Run containers from custom images.
- Use Docker Compose to deploy multiple containers.
- Configure communication between containers.
- Use volumes to persist data.

### Instructor Answer Guide for Learning Objectives

By the end of the lab, students should be able to explain and demonstrate the following:

1. **Explain the difference between virtual machines and containers.**
   - A virtual machine includes a full guest operating system, virtualized hardware, and its own kernel.
   - A container packages an application and its dependencies but shares the host operating system kernel.
   - Containers are usually smaller, faster to start, and easier to move between environments than virtual machines.
2. **Build Docker images using a Dockerfile.**
   - Students should understand that a Dockerfile is a text file containing step-by-step image build instructions.
   - The `docker build -t frontend-image .` command reads the Dockerfile in the current directory and creates an image named `frontend-image`.
3. **Run containers from custom images.**
   - Students should know that an image is the reusable template and a container is the running instance of that image.
   - The `docker run -p 3000:3000 frontend-image` command starts a container from the custom image and maps port 3000 on the host to port 3000 in the container.
4. **Use Docker Compose to deploy multiple containers.**
   - Students should know that Docker Compose reads `docker-compose.yml` and starts multiple related services with one command.
   - In this lab, Compose starts both the `frontend` and `mongodb` services.
5. **Configure communication between containers.**
   - Students should understand that Docker Compose creates a default network for the project.
   - Containers on that network can reach each other by service name, so the frontend can refer to MongoDB as `mongodb`.
6. **Use volumes to persist data.**
   - Students should understand that container files are normally temporary.
   - A Docker volume stores data outside the container lifecycle, so MongoDB data survives container removal and recreation.

---

# Part 0 - Background Questions

1. What problem do containers solve?
2. What is the difference between a Virtual Machine and a Container?
3. What is a Docker Image?
4. What is a Docker Container?
5. Why are Docker images built in layers?
6. Why are containers considered ephemeral?
7. What is Docker Compose used for?

## Part 0 Answer Key

1. **What problem do containers solve?**
   - Containers solve the "it works on my machine" problem by packaging an application with the files, libraries, runtime, and configuration it needs. This makes the application easier to run consistently on different computers, servers, and cloud environments.
2. **What is the difference between a Virtual Machine and a Container?**
   - A virtual machine runs a full operating system on top of virtualized hardware. It has its own guest OS and kernel.
   - A container runs an isolated application process that shares the host machine's kernel.
   - Virtual machines provide stronger OS-level separation but are larger and slower to start. Containers are lighter, start quickly, and are commonly used for packaging and deploying applications.
3. **What is a Docker Image?**
   - A Docker image is a read-only template used to create containers. It contains application code, dependencies, runtime, system libraries, environment configuration, and startup instructions.
4. **What is a Docker Container?**
   - A Docker container is a running instance of an image. It is the live, executable environment where the application process runs.
5. **Why are Docker images built in layers?**
   - Layers make builds faster and storage more efficient. Docker can reuse unchanged layers from previous builds instead of rebuilding everything. Layers also make images easier to share because only missing layers need to be downloaded.
6. **Why are containers considered ephemeral?**
   - Containers are considered ephemeral because they can be stopped, deleted, and recreated at any time. Data written only inside the container can disappear when the container is removed unless it is stored in a volume or external service.
7. **What is Docker Compose used for?**
   - Docker Compose is used to define and run multi-container applications. A `docker-compose.yml` file describes services, ports, networks, volumes, and dependencies so the entire application can be started with `docker compose up`.

---

# Part 1 - Install Docker

## Requirements

Install one of the following:

- Docker Desktop
- Rancher Desktop

Docker Desktop and Rancher Desktop both provide a Docker-compatible environment. Either option is acceptable as long as the `docker` and `docker compose` commands work in the terminal.

Verify installation:

```bash
docker --version
docker compose version
```

Expected output will vary by version, but it should look similar to this:

```text
Docker version 26.1.4, build 5650f9b
Docker Compose version v2.27.1
```

If both commands print version numbers, Docker is installed correctly.

Take a screenshot of both commands.

### Troubleshooting

- If `docker --version` says `command not found`, Docker is not installed or the terminal cannot find it.
- If `docker compose version` fails, make sure you installed a current version of Docker Desktop or Rancher Desktop.
- If Docker Desktop is installed but commands fail, open Docker Desktop and wait until it says Docker is running.

---

# Part 2 - Create a Simple Frontend Application

Create the following folder structure:

```text
docker-lab/
|
+-- frontend/
|   +-- app.js
|   +-- package.json
|   +-- Dockerfile
|
+-- docker-compose.yml
```

You may create this folder anywhere convenient, such as your Desktop, Documents folder, or course project folder. The examples below assume your terminal is inside the `docker-lab` directory unless a step says otherwise.

Example setup commands:

```bash
mkdir docker-lab
cd docker-lab
mkdir frontend
```

After these commands, your terminal should be inside the `docker-lab` directory.

## frontend/app.js

Create a file named `app.js` inside the `frontend` folder:

```javascript
const express = require('express');

const app = express();

app.get('/', (req, res) => {
    res.send('Hello from Docker!');
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
```

This application uses Express to create a small web server. When someone visits the root URL `/`, the application responds with `Hello from Docker!`.

## frontend/package.json

Create a file named `package.json` inside the `frontend` folder:

```json
{
  "name": "docker-lab",
  "version": "1.0.0",
  "main": "app.js",
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

The `package.json` file tells Node.js which package dependencies the application needs. In this lab, the only dependency is `express`.

---

# Part 3 - Create a Dockerfile

## frontend/Dockerfile

Create a file named `Dockerfile` inside the `frontend` folder:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
```

### Dockerfile Explanation

- `FROM node:20-alpine`
  - Starts the image from the official Node.js 20 Alpine image.
  - Alpine is a small Linux distribution, so the image is smaller than a full operating system image.
- `WORKDIR /app`
  - Sets `/app` as the working directory inside the image and container.
  - Later commands run from this location.
- `COPY package.json .`
  - Copies `package.json` from the local `frontend` folder into `/app` inside the image.
- `RUN npm install`
  - Installs the dependencies listed in `package.json`.
  - This happens while the image is being built.
- `COPY . .`
  - Copies the rest of the files from the local `frontend` folder into `/app` inside the image.
- `EXPOSE 3000`
  - Documents that the application listens on port 3000.
  - This does not publish the port by itself; the port is published later with `docker run -p` or Docker Compose `ports`.
- `CMD ["node", "app.js"]`
  - Defines the default command that runs when a container starts from this image.

### Questions

1. What does FROM do?
2. Why is node:20-alpine used?
3. What does COPY do?
4. What does RUN do?
5. What does CMD do?

## Part 3 Answer Key

1. **What does FROM do?**
   - `FROM` chooses the base image used to build the new image. In this lab, the image starts from `node:20-alpine`, which already contains Node.js.
2. **Why is node:20-alpine used?**
   - `node:20-alpine` provides Node.js version 20 on a small Alpine Linux base. It is useful because it includes the runtime needed for the app while keeping the image relatively small.
3. **What does COPY do?**
   - `COPY` copies files from the local project directory on the host machine into the Docker image.
4. **What does RUN do?**
   - `RUN` executes a command during image build time. Here, `RUN npm install` installs Node.js dependencies into the image.
5. **What does CMD do?**
   - `CMD` specifies the default command to run when a container starts. Here, it starts the Express app with `node app.js`.

---

# Part 4 - Build the Frontend Image

Make sure your terminal is inside the `frontend` folder before building the image:

```bash
cd frontend
docker build -t frontend-image .
docker images
```

Important details:

- `cd frontend` moves into the folder that contains the Dockerfile.
- `docker build` creates an image.
- `-t frontend-image` gives the image the name `frontend-image`.
- `.` means "use the current directory as the build context."

Expected `docker build` output will be longer than this, but it should end with lines similar to:

```text
=> exporting to image
=> => naming to docker.io/library/frontend-image
```

Expected `docker images` output should include `frontend-image`:

```text
REPOSITORY       TAG       IMAGE ID       CREATED          SIZE
frontend-image   latest    abc123def456   10 seconds ago   180MB
```

The image ID, created time, and size may be different.

Take a screenshot showing your image.

### Troubleshooting

- If Docker says it cannot find the Dockerfile, confirm you are in the `frontend` folder.
- If `npm install` fails, check that `package.json` is named correctly and contains valid JSON.
- If the build command fails because Docker is not running, start Docker Desktop or Rancher Desktop and try again.

---

# Part 5 - Run the Frontend Container

Run the frontend image:

```bash
docker run -p 3000:3000 frontend-image
```

Explanation:

- `docker run` starts a new container from an image.
- `-p 3000:3000` maps port 3000 on your computer to port 3000 inside the container.
- `frontend-image` is the image created in Part 4.

If the container started correctly, the terminal should show:

```text
Server running on port 3000
```

Keep this terminal open while testing the web page. Open:

```text
http://localhost:3000
```

Expected output in the browser:

```text
Hello from Docker!
```

Take a screenshot.

To stop the running container, return to the terminal where it is running and press:

```text
Ctrl+C
```

### Troubleshooting

- If the browser cannot connect, make sure the container is still running.
- If port 3000 is already in use, stop the other program or use a different host port, such as `docker run -p 3001:3000 frontend-image`, then visit `http://localhost:3001`.
- If the terminal immediately returns to the prompt, the app may have crashed. Check the error message printed in the terminal.

---

# Part 6 - Create Database Service

Pull MongoDB:

```bash
docker pull mongo
docker images
```

## Important Directory Clarification

The `docker pull mongo` command does **not** need to be run inside a specific project folder. It can be run from any directory because it downloads the MongoDB image into Docker's local image storage, not into your current file directory.

For this lab, it is still recommended to run the command while your terminal is in the main `docker-lab` folder so your screenshots and commands are easy to follow:

```bash
cd ..
docker pull mongo
docker images
```

Use `cd ..` only if you are still inside the `frontend` folder from Part 4. After running `cd ..`, your terminal should be in the main `docker-lab` folder.

Expected `docker pull mongo` output should look similar to this:

```text
Using default tag: latest
latest: Pulling from library/mongo
Digest: sha256:...
Status: Downloaded newer image for mongo:latest
docker.io/library/mongo:latest
```

If the image was already downloaded before, you may see:

```text
Using default tag: latest
latest: Pulling from library/mongo
Status: Image is up to date for mongo:latest
docker.io/library/mongo:latest
```

Expected `docker images` output should include `mongo`:

```text
REPOSITORY       TAG       IMAGE ID       CREATED       SIZE
mongo            latest    123abc456def   2 weeks ago   800MB
frontend-image   latest    abc123def456   5 minutes ago 180MB
```

The image ID, created time, and size may be different.

### Why MongoDB Is Used Here

MongoDB is a database. The lab uses it to demonstrate how Docker Compose can run more than one container and how Docker volumes can preserve database data after containers are stopped or recreated.

---

# Part 7 - Create Docker Compose File

## docker-compose.yml

Create `docker-compose.yml` in the main `docker-lab` folder, not inside the `frontend` folder:

```yaml
services:

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - mongodb

  mongodb:
    image: mongo
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
```

Your folder structure should now be:

```text
docker-lab/
|
+-- frontend/
|   +-- app.js
|   +-- package.json
|   +-- Dockerfile
|
+-- docker-compose.yml
```

### Docker Compose File Explanation

- `services`
  - Lists the containers that make up the application.
- `frontend`
  - Defines the frontend web application service.
- `build: ./frontend`
  - Tells Docker Compose to build the frontend image from the `frontend` folder.
- `ports: "3000:3000"`
  - Publishes the frontend container's port 3000 to port 3000 on the host machine.
- `depends_on: mongodb`
  - Starts the MongoDB service before the frontend service.
  - This controls startup order, but it does not guarantee the database is fully ready to accept connections.
- `mongodb`
  - Defines the MongoDB database service.
- `image: mongo`
  - Uses the official MongoDB image from Docker Hub.
- `ports: "27017:27017"`
  - Publishes MongoDB's default port to the host machine.
- `volumes: mongo-data:/data/db`
  - Stores MongoDB database files in a Docker-managed volume named `mongo-data`.
- Top-level `volumes`
  - Declares the named volume so Docker Compose can create and manage it.

---

# Part 8 - Run Multiple Containers

Make sure your terminal is in the main `docker-lab` folder where `docker-compose.yml` is located.

Start both containers:

```bash
docker compose up
```

Expected output should include log messages from both services. It may look similar to:

```text
[+] Running 4/4
 ✔ Network docker-lab_default       Created
 ✔ Volume "docker-lab_mongo-data"   Created
 ✔ Container docker-lab-mongodb-1   Created
 ✔ Container docker-lab-frontend-1  Created
Attaching to frontend-1, mongodb-1
mongodb-1   | {"t":{"$date":"..."}, "msg":"Waiting for connections"}
frontend-1  | Server running on port 3000
```

The exact container names may vary depending on your folder name and Docker Compose version.

Open a second terminal window in the same `docker-lab` folder and run:

```bash
docker ps
```

Expected output should show both containers:

```text
CONTAINER ID   IMAGE                 COMMAND                  STATUS         PORTS                      NAMES
abc123def456   docker-lab-frontend   "docker-entrypoint.s..." Up 30 seconds  0.0.0.0:3000->3000/tcp     docker-lab-frontend-1
def456abc123   mongo                 "docker-entrypoint.s..." Up 30 seconds  0.0.0.0:27017->27017/tcp   docker-lab-mongodb-1
```

Verify both frontend and mongodb are running.

Take a screenshot.

### Running in the Background

If you want the containers to run in the background instead of keeping the terminal attached to logs, use:

```bash
docker compose up -d
```

Then check status with:

```bash
docker compose ps
```

### Troubleshooting

- If Docker Compose says it cannot find a compose file, confirm your terminal is in the main `docker-lab` folder.
- If the frontend port is already used, change the frontend port mapping to `"3001:3000"` and visit `http://localhost:3001`.
- If MongoDB takes a moment to start, wait for logs that say it is waiting for connections.

---

# Part 9 - Verify Networking

Run these commands from the main `docker-lab` folder:

```bash
docker compose ps
docker network ls
```

Expected `docker compose ps` output should show the `frontend` and `mongodb` services:

```text
NAME                    IMAGE                 SERVICE    STATUS          PORTS
docker-lab-frontend-1   docker-lab-frontend   frontend   Up 2 minutes    0.0.0.0:3000->3000/tcp
docker-lab-mongodb-1    mongo                 mongodb    Up 2 minutes    0.0.0.0:27017->27017/tcp
```

Expected `docker network ls` output should include a default network for the Compose project:

```text
NETWORK ID     NAME                 DRIVER    SCOPE
abc123def456   bridge               bridge    local
def456abc123   docker-lab_default   bridge    local
```

The network name usually follows this pattern:

```text
<project-folder-name>_default
```

For a folder named `docker-lab`, the network is usually named:

```text
docker-lab_default
```

### Questions

1. How does the frontend find the MongoDB container?
2. What network was automatically created?
3. Why is Docker Compose useful?

## Part 9 Answer Key

1. **How does the frontend find the MongoDB container?**
   - Docker Compose places both services on the same default network. Services can communicate using their service names as DNS names. In this lab, the frontend would connect to MongoDB using the hostname `mongodb`.
2. **What network was automatically created?**
   - Docker Compose automatically created a default bridge network for the project. It is usually named `<project-folder-name>_default`, such as `docker-lab_default`.
3. **Why is Docker Compose useful?**
   - Docker Compose is useful because it defines multiple containers, networks, ports, volumes, and build settings in one YAML file. Instead of starting each container manually with separate `docker run` commands, the full application can be started with `docker compose up`.

---

# Part 10 - Demonstrate Persistent Storage

Open MongoDB:

```bash
docker exec -it <container-name> mongosh
```

Note: students may say they are "execing into the Mongo image," but the precise Docker wording is that they are executing `mongosh` inside the running MongoDB **container** that was created from the `mongo` image. Images are templates; containers are the running instances.

## How to Find the MongoDB Container Name

First run:

```bash
docker compose ps
```

Look for the row where the `SERVICE` is `mongodb`. The container name is usually similar to:

```text
docker-lab-mongodb-1
```

Then run:

```bash
docker exec -it docker-lab-mongodb-1 mongosh
```

If your container has a different name, replace `docker-lab-mongodb-1` with your actual MongoDB container name.

## What Students Should See After Executing Into MongoDB

If the command is correct, the terminal should open the MongoDB shell. Students should see output similar to this:

```text
Current Mongosh Log ID: 665f1a2b3c4d5e6f78901234
Connecting to:          mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+2.2.6
Using MongoDB:          7.0.11
Using Mongosh:          2.2.6

For mongosh info see: https://docs.mongodb.com/mongodb-shell/

test>
```

The exact version numbers and log ID may be different. The important sign of success is that the prompt changes to:

```text
test>
```

That prompt means the student is inside `mongosh` and connected to MongoDB.

Create a database:

```javascript
use school
```

Expected output:

```text
switched to db school
school>
```

Insert data:

```javascript
db.students.insertOne({
    name: "Alice"
})
```

Expected output:

```text
{
  acknowledged: true,
  insertedId: ObjectId('665f1b2c3d4e5f6789012345')
}
```

The `ObjectId` value will be different for each student.

Verify:

```javascript
db.students.find()
```

Expected output:

```text
[
  {
    _id: ObjectId('665f1b2c3d4e5f6789012345'),
    name: 'Alice'
  }
]
```

If the result shows a document with `name: 'Alice'`, the insert worked.

Exit MongoDB shell:

```javascript
exit
```

Stop and restart:

```bash
docker compose down
docker compose up -d
```

The `-d` flag starts the containers in the background, which makes it easier to continue using the same terminal for verification commands.

If your instructor wants you to watch the container logs in the foreground, you can use the original foreground command instead:

```bash
docker compose up
```

When using the foreground command, open a second terminal window before running the verification commands below.

Verify data still exists.

To verify, open MongoDB again:

```bash
docker exec -it docker-lab-mongodb-1 mongosh
```

Then run:

```javascript
use school
db.students.find()
```

Expected output should still include Alice:

```text
[
  {
    _id: ObjectId('665f1b2c3d4e5f6789012345'),
    name: 'Alice'
  }
]
```

If Alice still appears after `docker compose down` and `docker compose up`, the persistent storage demonstration was successful.

### Questions

1. Why did the data survive?
2. What role does the volume play?
3. What would happen if the volume were removed?

## Part 10 Answer Key

1. **Why did the data survive?**
   - The data survived because MongoDB stored its database files in the named Docker volume `mongo-data`, not only inside the container's temporary filesystem.
2. **What role does the volume play?**
   - The volume provides persistent storage outside the lifecycle of an individual container. When the MongoDB container is stopped and recreated, Docker reattaches the same volume at `/data/db`, allowing MongoDB to reuse the existing database files.
3. **What would happen if the volume were removed?**
   - If the volume were removed, the MongoDB database files stored in that volume would be deleted. The next time MongoDB starts, it would create a fresh empty database.

### Optional Instructor Demonstration: Removing the Volume

Only run this if you intentionally want to demonstrate data loss:

```bash
docker compose down -v
docker compose up -d
docker exec -it docker-lab-mongodb-1 mongosh
```

Then run these commands inside `mongosh`:

```javascript
use school
db.students.find()
```

Expected result:

```text
[]
```

The empty result appears because `docker compose down -v` removes the named volume.

---

# Deliverables

## Screenshots

- Docker installation verification
- Built image
- Running frontend
- Docker Compose running both containers
- MongoDB persistence demonstration

## Files

- Dockerfile
- app.js
- package.json
- docker-compose.yml

## Questions

Answer all reflection questions.

## Instructor Checklist for Deliverables

Students should submit:

1. **Docker installation screenshot**
   - Shows successful output from `docker --version`.
   - Shows successful output from `docker compose version`.
2. **Built image screenshot**
   - Shows `frontend-image` in `docker images`.
3. **Running frontend screenshot**
   - Shows browser output: `Hello from Docker!`.
4. **Docker Compose screenshot**
   - Shows both `frontend` and `mongodb` running in `docker compose ps` or `docker ps`.
5. **MongoDB persistence screenshot**
   - Shows `db.students.find()` returning Alice after `docker compose down` and `docker compose up`.
6. **Files**
   - Includes `frontend/Dockerfile`, `frontend/app.js`, `frontend/package.json`, and `docker-compose.yml`.
7. **Questions**
   - Includes answers to Part 0, Part 3, Part 9, and Part 10 questions.