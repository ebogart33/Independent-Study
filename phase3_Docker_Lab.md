# Phase 3: Deploying the Multi-Container App to Kubernetes on Azure (AKS) with Autoscaling

In **Phase 2** we ran three containers (`api`, `worker`, and `mongodb`) on a single laptop using Docker Compose. In **Phase 3** we take those exact same container images and run them on a real, cloud-hosted **Kubernetes cluster** (Azure Kubernetes Service, or AKS).

The application behaves the same way as Phase 2, but now it runs in the cloud:

1. A browser sends a prompt to the `api` pods through a public Azure IP address.
2. The `api` pod saves the prompt as a job in MongoDB.
3. The `worker` pods read queued jobs from MongoDB.
4. The `worker` calls an OpenAI-compatible ChatGPT API (or uses demo mode).
5. The `worker` stores the API response back in MongoDB.
6. The browser refreshes the job list from the `api` pod and shows the saved response.
7. When the `api` or `worker` pods get busy, Kubernetes automatically creates **new pods** and deletes them again when things calm down.

The result is the same multi-container workflow, but now cloud-hosted, publicly reachable, and self-scaling:

```text
Internet -> [Azure LoadBalancer] -> api pods -> mongodb pod -> worker pods -> ChatGPT/OpenAI API
                                        ^                            |
                                        |____________________________|

[HorizontalPodAutoscaler] watches CPU usage and adds/removes api and worker pods automatically
```

## What Students Will Build

Instead of one Docker Compose file, students will deploy a single **Kubernetes manifest** that creates eight objects:

| Object              | Kind                      | Purpose                                                                      |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `mongo-pvc`         | `PersistentVolumeClaim`   | Requests a durable cloud disk for the database (replaces the Docker volume). |
| `mongodb`           | `StatefulSet`             | Runs the MongoDB database pod with its own persistent storage.               |
| `mongodb-service`   | `Service`                 | Gives MongoDB a stable internal network name for other pods to use.          |
| `api-deployment`    | `Deployment`              | Runs and scales the Express web app pods.                                    |
| `api-service`       | `Service` (LoadBalancer)  | Exposes the API to the internet on a public Azure IP.                        |
| `worker-deployment` | `Deployment`              | Runs and scales the background worker pods.                                  |
| `worker-hpa`        | `HorizontalPodAutoscaler` | Automatically adds/removes worker pods based on CPU.                         |
| `api-hpa`           | `HorizontalPodAutoscaler` | Automatically adds/removes API pods based on CPU.                            |

## Important Note

This phase costs real Azure credits while the cluster is running. Two things to keep in mind:

1. **Autoscaling requires the metrics-server.** The Horizontal Pod Autoscaler can only work if the cluster is measuring CPU and memory. AKS ships with the metrics-server enabled by default, so normally there is nothing to install.
2. **Stop the cluster when you are not using it.** Use `az aks stop` at the end of each day (see Part 13) so the VM nodes stop consuming credits, and fully delete the resource group once you are graded (see Part 14).

> The placeholder names used below (resource group `IndI`, registry `ethanbprojectregistry`, cluster `ethanb-aks-cluster`) match the names baked into the manifest. Replace them with your own if yours differ.

---

# Part 1 - Prerequisites and Project Structure

Before starting, students should have:

- The completed **Phase 2** project (the `api`, `worker`, and `mongodb` containers).
- **Docker** installed and running (Docker Desktop or Rancher Desktop).
- An **Azure account** with available credits.
- The **Azure CLI** (`az`) installed.
- **kubectl** installed (the Azure CLI can install it for you with `az aks install-cli`).

## Exact File Structure

Phase 3 adds one new folder with a single file:

```text
phase3-docker-lab/
|
+-- kubernetes-manifest.yaml
```

Everything the cluster needs is described inside `kubernetes-manifest.yaml`. The container images themselves come from Phase 2 and are pushed to the Azure Container Registry in Part 2.

---

# Part 2 - Build and Push Your Images to Azure Container Registry

In Phase 2, Docker Compose built your images locally. Kubernetes cannot build images — it can only **pull** finished images from a registry. So we first push the Phase 2 images to a private Azure Container Registry (ACR).

## 1. Build the images

From your Phase 2 folder:

```bash
docker compose build
```

## 2. Log in to Azure and pick a subscription

```bash
az login
```

Azure lists your subscriptions after login:

