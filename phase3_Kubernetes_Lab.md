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

[api-hpa] watches CPU and adds/removes api pods; [KEDA] watches the MongoDB job queue and adds/removes worker pods
```

## What Students Will Build

Instead of one Docker Compose file, students will deploy a single **Kubernetes manifest** that creates ten objects:

| Object                | Kind                           | Purpose                                                                                  |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `mongo-pvc`           | `PersistentVolumeClaim`        | Requests a durable cloud disk for the database (replaces the Docker volume).             |
| `mongodb`             | `StatefulSet`                  | Runs the MongoDB database pod with its own persistent storage.                           |
| `mongodb-service`     | `Service`                      | Gives MongoDB a stable internal network name for other pods to use.                      |
| `api-deployment`      | `Deployment`                   | Runs and scales the Express web app pods.                                                |
| `api-service`         | `Service` (LoadBalancer)       | Exposes the API to the internet on a public Azure IP.                                    |
| `worker-deployment`   | `Deployment`                   | Runs and scales the background worker pods.                                              |
| `mongodb-keda-secret` | `Secret`                       | Holds the fully-qualified MongoDB connection string KEDA uses.                           |
| `mongodb-keda-auth`   | `TriggerAuthentication` (KEDA) | Feeds the Secret's connection string to the ScaledObject's trigger.                      |
| `worker-scaledobject` | `ScaledObject` (KEDA)          | Adds/removes worker pods based on the **job backlog** in MongoDB (queue depth), not CPU. |
| `api-hpa`             | `HorizontalPodAutoscaler`      | Automatically adds/removes API pods based on CPU.                                        |

## Important Note

This phase costs real Azure credits while the cluster is running. Two things to keep in mind:

1. **CPU autoscaling requires the metrics-server.** The `api-hpa` HorizontalPodAutoscaler can only work if the cluster is measuring CPU. AKS ships with the metrics-server enabled by default, so normally there is nothing to install.
2. **Queue autoscaling requires KEDA.** The worker is scaled on the MongoDB job backlog using KEDA, which must be enabled on the cluster (see Part 4b). Without KEDA the `worker-scaledobject` is simply ignored.
3. **Stop the cluster when you are not using it.** Use `az aks stop` at the end of each day (see Part 13) so the VM nodes stop consuming credits, and fully delete the resource group once you are graded (see Part 14).

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

# Part 4b - Enable KEDA (for queue-based worker scaling)

The worker is scaled on the MongoDB job backlog using **KEDA** (Kubernetes Event-Driven Autoscaling). KEDA is an add-on that is not part of Kubernetes by default, so it must be enabled once per cluster. On AKS the easiest way is the managed add-on:

```bash
az aks update --resource-group IndI --name ethanb-aks-cluster --enable-keda
```

Confirm the KEDA operator pods are running:

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=keda-operator
```

Expected output:

```text
NAME                             READY   STATUS    RESTARTS   AGE
keda-operator-6b8c9d7f5-abcde    1/1     Running   0          2m
```

> Why KEDA instead of a normal HPA? A standard HPA can only scale on CPU/memory. The worker spends most of its time _waiting_ on the OpenAI API (low CPU), so CPU is a poor signal. KEDA can scale on external signals — here, the number of `queued` jobs in MongoDB — which is what actually reflects how much work is pending. This is explained in detail in Part 6, Object 7.

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
              cpu: "50m" # Tiny request: HPA reports usage as a % of THIS, so small CPU load reads as a high % and trips scaling fast
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
# KEDA's operator runs in kube-system, so it can't resolve the short name "mongodb-service".
# This Secret gives it the fully-qualified address so it can connect to MongoDB.
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-keda-secret
type: Opaque
stringData:
  connectionString: "mongodb://mongodb-service.default.svc.cluster.local:27017/phase2"
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: mongodb-keda-auth
spec:
  secretTargetRef:
    - parameter: connectionString
      name: mongodb-keda-secret
      key: connectionString
