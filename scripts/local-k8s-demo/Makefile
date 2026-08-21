# Local demo: two n8n instances plus the airgap-monitoring service, all running
# in a kind cluster, with the instances reporting over the cluster network.
# Run `make up`; see README.md for prerequisites.

CLUSTER          := airgap-demo
NAMESPACES       := n8n-1 n8n-2
MONITORING_NS    := monitoring
N8N_IMAGE        := n8nio/n8n:local
MONITORING_IMAGE := airgap-monitoring:local
REPO_ROOT        := $(CURDIR)/../..
PIDS_FILE        := .pids

# Demo credentials. INSTANCE_TOKEN is shared by both sides of the reporting
# handshake: the instances send it as a bearer token and the service checks it
# against its own N8N_INSTANCE_AUTH_TOKEN, so the two must stay equal.
INSTANCE_TOKEN   := demo-instance-token
DASHBOARD_TOKEN  := demo-dashboard-token
OWNER_EMAIL      := admin@n8n.io
OWNER_PASSWORD   := hello1234

# Cluster DNS name of the ingest endpoint — the whole point of the demo is that
# this traffic never leaves the cluster.
INGEST_URL := http://airgap-monitoring.$(MONITORING_NS).svc.cluster.local:3000/api/v1/instance-reports

# Every minute instead of the 60-minute default, so a report shows up while
# someone is still watching.
REPORT_INTERVAL_MINUTES := 1

# Host ports for the port-forwards.
N8N_1_PORT      := 3003
N8N_2_PORT      := 3004
MONITORING_PORT := 3010

# Isolated kubeconfig — never touches ~/.kube/config.
export KUBECONFIG := $(CURDIR)/.kubeconfig

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Lifecycle ─────────────────────────────────────────────────────────────────

.PHONY: up
up: cluster images install ## Full setup: cluster + images + deploy + port-forwards
	@$(MAKE) wait || echo "==> Warning: some pods are still starting — run 'make status' to check"
	@# Existing forwards point at pods this run has just replaced, so they are
	@# always torn down and re-established rather than reused.
	@$(MAKE) unforward
	@$(MAKE) forward
	@# Seeding talks to the instances over the forwards, so it comes last.
	@$(MAKE) seed || echo "==> Warning: seeding failed — run 'make seed' once the instances are up"
	@echo ""
	@echo "  n8n-1 (axolotl)     http://localhost:$(N8N_1_PORT)"
	@echo "  n8n-2 (narwhal)     http://localhost:$(N8N_2_PORT)"
	@echo "  monitoring          http://localhost:$(MONITORING_PORT)"
	@echo ""
	@echo "  n8n login           $(OWNER_EMAIL) / $(OWNER_PASSWORD)"
	@echo "  dashboard token     $(DASHBOARD_TOKEN)"
	@echo ""
	@echo "  Both instances report every $(REPORT_INTERVAL_MINUTES) min to the cluster-internal URL"
	@echo "  $(INGEST_URL)"
	@echo "  The first report is sent one interval after an instance boots."
	@echo "  Run 'make reports' to see what has arrived so far."

.PHONY: down
down: unforward uninstall ## Teardown: stop port-forwards + remove workloads (keeps the cluster)

.PHONY: nuke
nuke: down delete-cluster ## Full destruction: teardown + delete the kind cluster

# ── Cluster ───────────────────────────────────────────────────────────────────

.PHONY: cluster
cluster: ## Create the kind cluster (no-op if it already exists)
	@if kind get clusters 2>/dev/null | grep -qx $(CLUSTER); then \
		echo "==> Cluster $(CLUSTER) already exists. Skipping creation."; \
	else \
		kind create cluster --name $(CLUSTER) --kubeconfig $(KUBECONFIG); \
	fi

.PHONY: delete-cluster
delete-cluster: ## Delete the kind cluster and its kubeconfig
	@kind delete cluster --name $(CLUSTER) --kubeconfig $(KUBECONFIG) 2>/dev/null || true
	@rm -f $(KUBECONFIG)
	@echo "Cluster deleted."