```text
No  Subscription name        Subscription ID                       Tenant
[1] AVD                      2c5b6447-6007-420a-9234-ac032c77a1bc  Texas State University
[2] Azure subscription 1     f592f92f-94ad-41f6-bd24-cc67e7ed8129  Texas State University
```

Choose subscription **2** (`Azure subscription 1`).

## 3. Tag and push the images

```bash
docker image ls   # find the local image names first

# Pattern: docker tag <local-image> <loginserver>/<name>:<tag>
docker tag phase2-docker-lab-api    ethanbprojectregistry.azurecr.io/api:latest
docker tag phase2-docker-lab-worker ethanbprojectregistry.azurecr.io/worker:latest

docker push ethanbprojectregistry.azurecr.io/api:latest
docker push ethanbprojectregistry.azurecr.io/worker:latest
```

These are the exact image names referenced later in the manifest (`ethanbprojectregistry.azurecr.io/api:latest` and `.../worker:latest`).

> Note: you must create the registry (Part 3, step 2) and run `az acr login` before the `docker push` commands will succeed. If you have not created the registry yet, do Part 3 first, then come back to push.

---

# Part 3 - Create the Azure Resources

## 1. Create a resource group

A **resource group** is a folder that holds all of your Azure things so you can delete them all at once later.

```bash
az group create --name IndI --location eastus
```

## 2. Create the container registry (ACR)

The registry is the cloud "app store" that stores your private Docker images so the cluster can pull them.

```bash
az acr create --resource-group IndI \
  --name ethanbprojectregistry --sku Standard

az acr login --name ethanbprojectregistry
```

## 3. Create the Kubernetes cluster

```bash
az aks create \
  --resource-group IndI \
  --name ethanb-aks-cluster \
  --node-count 1 \
  --node-vm-size Standard_B2s_v2 \
  --tier free \
  --generate-ssh-keys \
  --attach-acr ethanbprojectregistry
```

## What These Commands Do

- Create a resource group named `IndI` in the East US region.
- Create a Standard-tier container registry named `ethanbprojectregistry`.
- Create a one-node Kubernetes cluster named `ethanb-aks-cluster`.
- `--node-count 1` gives you a single, cheap worker VM (fine for a demo).
- `--attach-acr` lets the cluster pull images from your registry with no extra login.

---

# Part 4 - Connect kubectl to Your Cluster

`kubectl` is the Kubernetes command-line tool. Point it at your new cloud cluster:

```bash
az aks get-credentials --resource-group IndI --name ethanb-aks-cluster
```

Confirm the metrics-server is running (required for autoscaling):

```bash
kubectl get deployment metrics-server -n kube-system
```

Expected output should show it available:

```text
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
metrics-server   2/2     2            2           10m
```

---

# Part 5 - Create the Kubernetes Manifest File

Create `phase3-docker-lab/kubernetes-manifest.yaml` with this exact content. Each object is separated by a `---` line. Every field is explained in Part 6.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mongo-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi # Replaces your docker volume "phase2-mongo-data"
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
spec:
  serviceName: "mongodb-service"
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
        - name: mongodb
          image: mongo:7
          ports:
            - containerPort: 27017
          volumeMounts:
            - name: mongo-storage
              mountPath: /data/db
  volumeClaimTemplates:
    - metadata:
        name: mongo-storage
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
---
apiVersion: v1
kind: Service
metadata:
  name: mongodb-service # Replaces the "mongodb" host name from docker-compose