---
# The worker is a QUEUE CONSUMER. It spends most of its time WAITING on the OpenAI call
# (low CPU), so we scale it on the actual backlog of "queued" jobs in MongoDB via KEDA.
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaledobject
spec:
  scaleTargetRef:
    name: worker-deployment # The Deployment KEDA grows/shrinks (defaults to kind: Deployment)
  minReplicaCount: 1 # Keep at least 1 worker
  maxReplicaCount: 8 # Never more than 8 workers
  pollingInterval: 5 # Query MongoDB for the backlog every 5s (default 30)
  cooldownPeriod: 30 # Wait 30s of empty queue before scaling back down (default 300)
  advanced:
    horizontalPodAutoscalerConfig:
      behavior: # KEDA creates an HPA under the hood; tune reaction speed here
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
            - type: Percent
              value: 100
              periodSeconds: 15
            - type: Pods
              value: 4
              periodSeconds: 15
          selectPolicy: Max
        scaleDown:
          stabilizationWindowSeconds: 30
  triggers:
    - type: mongodb
      metadata:
        dbName: phase2 # Matches DB_NAME / the /phase2 in MONGO_URL
        collection: jobs # The collection the API writes jobs into
        query: '{ "status": "queued" }' # Count only jobs still waiting to be processed
        queryValue: "5" # Target ~5 queued jobs per worker: desiredWorkers = ceil(queued / 5)
      authenticationRef:
        name: mongodb-keda-auth # Fully-qualified MongoDB connection string (see Secret above)
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
          averageUtilization: 20 # CPU-based (HTTP floods spike CPU) and low so a modest traffic loop trips scaling in seconds
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
- **`keda.sh/v1alpha1`** — the KEDA API group. KEDA is an _add-on_ (not built into Kubernetes), so its `ScaledObject` kind lives in its own group that only exists after KEDA is installed on the cluster (see Part 4b).

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
  - **The HPA cannot function without `requests`**, because "50% CPU" is meaningless unless it knows what 100% is. (`500m` = 0.5 CPU core, `50m` = 0.05 core.) The API request is deliberately tiny (`50m`) so a modest traffic loop already reads as a high percentage and scales up quickly.

## Object 5 - Service for the API (`api-service`, the public front door)

- `type: LoadBalancer` — the key line: it tells Azure to create a real **public IP** and spread incoming traffic across _all_ `api` pods.
- `port` / `targetPort: 3000` — public port 3000 forwards to `containerPort` 3000 on the pods.
- `selector.app: api` — routes traffic to every pod labeled `app=api`.

As the HPA adds pods, this Service automatically starts sending traffic to them (no config change needed). The default Service type is `ClusterIP` (internal only), which is why `mongodb-service` above used that default — the database should never be exposed to the internet.

## Object 6 - Deployment for the Worker (`worker-deployment`)

- Same structure as the API Deployment, but with `app: worker` labels and the worker image.
- **No `ports` and no Service** — the worker never receives incoming network traffic. It just polls MongoDB for queued jobs, processes them, and writes results back.
- `POLL_INTERVAL_MS: "3000"` — the worker checks MongoDB for new jobs every 3 seconds.

## Object 7 - ScaledObject (KEDA) for the Worker (`worker-scaledobject`)

This replaces a CPU-based HPA for the worker. **Why?** The worker is a _queue consumer_: in real API mode it spends almost all of its time **waiting** on the OpenAI HTTP call, which barely uses CPU. A CPU-based HPA would see ~3-5% CPU even when the worker is fully saturated and the backlog is exploding, so it would never scale. Instead we scale on the **actual backlog** — the number of jobs still marked `queued` in MongoDB.

- `apiVersion: keda.sh/v1alpha1` / `kind: ScaledObject` — a KEDA object (requires KEDA on the cluster, Part 4b).
- `scaleTargetRef.name: worker-deployment` — the Deployment KEDA grows and shrinks.
- `minReplicaCount: 1` / `maxReplicaCount: 8` — never fewer than 1, never more than 8 workers.
- `pollingInterval: 5` — KEDA runs the MongoDB query every 5 seconds to read the backlog.
- `cooldownPeriod: 30` — after the queue empties, wait 30 seconds before scaling back to `minReplicaCount`.
- `advanced.horizontalPodAutoscalerConfig.behavior` — KEDA still creates an HPA under the hood, so we reuse the same fast scale-up tuning (instant reaction, double or +4 pods per 15s).
- `triggers[0]` (`type: mongodb`):
  - `dbName: phase2` / `collection: jobs` — where the jobs live.
  - `query: '{ "status": "queued" }'` — count only jobs still waiting (not `processing`/`completed`).
  - `queryValue: "5"` — the target backlog _per worker_. KEDA aims for `desiredWorkers = ceil(queuedCount / 5)`, so 40 queued jobs would request 8 workers (the max).
  - `authenticationRef.name: mongodb-keda-auth` — how KEDA gets the MongoDB connection string. **This is important:** the KEDA operator runs in the `kube-system` namespace, so it cannot resolve the short service name `mongodb-service` (short names only resolve within their own namespace). The `mongodb-keda-secret` therefore holds the **fully-qualified** address `mongodb-service.default.svc.cluster.local`, and the `mongodb-keda-auth` `TriggerAuthentication` passes it to the trigger as the `connectionString` parameter. If you deploy into a namespace other than `default`, update the `.default.` part of that connection string.