# ── Images ────────────────────────────────────────────────────────────────────

.PHONY: images
images: cluster ## Build the monitoring image and load both images into kind
	@if ! docker image inspect $(N8N_IMAGE) >/dev/null 2>&1; then \
		echo "ERROR: $(N8N_IMAGE) not found locally."; \
		echo "Build it from your n8n checkout first (e.g. 'pnpm build:docker' in the n8n repo)."; \
		exit 1; \
	fi
	@echo "==> Building $(MONITORING_IMAGE) from the repo root..."
	@docker build -t $(MONITORING_IMAGE) $(REPO_ROOT)
	@echo "==> Loading images into kind..."
	@kind load docker-image $(N8N_IMAGE) $(MONITORING_IMAGE) --name $(CLUSTER)

# ── Install / Uninstall ───────────────────────────────────────────────────────

.PHONY: install
install: install-monitoring install-n8n ## Deploy the monitoring service and both n8n instances

.PHONY: install-monitoring
install-monitoring: ## Deploy the airgap-monitoring service
	@echo "==> Installing airgap-monitoring"
	@kubectl create namespace $(MONITORING_NS) --dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic airgap-monitoring-tokens -n $(MONITORING_NS) \
		--from-literal=N8N_INSTANCE_AUTH_TOKEN=$(INSTANCE_TOKEN) \
		--from-literal=N8N_DASHBOARD_AUTH_TOKEN=$(DASHBOARD_TOKEN) \
		--dry-run=client -o yaml | kubectl apply -f -
	@kubectl apply -f k8s/monitoring.yaml
	@kubectl rollout restart deployment/airgap-monitoring -n $(MONITORING_NS) >/dev/null

.PHONY: install-n8n
# The encryption key is reused when the secret already exists: n8n bakes it into
# the credentials it has written to the volume, so regenerating it on every run
# would make that data undecryptable after a restart.
install-n8n: ## Deploy both n8n instances
	@for ns in $(NAMESPACES); do \
		case $$ns in \
			n8n-1) identifier=axolotl ;; \
			n8n-2) identifier=narwhal ;; \
		esac; \
		echo "==> Installing $$ns (identifier: $$identifier)"; \
		kubectl create namespace $$ns --dry-run=client -o yaml | kubectl apply -f -; \
		enc_key=$$(kubectl get secret n8n-secrets -n $$ns -o jsonpath='{.data.N8N_ENCRYPTION_KEY}' 2>/dev/null | base64 -d); \
		if [ -z "$$enc_key" ]; then enc_key=$$(openssl rand -hex 32); fi; \
		kubectl create secret generic n8n-secrets -n $$ns \
			--from-literal=N8N_ENCRYPTION_KEY=$$enc_key \
			--dry-run=client -o yaml | kubectl apply -f -; \
		if [ -f .env ]; then \
			kubectl create secret generic n8n-env-file -n $$ns \
				--from-env-file=.env \
				--dry-run=client -o yaml | kubectl apply -f -; \
		fi; \
		sed -e "s|__NAMESPACE__|$$ns|g" \
			-e "s|__IDENTIFIER__|$$identifier|g" \
			-e "s|__INGEST_URL__|$(INGEST_URL)|g" \
			-e "s|__INSTANCE_TOKEN__|$(INSTANCE_TOKEN)|g" \
			-e "s|__REPORT_INTERVAL_MINUTES__|$(REPORT_INTERVAL_MINUTES)|g" \
			k8s/n8n-instance.template.yaml | kubectl apply -f -; \
	done

.PHONY: uninstall
uninstall: ## Delete both n8n namespaces and the monitoring namespace
	@for ns in $(NAMESPACES) $(MONITORING_NS); do \
		echo "==> Removing $$ns"; \
		kubectl delete namespace $$ns --ignore-not-found; \
	done