spec:
  ports:
    - port: 27017
      targetPort: 27017
  selector:
    app: mongodb
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: ethanbprojectregistry.azurecr.io/api:latest
          ports:
            - containerPort: 3000
          env:
            - name: MONGO_URL
              value: "mongodb://mongodb-service:27017/phase2"
            - name: DB_NAME
              value: "phase2"
            - name: PORT
              value: "3000"
          resources: # Required for Horizontal Pod Autoscaler to function
            limits:
              cpu: "500m"
              memory: "512Mi"
            requests:
              cpu: "100m" # Small request so a little real traffic pushes usage past 100% fast
              memory: "128Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  type: LoadBalancer # Automatically provisions a public Azure IP address
  ports:
    - port: 3000
      targetPort: 3000
  selector:
    app: api
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
        - name: worker
          image: ethanbprojectregistry.azurecr.io/worker:latest
          env:
            - name: MONGO_URL
              value: "mongodb://mongodb-service:27017/phase2"
            - name: DB_NAME
              value: "phase2"
            - name: POLL_INTERVAL_MS
              value: "3000"
          resources: # Required for Horizontal Pod Autoscaler to function
            limits:
              cpu: "500m"
              memory: "512Mi"
            requests:
              cpu: "100m" # Small request so a little real traffic pushes usage past 100% fast
              memory: "128Mi"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: worker-hpa # Scales the background worker processing the OpenAI jobs
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: worker-deployment
  minReplicas: 1
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 10 # Very low threshold so even light activity trips the scaler quickly
  behavior: # Controls HOW FAST Kubernetes reacts once the threshold is crossed
    scaleUp:
      stabilizationWindowSeconds: 0 # React the instant load appears (no averaging delay)
      policies:
        - type: Percent
          value: 100 # Allow doubling the number of pods...
          periodSeconds: 15 # ...every 15 seconds
        - type: Pods
          value: 4 # ...OR add up to 4 brand-new pods...
          periodSeconds: 15 # ...every 15 seconds
      selectPolicy: Max # Whichever rule adds MORE pods wins (fastest scale-out)
    scaleDown:
      stabilizationWindowSeconds: 30 # Wait only 30s of calm before removing pods (default is 300s)
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa # Keeps your frontend web app responsive
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-deployment
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 30 # CPU-based (HTTP floods spike CPU) and low so the demo triggers in seconds
  behavior: # Controls HOW FAST Kubernetes reacts once the threshold is crossed
    scaleUp:
      stabilizationWindowSeconds: 0 # React the instant load appears (no averaging delay)
      policies:
        - type: Percent
          value: 100 # Allow doubling the number of pods...
          periodSeconds: 15 # ...every 15 seconds
        - type: Pods
          value: 4 # ...OR add up to 4 brand-new pods...
          periodSeconds: 15 # ...every 15 seconds
      selectPolicy: Max # Whichever rule adds MORE pods wins (fastest scale-out)
    scaleDown:
      stabilizationWindowSeconds: 30 # Wait only 30s of calm before removing pods (default is 300s)
```

---

# Part 6 - Understand the Manifest, Object by Object

A Kubernetes manifest is a list of **objects**. Every object has the same four top-level keys:

| Key          | What it means                                                             |
| ------------ | ------------------------------------------------------------------------- |
| `apiVersion` | Which version of the Kubernetes API this object uses (see below).         |
| `kind`       | _What type of thing_ this is (a Deployment, a Service, an HPA, etc.).     |
| `metadata`   | Identifying info — most importantly the object's `name`.                  |
| `spec`       | The actual desired configuration ("this is what I want it to look like"). |

## Why the Different `apiVersion` Values (`v1`, `apps/v1`, `autoscaling/v2`)?

Kubernetes groups its features into **API groups**, and each group has its own version. You must use the correct one for each `kind`:

- **`v1`** — the original "core" group, used for the oldest fundamental objects: `PersistentVolumeClaim` and `Service`.
- **`apps/v1`** — the "apps" group for things that manage running application copies: `Deployment` and `StatefulSet`.
- **`autoscaling/v2`** — the autoscaling group. We specifically need **v2** (not v1) because v2 supports advanced metrics and the `behavior` block that controls scaling speed.

## Where Do Names Like `api`, `worker`, and `mongodb` Come From?

Almost every name in this file is a name **we chose ourselves** — Kubernetes does not require them. We reuse `api`, `worker`, and `mongodb` because those are the same three service names from the Phase 2 `docker-compose.yml`, so the two phases line up. The only reserved strings are the Kubernetes keywords (`apiVersion`, `kind`, `spec`, `Deployment`, etc.) and the version identifiers (`v1`, `apps/v1`, `autoscaling/v2`).

The most important rule is the **label ↔ selector link**:

- A pod template stamps a **label** on each pod, e.g. `labels: { app: api }`.
- A Service or Deployment then uses a **selector**, e.g. `selector: { app: api }`, to find those pods.
- The word `api` is just a sticker. It only works because the label and the selector use the _same_ sticker. Rename one but not the other and they stop finding each other.

## Object 1 - PersistentVolumeClaim (`mongo-pvc`)

- `apiVersion: v1` / `kind: PersistentVolumeClaim` — a fundamental "core" object that requests durable storage.
- `metadata.name: mongo-pvc` — our chosen name for this storage request.
- `accessModes: [ReadWriteOnce]` — the disk is mounted read/write by a single node at a time.
- `resources.requests.storage: 5Gi` — asks Azure for a real 5 GiB cloud disk.

**What it does:** asks Azure for a persistent 5 GiB disk. This is the cloud replacement for the Phase 2 Docker volume `phase2-mongo-data`. Because the disk lives outside the pod, MongoDB's data survives even if the pod is deleted or moved.

## Object 2 - StatefulSet (`mongodb`)

- `apiVersion: apps/v1` / `kind: StatefulSet` — like a Deployment, but for **stateful** apps such as databases.
- `serviceName: "mongodb-service"` — links this StatefulSet to its Service so the pod gets a stable network name.
- `replicas: 1` — exactly one MongoDB pod.
- `selector.matchLabels.app: mongodb` — this StatefulSet manages pods labeled `app=mongodb`.
- `template.metadata.labels.app: mongodb` — the sticker put on each pod (must match the selector above).
- `containers.name: mongodb` / `image: mongo:7` — runs the official MongoDB 7 image.
- `containerPort: 27017` — MongoDB's standard port.
- `volumeMounts` + `volumeClaimTemplates` — auto-creates and mounts a dedicated disk at `/data/db`, where MongoDB stores its files.

**Why a StatefulSet instead of a Deployment?** Databases have identity and persistent data. A StatefulSet gives the pod a stable name and its own dedicated storage, which is exactly what a database needs. Deployments are for stateless apps that are interchangeable.

## Object 3 - Service for MongoDB (`mongodb-service`)

- `apiVersion: v1` / `kind: Service` — a stable internal address for a set of pods.
- `metadata.name: mongodb-service` — this **name becomes the DNS hostname** other pods use.
- `port` / `targetPort: 27017` — listens on 27017 and forwards to port 27017 on the pod.
- `selector.app: mongodb` — sends traffic to any pod labeled `app=mongodb`.

**Why we need it:** pods are temporary and get random IP addresses. A Service gives MongoDB a permanent name — `mongodb-service` — that never changes. This is why the `api` and `worker` connect using `mongodb://mongodb-service:27017/...`. It replaces the plain `mongodb` hostname Docker Compose gave us for free in Phase 2.

