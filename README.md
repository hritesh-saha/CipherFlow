#  CipherFlow: High-Throughput Cryptographic Ingestion Pipeline

[![Kubernetes](https://img.shields.io/badge/kubernetes-%23326ce5.svg?style=for-the-badge&logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/fastify-%23000000.svg?style=for-the-badge&logo=fastify&logoColor=white)](https://www.fastify.io/)
[![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![ArgoCD](https://img.shields.io/badge/ArgoCD-EF7B4D?style=for-the-badge&logo=argo&logoColor=white)](https://argoproj.github.io/cd/)
[![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=Prometheus&logoColor=white)](https://prometheus.io/)
[![Grafana](https://img.shields.io/badge/grafana-%23F46800.svg?style=for-the-badge&logo=grafana&logoColor=white)](https://grafana.com/)

CipherFlow is an enterprise-grade, event-driven microservices architecture built on Kubernetes. It is designed to securely ingest, queue, and decrypt highly sensitive data payloads at scale while enforcing strict Zero-Trust security and GitOps deployment principles.

##  System Architecture

CipherFlow completely decouples data ingestion from heavy cryptographic processing to survive massive traffic spikes without dropping connections.

1. **Ingestion API (Fastify):** Receives encrypted JSON payloads, validates them using Zod, pushes them to a Redis Stream, and instantly returns a `202 Accepted` response.
2. **Message Broker (Redis Streams):** Acts as a highly available, in-memory queue.
3. **Cryptography Worker (Node.js):** Consumes events from Redis via Consumer Groups at its own safe pace, decrypts the payloads using AES-256-GCM, and persists the plaintext to the database.
4. **Persistent Storage (PostgreSQL):** Deployed as a Kubernetes StatefulSet to ensure data integrity and stable network identity.

##  Key DevSecOps Features

* **GitOps Continuous Deployment:** The entire cluster state (infrastructure and applications) is managed by **ArgoCD**, ensuring the live cluster strictly mirrors this Git repository.
* **Zero-Trust Security (Micro-segmentation):** Kubernetes **Network Policies** restrict lateral movement. (e.g., The API can write to Redis, but is physically blocked by the network from accessing the PostgreSQL database).
* **Hardened Containers:** All Pods enforce strict **Security Contexts** (`runAsNonRoot: true`, `runAsUser: 1000`), preventing container breakout vulnerabilities.
* **Full-Stack Observability (DaC):** Custom application metrics (like `worker_events_processed_total`) are scraped by **Prometheus** via `ServiceMonitors`.
* **Dashboard-as-Code:** **Grafana** dashboards are injected automatically via Kubernetes ConfigMaps labeled with `grafana_dashboard: "1"`, surviving cluster teardowns.
* **Resiliency & DLQ:** Implements Dead Letter Queue (DLQ) patterns for deterministic cryptographic failures and exponential backoff for transient database errors.
* **Webhook Dispatch:** Asynchronous failure notifications are sent back to clients securely using HMAC-signed Webhook POST requests.

##  Quick Start (Local Development)

### Prerequisites
* Docker Desktop / Engine
* `kind` (Kubernetes IN Docker)
* `kubectl`
* `helm`

### 1. Bootstrap the Infrastructure
Run the following commands sequentially in your terminal to spin up the cluster, install controllers, and deploy the stack.

**Create Cluster & Load Images:**
```bash
kind create cluster --name cipherflow --config kind-config.yaml
kind load docker-image cipherflow-api:1.1 --name cipherflow
kind load docker-image cipherflow-worker:1.1 --name cipherflow
```

**Install NGINX Ingress & Metrics Server:**
```bash
kubectl apply -f [https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml](https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml)
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=90s

kubectl apply -f [https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml](https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml)
kubectl patch -n kube-system deployment metrics-server --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

**Inject Secrets & Install Observability Stack:**
```bash
kubectl create secret generic cipherflow-secrets \
  --from-literal=encryption-key="local-dev-key-12345" \
  --from-literal=db-user="postgres" \
  --from-literal=db-password="local-password"

helm repo add prometheus-community [https://prometheus-community.github.io/helm-charts](https://prometheus-community.github.io/helm-charts)
helm repo update
helm install observability prometheus-community/kube-prometheus-stack --namespace monitoring --create-namespace
```

**Install ArgoCD & Apply GitOps Blueprint:**
```bash
kubectl create namespace argocd
kubectl apply -n argocd -f [https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml](https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml) --server-side
kubectl wait --namespace argocd --for=condition=ready pod --selector=app.kubernetes.io/name=argocd-server --timeout=180s

kubectl apply -f gitops.yaml
```

**Retrieve Autogenerated Passwords:**
*(Wait a few moments for the cluster to finish generating the secrets before running this)*
```bash
echo "ArgoCD Password: $(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 --decode)"
echo "Grafana Password: $(kubectl -n monitoring get secret observability-grafana -o jsonpath="{.data.admin-password}" | base64 --decode)"
```

### 2. Open Local Tunnels
Because this is a local cluster, open three separate terminal windows to port-forward the essential services:

```bash
# Terminal 1: ArgoCD UI (https://localhost:8080)
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Terminal 2: Grafana UI (http://localhost:3000)
kubectl port-forward svc/observability-grafana -n monitoring 3000:80

# Terminal 3: Application API ([http://127.0.0.1:8000](http://127.0.0.1:8000))
kubectl port-forward svc/cipherflow-api-svc 8000:80
```

##  Testing the Pipeline

### Generate an Encrypted Event
Send a valid JSON payload to the ingestion API using the provided `requests.http` file or standard cURL:

```bash
curl -X POST [http://127.0.0.1:8000/audit/events](http://127.0.0.1:8000/audit/events) \
  -H "Content-Type: application/json" \
  -d '{"event_id": "test_001", "source": "terminal", "webhook_url": "[https://example.com/webhook](https://example.com/webhook)", "encrypted_payload": "aa:bb:cc"}'
```
**Expected Response:** `202 Accepted` (with a generated `stream_id`).

### Load Testing (Triggering Grafana Spikes)
To see the observability stack in action, hammer the API's health endpoint to generate a traffic spike on your Grafana dashboard.

```bash
# Run 50 requests back-to-back
for i in {1..50}; do curl [http://127.0.0.1:8000/health/live](http://127.0.0.1:8000/health/live); echo ""; sleep 1; done
```

## 📁 Repository Structure

```text
├── cipherflow-api/             # Fastify Ingestion Server (Microservice 1)
│   ├── Dockerfile              # Containerization blueprint for the API
│   ├── package-lock.json
│   ├── package.json
│   ├── src/
│   │   └── server.ts           # Zod validation, HTTP endpoints, and Redis XADD logic
│   └── tsconfig.json
├── cipherflow-worker/          # Decryption & Queue Consumer (Microservice 2)
│   ├── Dockerfile              # Containerization blueprint for the Worker
│   ├── encrypt.ts              # AES-256-GCM cryptography service and key management
│   ├── package-lock.json
│   ├── package.json
│   ├── src/
│   │   ├── db.ts               # PostgreSQL connection pool and state management
│   │   └── worker.ts           # Redis Consumer Group loop, DLQ routing, and Webhook dispatch
│   └── tsconfig.json
├── gitops.yaml                 # ArgoCD Application manifest for automated syncing
├── k8s/                        # Kubernetes Infrastructure as Code (GitOps source of truth)
│   ├── api.yaml                # API Deployment & ClusterIP Service
│   ├── dashboard.yaml          # Grafana Dashboard-as-Code (DaC) ConfigMap
│   ├── hpa.yaml                # Horizontal Pod Autoscaler for CPU-based scaling
│   ├── ingress.yaml            # NGINX Ingress rules for external routing
│   ├── monitor.yaml            # Prometheus ServiceMonitor for custom metric scraping
│   ├── network-policies.yaml   # Zero-Trust micro-segmentation firewall rules
│   ├── postgres.yaml           # Database StatefulSet & PersistentVolumeClaim
│   ├── rbac.yaml               # Role-Based Access Control permissions
│   ├── redis.yaml              # Message Broker StatefulSet & Headless Service
│   └── worker.yaml             # Worker Deployment & Service definitions
├── kind-config.yaml            # Local cluster configuration and node port mapping
├── LICENSE                     # MIT License
└── requests.http               # HTTP client test suite for triggering payloads and webhooks
```

## 📜 License
BSD 3-Clause License