# ── Wait / Status ─────────────────────────────────────────────────────────────

.PHONY: wait
wait: ## Wait for all deployments to become ready
	@echo "==> Waiting for pods to be ready (first boot pulls no images but runs migrations)..."
	@pids=""; \
	kubectl rollout status deployment/airgap-monitoring -n $(MONITORING_NS) --timeout=300s & pids="$$pids $$!"; \
	for ns in $(NAMESPACES); do \
		kubectl rollout status deployment/n8n -n $$ns --timeout=600s & pids="$$pids $$!"; \
	done; \
	failed=0; \
	for pid in $$pids; do wait $$pid || failed=1; done; \
	exit $$failed

.PHONY: status
status: ## Show pod status across all namespaces
	@for ns in $(MONITORING_NS) $(NAMESPACES); do \
		echo "==> $$ns"; \
		kubectl get pods -n $$ns 2>/dev/null || echo "  (namespace not found)"; \
		echo ""; \
	done

.PHONY: seed
# Every 10 seconds is deliberately noisy: billable numbers move within a minute
# instead of after an hour of waiting.
seed: ## Create and activate the schedule-trigger workflow on both instances
	@for ns in $(NAMESPACES); do \
		case $$ns in \
			n8n-1) port=$(N8N_1_PORT) ;; \
			n8n-2) port=$(N8N_2_PORT) ;; \
		esac; \
		./seed-workflow.py http://localhost:$$port $(OWNER_EMAIL) $(OWNER_PASSWORD) \
			workflows/schedule-demo.json || exit 1; \
	done

.PHONY: reports
reports: ## Print the reports the monitoring service has received so far
	@curl -fsS -H "Authorization: Bearer $(DASHBOARD_TOKEN)" \
		http://localhost:$(MONITORING_PORT)/api/v1/instance-reports \
		|| echo "Request failed — is 'make forward' running?"
	@echo ""

# ── Port-forwards ─────────────────────────────────────────────────────────────

.PHONY: forward
forward: ## Start background port-forwards (3003, 3004, 3010)
	@if [ -f $(PIDS_FILE) ]; then \
		if xargs kill -0 < $(PIDS_FILE) 2>/dev/null; then \
			echo "Port-forwards already running ($(PIDS_FILE) exists). Run 'make unforward' first."; \
			exit 1; \
		else \
			echo "Removing stale $(PIDS_FILE) (processes no longer running)."; \
			rm -f $(PIDS_FILE); \
		fi; \
	fi
	@mkdir -p logs
	@for ns in $(NAMESPACES); do \
		case $$ns in \
			n8n-1) port=$(N8N_1_PORT) ;; \
			n8n-2) port=$(N8N_2_PORT) ;; \
		esac; \
		echo "==> Forwarding localhost:$$port → $$ns/n8n:5678"; \
		kubectl port-forward svc/n8n -n $$ns $$port:5678 > logs/$$ns.log 2>&1 & \
		echo $$! >> $(PIDS_FILE); \
	done
	@echo "==> Forwarding localhost:$(MONITORING_PORT) → $(MONITORING_NS)/airgap-monitoring:3000"
	@kubectl port-forward svc/airgap-monitoring -n $(MONITORING_NS) $(MONITORING_PORT):3000 > logs/monitoring.log 2>&1 & \
		echo $$! >> $(PIDS_FILE)
	@echo "Port-forwards started. Logs in ./logs/. Stop with 'make unforward'."

.PHONY: unforward
unforward: ## Stop all background port-forwards
	@if [ ! -f $(PIDS_FILE) ]; then \
		echo "No port-forwards running ($(PIDS_FILE) not found)."; \
	else \
		while IFS= read -r pid; do kill "$$pid" 2>/dev/null || true; done < $(PIDS_FILE); \
		rm -f $(PIDS_FILE); \
		echo "Port-forwards stopped."; \
	fi