## Object 4 - Deployment for the API (`api-deployment`)

- `apiVersion: apps/v1` / `kind: Deployment` — a stateless app manager that can scale freely.
- `replicas: 1` — starts with 1 pod (the HPA will change this).
- `selector` / `template.labels` both use `app: api` — the label↔selector link.
- `image: ethanbprojectregistry.azurecr.io/api:latest` — YOUR image from ACR.
- `containerPort: 3000` — the port the Express server listens on.
- `env` — the same environment variables as Phase 2, except `MONGO_URL` now points at `mongodb-service`.
- `resources.requests` vs `resources.limits`:
  - `requests` is what the pod _reserves_. **The HPA measures usage as a percentage of the request**, so a smaller request makes the same load look "bigger" and triggers scaling sooner.
  - `limits` is the hard maximum; the container is throttled/killed if it exceeds it.
  - **The HPA cannot function without `requests`**, because "50% CPU" is meaningless unless it knows what 100% is. (`500m` = 0.5 CPU core, `100m` = 0.1 core.)

## Object 5 - Service for the API (`api-service`, the public front door)

- `type: LoadBalancer` — the key line: it tells Azure to create a real **public IP** and spread incoming traffic across _all_ `api` pods.
- `port` / `targetPort: 3000` — public port 3000 forwards to `containerPort` 3000 on the pods.
- `selector.app: api` — routes traffic to every pod labeled `app=api`.

As the HPA adds pods, this Service automatically starts sending traffic to them (no config change needed). The default Service type is `ClusterIP` (internal only), which is why `mongodb-service` above used that default — the database should never be exposed to the internet.

## Object 6 - Deployment for the Worker (`worker-deployment`)

- Same structure as the API Deployment, but with `app: worker` labels and the worker image.
- **No `ports` and no Service** — the worker never receives incoming network traffic. It just polls MongoDB for queued jobs, processes them, and writes results back.
- `POLL_INTERVAL_MS: "3000"` — the worker checks MongoDB for new jobs every 3 seconds.
- Same small `requests` (`cpu: 100m`) so its autoscaler reacts quickly.

## Object 7 - HorizontalPodAutoscaler for the Worker (`worker-hpa`)