## Object 8 - HorizontalPodAutoscaler for the API (`api-hpa`)

- `apiVersion: autoscaling/v2` — v2 is required for the `behavior` block.
- `scaleTargetRef` — names the `api-deployment`; `minReplicas: 1` / `maxReplicas: 5`.
- `metrics ... cpu ... averageUtilization: 20` — this is the autoscaler you demonstrate with the traffic loop. It measures **CPU** because the load test fires a flood of HTTP requests, which spikes CPU (not memory). The threshold is low (20%) so a modest amount of concurrent traffic trips it.
- `behavior` — the same instant, aggressive scale-up tuning as the worker's ScaledObject.

The API keeps a plain CPU HPA (not KEDA) because, unlike the worker, it _is_ CPU-bound under a request flood — CPU is a perfectly good signal for it.

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
secret/mongodb-keda-secret created
triggerauthentication.keda.sh/mongodb-keda-auth created
scaledobject.keda.sh/worker-scaledobject created
horizontalpodautoscaler.autoscaling/api-hpa created
```

> If you see `no matches for kind "ScaledObject"`, KEDA is not enabled yet — do Part 4b first, then re-run `kubectl apply`.

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

You now have two autoscalers of different kinds. Check both.

**The API CPU autoscaler:**

```bash
kubectl get hpa
```

Expected output (note KEDA also creates its own managed HPA for the worker):

```text
NAME                            REFERENCE                      TARGETS       MINPODS   MAXPODS   REPLICAS
api-hpa                         Deployment/api-deployment      cpu: 5%/20%   1         5         1
keda-hpa-worker-scaledobject    Deployment/worker-deployment   0/5 (avg)     1         8         1
```

**The KEDA worker queue autoscaler:**

```bash
kubectl get scaledobject
```

Expected output:

```text
NAME                  SCALETARGETKIND      SCALETARGETNAME     MIN   MAX   TRIGGERS   READY   ACTIVE
worker-scaledobject   apps/v1.Deployment   worker-deployment   1     8     mongodb    True    False
```

`READY: True` means KEDA successfully connected to MongoDB and is watching the queue. `ACTIVE` becomes `True` once there is a backlog to process. If `READY` is `False`, see the Troubleshooting section.

The HPA `TARGETS` column shows current usage vs. your threshold. If it shows `<unknown>`, wait a minute for the metrics-server to collect data.

---

# Part 11 - The API Scaling Demo (CPU-based, watch new pods get created live)

This demonstrates the **`api-hpa`** creating new **API** pods under HTTP load. It is the simplest, most visual demo. (Part 11b demonstrates the **worker** scaling on the job queue, which is the design that best matches this app.) The manifest is deliberately tuned to scale up **quickly** so you can capture the moment on screen (see Part 12).

## 1. Open two terminal windows side-by-side

Make sure the cluster is running (`az aks start ...`) and `kubectl` is connected.

## 2. Set up the live monitor (Window 1)

```bash
kubectl get hpa,pods --watch
```

Keep an eye on the `TARGETS` column and the number of pods.

## 3. Launch the load generator (Window 2)

Get the public IP with `kubectl get svc api-service`.

> **Important:** a _single_ `while ($true) { Invoke-RestMethod ... }` loop is **not enough load**. It sends one request at a time and waits for the full round-trip to Azure before sending the next (~20-40 requests/second), which only pushes CPU to ~15%. To trip the autoscaler you must send **many requests at the same time (concurrently)**.

**Best option — parallel `curl.exe` processes (Windows 10/11 include `curl.exe`):**

This launches 50 hidden processes, each firing a long burst of requests, giving ~50 concurrent connections continuously:

```powershell
$ip = "<YOUR_EXTERNAL_IP>"
1..50 | ForEach-Object {
  Start-Process -WindowStyle Hidden -FilePath "curl.exe" `
    -ArgumentList "-s", "-o", "NUL", "http://$ip:3000/?[1-100000]"
}
```

To **stop** the load later:

```powershell
Get-Process curl -ErrorAction SilentlyContinue | Stop-Process -Force
```

**PowerShell 7 alternative (`ForEach-Object -Parallel`):**

```powershell
$ip = "<YOUR_EXTERNAL_IP>"
1..50 | ForEach-Object -Parallel {
  while ($true) { try { Invoke-WebRequest -Uri "http://$using:ip:3000" -UseBasicParsing | Out-Null } catch {} }
} -ThrottleLimit 50
```

**bash (macOS/Linux) — 50 parallel loops:**

```bash
IP=<YOUR_EXTERNAL_IP>
for i in $(seq 1 50); do
  ( while true; do curl -s "http://$IP:3000" > /dev/null; done ) &
done
# stop later with:  kill $(jobs -p)
```

Whichever you use, watch `kubectl top pods` in a third window — you should see the API pod's CPU climb well past its request. If CPU still stays low, add more parallel workers (change `1..50` to `1..100`).

## 3b. Verify the POST method actually writes to the site

The load above sends `GET` requests, which only _read_ the page. To prove the **POST** method works end-to-end (browser -> API -> MongoDB -> worker), send a real job with a JSON body to the `/api/jobs` endpoint.

**Step 1 — Send one job and read the response:**

```powershell
$ip = "<YOUR_EXTERNAL_IP>"
$body = '{"prompt":"Verify POST from PowerShell"}'
Invoke-RestMethod -Uri "http://$ip:3000/api/jobs" -Method Post -ContentType "application/json" -Body $body
```

If the POST got through, the API echoes back the created job (this is your proof):

```text
_id       : 6661a2b3c4d5e6f789012345
prompt    : Verify POST from PowerShell
status    : queued
response  :
error     :
createdAt : 2026-07-07T16:50:00.000Z
updatedAt : 2026-07-07T16:50:00.000Z
```

A `status` of `queued` and a real `_id` mean the write reached MongoDB.

**Step 2 — Confirm it was stored (and later processed):**

```powershell
Invoke-RestMethod -Uri "http://$ip:3000/api/jobs" -Method Get |
  Format-Table _id, status, prompt
```

Run it again after a few seconds — the worker should flip the `status` from `queued` to `completed`. You can also just refresh `http://<YOUR_EXTERNAL_IP>:3000` in the browser and watch the job appear in the **Recent Jobs** list.

**Step 3 — Generate load by POSTing continuously (writes AND drives scaling):**

The most reliable way is to run the **same `Invoke-RestMethod` call you just verified**, in parallel background jobs. (Do **not** try to pass the JSON body through `Start-Process -ArgumentList` — PowerShell mangles the embedded quotes, so `curl` receives a broken body and the API rejects it with `400 Prompt is required`, creating no jobs.)

```powershell
$ip = "<YOUR_EXTERNAL_IP>"
$body = '{"prompt":"load test job"}'

# 20 parallel background loops that POST jobs continuously
1..20 | ForEach-Object {
  Start-Job -ArgumentList $ip, $body -ScriptBlock {
    param($ip, $body)
    while ($true) {
      try { Invoke-RestMethod -Uri "http://$ip:3000/api/jobs" -Method Post -ContentType "application/json" -Body $body | Out-Null } catch {}
    }
  } | Out-Null
}
```

Confirm jobs are being created (run it a few times — the count should keep climbing):

```powershell
(Invoke-RestMethod -Uri "http://$ip:3000/api/jobs" -Method Get).Count
```

Stop the load when you are done:

```powershell
Get-Job | Stop-Job
Get-Job | Remove-Job
```

**Higher-throughput alternative (`curl.exe` with the body in a file):** putting the JSON in a file avoids the quoting problem entirely, and URL globbing (`?[1-100000]`) makes each process repeat the POST 100,000 times:

```powershell
$ip = "<YOUR_EXTERNAL_IP>"
Set-Content -Path body.json -Value '{"prompt":"load test job"}' -NoNewline -Encoding ascii
1..20 | ForEach-Object {
  Start-Process -WindowStyle Hidden -FilePath "curl.exe" -ArgumentList `
    "-s","-o","NUL","-X","POST","http://$ip:3000/api/jobs?[1-100000]", `
    "-H","Content-Type: application/json","-d","@body.json"
}
# stop with: Get-Process curl -ErrorAction SilentlyContinue | Stop-Process -Force
```

> Note: this creates a very large number of jobs in MongoDB. That is fine for a demo (it shows the queue filling up), but reset the database later if you want a clean list. The `?[1-100000]` in the URL is just a counter that makes `curl.exe` repeat the POST — the query string is ignored by the API.

## 4. Watch the autoscaler fire (Window 1)

Within roughly **30 to 90 seconds** you will see this chain reaction:

1. **Metrics spike** — the HPA `TARGETS` percentage climbs past its threshold (e.g. jumps from `5%/20%` to `150%/20%`).
2. **Scale event** — the replica count jumps up.
3. **New pods appear** — new pod rows show up going `Pending -> ContainerCreating -> Running`.

Take your screenshots here.

## 5. Stop the test and watch it scale back down

Press `Ctrl + C` in Window 2 to stop the traffic. After the short cool-down window (about 30 seconds of calm, configured in the manifest), Kubernetes deletes the extra pods and returns to 1 replica to save credits.

---

# Part 11b - The Worker Scaling Demo (queue depth, via KEDA)

This is the demo that best reflects how the app actually works: as the **job backlog** grows in MongoDB, KEDA creates more **worker** pods to drain it, then removes them when the queue empties.

## 1. (Optional) Make the backlog dramatic with real API mode

In **demo mode** the worker completes each job instantly, so a single worker can often keep the queue near empty and you may not see much scaling. To make the backlog build up visibly, use **real API mode** (set `DEMO_MODE=false` and a valid `OPENAI_API_KEY` when you build/push the worker image) so each job takes real time, or simply fire a very large POST burst so jobs arrive faster than one worker can process them.

## 2. Set up the live monitor (Window 1)

```bash
kubectl get scaledobject,pods --watch
```

Also handy in a second window — watch the backlog count and worker HPA directly:

```bash
kubectl get hpa keda-hpa-worker-scaledobject --watch
```

## 3. Flood the queue with jobs (Window 2)

Use the continuous **POST** generator from Part 11, step 3b (it inserts `queued` jobs as fast as possible):

```powershell
$ip = "<YOUR_EXTERNAL_IP>"
$body = '{"prompt":"load test job"}'
1..20 | ForEach-Object {
  Start-Job -ArgumentList $ip, $body -ScriptBlock {
    param($ip, $body)
    while ($true) {
      try { Invoke-RestMethod -Uri "http://$ip:3000/api/jobs" -Method Post -ContentType "application/json" -Body $body | Out-Null } catch {}
    }
  } | Out-Null
}
# stop with: Get-Job | Stop-Job; Get-Job | Remove-Job
```

## 4. Watch the worker scale on the backlog (Window 1)

Within a few polling cycles (KEDA checks every 5 seconds) you will see:

1. **Backlog grows** — the HPA target climbs (e.g. `0/5` -> `50/5 (avg)`) as `queued` jobs pile up.
2. **Workers multiply** — `worker-deployment` replicas jump from 1 toward the max of 8, each new worker showing `Pending -> ContainerCreating -> Running`.
3. **Queue drains** — with 8 workers each claiming jobs (safely, one at a time), the backlog falls.

Because `queryValue` is `5`, KEDA aims for one worker per ~5 queued jobs, so a large backlog quickly requests all 8 workers.

## 5. Stop and scale back down

Stop the POST flood:

```powershell
Get-Process curl -ErrorAction SilentlyContinue | Stop-Process -Force
```

Once the workers drain the remaining backlog and the queue stays empty for the `cooldownPeriod` (30 seconds), KEDA scales the worker back down to 1.

---

# Part 12 - Why It Scales Fast

Several deliberate choices in the manifest make new pods appear _sooner_ so the demo is easy to capture:

1. **Right metric per component** — the API scales on **CPU** (it is CPU-bound under an HTTP flood), while the worker scales on **queue depth** via KEDA (it is I/O-bound waiting on OpenAI, so CPU would never fire). Matching the metric to the workload is what makes each one actually react.
2. **Low API threshold + tiny request** — `averageUtilization: 20` with `cpu: 50m`. Because the HPA measures usage as a percentage of the request, halving the request from `100m` to `50m` doubles the reported utilization for the exact same traffic, so it crosses the threshold faster.
3. **Aggressive queue target** — `queryValue: "5"` means one worker per ~5 backlogged jobs, so even a modest burst requests several workers at once.
4. **Fast reaction everywhere** — every autoscaler uses `behavior.scaleUp.stabilizationWindowSeconds: 0` and policies that double pods or add +4 per 15s, plus short poll/cooldown windows (KEDA `pollingInterval: 5`, `cooldownPeriod: 30`).

## The Load Generator Matters Most

Even with aggressive autoscalers, **you must actually generate enough load**:

- For the **API (CPU) demo**, a single sequential loop (`while ($true) { Invoke-RestMethod ... }`) only produces ~15% CPU because it waits for each request before sending the next. Use the **parallel** generators in Part 11 (50+ concurrent requests).
- For the **worker (queue) demo**, you need jobs to arrive faster than one worker can process them. In demo mode the worker is very fast, so use a big POST burst (Part 11b) or real API mode so each job takes real time and the backlog builds.

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

## Problem: API pods never scale up during the demo

1. Confirm you are hitting the correct public IP with the load loop.
2. Confirm the HPA exists and has a target: `kubectl get hpa`.
3. Watch live CPU: `kubectl top pods`. If CPU is not rising, the traffic is not reaching the API, or you are using a single sequential loop instead of a parallel one (see Part 11).

## Problem: `no matches for kind "ScaledObject"` when applying the manifest

KEDA is not installed. Enable it (Part 4b) and re-apply:

```bash
az aks update --resource-group IndI --name ethanb-aks-cluster --enable-keda
kubectl apply -f kubernetes-manifest.yaml
```

## Problem: `admission webhook "vscaledobject.kb.io" denied the request: ... already managed by the hpa 'worker-hpa'`

You are upgrading from an earlier version that used a CPU-based `worker-hpa`. `kubectl apply` does not delete objects you removed from the manifest, so the old HPA is still in the cluster, and KEDA refuses to manage a workload another HPA already controls. Delete the stale HPA, then re-apply:

```bash
kubectl delete hpa worker-hpa
kubectl apply -f kubernetes-manifest.yaml
```

## Problem: `worker-scaledobject` shows `READY: False`

KEDA cannot reach MongoDB. Check the trigger and the operator logs:

```bash
kubectl describe scaledobject worker-scaledobject
kubectl logs -n kube-system -l app.kubernetes.io/name=keda-operator
```

Common causes:

- **Wrong namespace in the connection string.** The KEDA operator runs in `kube-system` and cannot resolve the short name `mongodb-service`. The `mongodb-keda-secret` must use the fully-qualified address `mongodb-service.default.svc.cluster.local` (change `.default.` if you deployed into a different namespace). This is the most common cause of `READY: False`.
- MongoDB is not running yet (`kubectl get pods` — `mongodb-0` must be `Running`).
- After fixing the Secret, KEDA re-checks within a few seconds; you can also restart the operator with `kubectl rollout restart deployment keda-operator -n kube-system`.

## Problem: Workers don't scale up even with a backlog

1. Confirm there is actually a backlog: the demo-mode worker completes jobs almost instantly, so a single worker may keep the queue near empty. Fire a bigger POST burst or use real API mode (Part 11b, step 1).
2. Check the current queue value on the HPA: `kubectl get hpa keda-hpa-worker-scaledobject`.
3. Confirm the ScaledObject is `ACTIVE: True`: `kubectl get scaledobject`.

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
4. `kubectl get hpa` and `kubectl get scaledobject` showing both autoscalers active (`worker-scaledobject` should be `READY: True`).
5. **API demo:** `kubectl get hpa,pods --watch` during the HTTP load test, showing the `TARGETS` percentage over threshold and **new API pods being created** (`Pending`/`ContainerCreating`/`Running`).
6. **Worker demo:** `kubectl get scaledobject,pods --watch` during the POST/job flood, showing the queue backlog growing and **new worker pods being created**.
7. Both deployments returning to 1 replica after the load stops.

Students should also submit this file:

- `kubernetes-manifest.yaml`