- `apiVersion: autoscaling/v2` — v2 is required for the `behavior` block.
- `scaleTargetRef` — names the `worker-deployment` this HPA should grow and shrink.
- `minReplicas: 1` / `maxReplicas: 8` — never fewer than 1, never more than 8 pods.
- `metrics ... cpu ... averageUtilization: 10` — scale up when average CPU passes 10% of the request (intentionally very low for a fast demo).
- `behavior.scaleUp`:
  - `stabilizationWindowSeconds: 0` — react instantly, no "wait and see" delay.
  - policies allow doubling the pods **or** adding +4 pods every 15 seconds, and `selectPolicy: Max` picks the faster option.
- `behavior.scaleDown.stabilizationWindowSeconds: 30` — after traffic stops, wait only 30 seconds before removing pods (the default is 300).

## Object 8 - HorizontalPodAutoscaler for the API (`api-hpa`)

- Same shape as `worker-hpa`, but it controls `api-deployment` with `maxReplicas: 5`.
- `metrics ... cpu ... averageUtilization: 30` — this is the autoscaler you demonstrate with the traffic loop. It measures **CPU** because the load test fires a flood of HTTP GET requests, which spikes CPU (not memory). Watching CPU means the scaler reacts to the exact load you generate.

---

# Part 7 - Deploy the Application

Send the entire manifest to Kubernetes with one command:

```bash
kubectl apply -f kubernetes-manifest.yaml
```

Expected output:

```text
persistentvolumeclaim/mongo-pvc created
statefulset.apps/mongodb created
service/mongodb-service created
deployment.apps/api-deployment created
service/api-service created
deployment.apps/worker-deployment created
horizontalpodautoscaler.autoscaling/worker-hpa created
horizontalpodautoscaler.autoscaling/api-hpa created
```

---

# Part 8 - Watch Your Pods Stand Up

The pods take a minute or two to pull the images and reach the `Running` state. Watch them live:

```bash
kubectl get pods --watch
```

Expected output (statuses change over time):

```text
NAME                                 READY   STATUS              RESTARTS   AGE
mongodb-0                            1/1     Running             0          90s
api-deployment-7c9d5b8f6-abcde       0/1     ContainerCreating   0          30s
api-deployment-7c9d5b8f6-abcde       1/1     Running             0          60s
worker-deployment-6b7c8d9e5-fghij    1/1     Running             0          60s
```

Press `Ctrl + C` to stop watching.

---

# Part 9 - Get Your Public IP and Test the App

Because `api-service` is a `LoadBalancer`, Azure provisions a public IP for you. Find it with:

```bash
kubectl get service api-service
```

Expected output (the `EXTERNAL-IP` may say `<pending>` for a minute):

```text
NAME          TYPE           CLUSTER-IP     EXTERNAL-IP     PORT(S)          AGE
api-service   LoadBalancer   10.0.123.45    20.55.66.77     3000:31234/TCP   3m
```

Open a browser and go to your public IP on port 3000:

```text
http://<YOUR_EXTERNAL_IP>:3000
```

You should see the same "Phase 2 Docker AI Worker Lab" page from Phase 2 — now served from the cloud. Submit a prompt to confirm the API, worker, and MongoDB are all working together.

---

# Part 10 - Verify the Autoscalers Are Active

```bash
kubectl get hpa
```

Expected output:

```text
NAME         REFERENCE                      TARGETS       MINPODS   MAXPODS   REPLICAS
api-hpa      Deployment/api-deployment      cpu: 1%/30%   1         5         1
worker-hpa   Deployment/worker-deployment   cpu: 0%/10%   1         8         1
```

The `TARGETS` column shows current usage vs. your threshold. If it shows `<unknown>`, wait a minute for the metrics-server to collect data.

---

# Part 11 - The Scalability Demo (watch new pods get created live)

This is the part your professor wants to see: Kubernetes automatically creating new pods under load. The manifest is deliberately tuned to scale up **quickly** so you can capture the moment on screen (see Part 12).

## 1. Open two terminal windows side-by-side

Make sure the cluster is running (`az aks start ...`) and `kubectl` is connected.

## 2. Set up the live monitor (Window 1)

```bash
kubectl get hpa,pods --watch
```

Keep an eye on the `TARGETS` column and the number of pods.

## 3. Launch the load generator (Window 2)

Get the public IP with `kubectl get svc api-service`, then hammer the API with an infinite request loop.

PowerShell (Windows):

```powershell
while ($true) {
  Invoke-RestMethod -Uri "http://<YOUR_EXTERNAL_IP>:3000" -Method Get > $null
}
```

bash (macOS/Linux):

```bash
while true; do curl -s "http://<YOUR_EXTERNAL_IP>:3000" > /dev/null; done
```

The terminal will look frozen — that means it is successfully flooding the API.

## 4. Watch the autoscaler fire (Window 1)

Within roughly **30 to 90 seconds** you will see this chain reaction:

1. **Metrics spike** — the HPA `TARGETS` percentage climbs past its threshold (e.g. jumps from `1%/30%` to `150%/30%`).
2. **Scale event** — the replica count jumps up.
3. **New pods appear** — new pod rows show up going `Pending -> ContainerCreating -> Running`.

Take your screenshots here.

## 5. Stop the test and watch it scale back down

Press `Ctrl + C` in Window 2 to stop the traffic. After the short cool-down window (about 30 seconds of calm, configured in the manifest), Kubernetes deletes the extra pods and returns to 1 replica to save credits.

---

# Part 12 - Why It Scales Fast

Three deliberate changes in the manifest make new pods appear _sooner_ so the demo is easy to capture:

1. **Low thresholds** — `10%` (worker CPU) and `30%` (API CPU) trip almost immediately.
2. **Small `requests`** (`cpu: 100m`) — because the HPA measures usage as a percentage of the request, a smaller request makes real load look "bigger," crossing the threshold faster.
3. **A `behavior` block** with `stabilizationWindowSeconds: 0` and aggressive scale-up policies — Kubernetes reacts instantly and can add several pods at once instead of adding them slowly.

The `api-hpa` was also switched from a memory metric to a **CPU** metric, because the traffic-loop demo spikes CPU, not memory.

---

# Part 13 - Pause and Restart the Cluster (protect your credits)

## Pause the cluster (do this at the end of each day)

Shuts down the VM nodes so they stop burning credits, but keeps all your deployments and data:

```bash
az aks stop --resource-group IndI --name ethanb-aks-cluster
```

## Unpause the cluster (do this before you work or demo)

```bash
az aks start --resource-group IndI --name ethanb-aks-cluster
```

> It takes about 3 to 5 minutes for the VMs to boot back up and restore your running pods.

---

# Part 14 - Clean Up (do this ONLY after you get your grade)

Deletes the entire resource group — cluster, registry, disks, and public load balancer — so you never face a surprise bill:

```bash
az group delete --name IndI --yes --no-wait
```

---

# Part 15 - Troubleshooting

## Problem: Pods stuck in `ImagePullBackOff` or `ErrImagePull`

The cluster cannot pull your images. Check:

1. The images were pushed: `az acr repository list --name ethanbprojectregistry`.
2. The cluster is attached to the registry: `az aks update --resource-group IndI --name ethanb-aks-cluster --attach-acr ethanbprojectregistry`.
3. The image names in the manifest exactly match the pushed image names.

## Problem: `EXTERNAL-IP` stays `<pending>`

Azure is still provisioning the load balancer. Wait a few minutes and re-run:

```bash
kubectl get service api-service
```

## Problem: HPA `TARGETS` shows `<unknown>`

The metrics-server is not returning data yet.

```bash
kubectl get deployment metrics-server -n kube-system
kubectl top pods
```

If `kubectl top pods` errors, wait a minute for metrics to be collected, then retry.

## Problem: Pods never scale up during the demo

1. Confirm you are hitting the correct public IP with the load loop.
2. Confirm the HPA exists and has a target: `kubectl get hpa`.
3. Watch live CPU: `kubectl top pods`. If CPU is not rising, the traffic is not reaching the API.

## Problem: MongoDB pod won't start

Check its logs and its storage claim:

```bash
kubectl logs mongodb-0
kubectl get pvc
```

---

# Final Student Deliverables

Students should submit screenshots showing:

1. `kubectl get pods` with `mongodb`, `api`, and `worker` pods running.
2. `kubectl get service api-service` showing the public `EXTERNAL-IP`.
3. The browser page loaded from `http://<YOUR_EXTERNAL_IP>:3000`.
4. `kubectl get hpa` showing both autoscalers active.
5. `kubectl get hpa,pods --watch` **during the load test**, showing the `TARGETS` percentage over threshold and **new pods being created** (`Pending`/`ContainerCreating`/`Running`).
6. The replica count returning to 1 after the traffic stops.

Students should also submit this file:

- `kubernetes-manifest.yaml`
