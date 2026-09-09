# Local demo: two n8n instances plus the airgap-monitoring service, all running
# in a kind cluster, with the instances reporting over the cluster network.
# Run `make up`; see README.md for prerequisites.

CLUSTER          := airgap-demo
MONITORING_NS    := monitoring
N8N_IMAGE        := n8nio/n8n:local
MONITORING_IMAGE := airgap-monitoring:local
REPO_ROOT        := $(CURDIR)/../..
PIDS_FILE        := .pids

# Demo credentials. WRITE_TOKEN is shared by both sides of the reporting
# handshake: the instances send it as a bearer token and the service checks it
# against its own N8N_MONITORING_WRITE_TOKEN, so the two must stay equal.
WRITE_TOKEN      := demo-write-token
# READ_TOKEN guards the report download. Only the monitoring service needs it,
# but the service refuses to boot without it, so it must be in the secret.
READ_TOKEN       := demo-read-token
OWNER_EMAIL      := admin@n8n.io
OWNER_PASSWORD   := hello1234

# Cluster DNS name of the ingest endpoint — the whole point of the demo is that
# this traffic never leaves the cluster.
INGEST_BASE_URL := http://airgap-monitoring.$(MONITORING_NS).svc.cluster.local:3000

# One row per n8n instance, as namespace:host-port:reporting-identifier. Every
# loop below reads this table, so adding an instance is a one-line change.
# Recipes unpack a row with `ns=$${spec%%:*}` and friends.
INSTANCES  := n8n-1:3003:axolotl n8n-2:3004:narwhal
NAMESPACES := $(foreach spec,$(INSTANCES),$(firstword $(subst :, ,$(spec))))

MONITORING_PORT := 3010

# Days of invented history posted to the collector by `make backfill`, so there
# is a daily series on a cluster that is minutes old. 0 disables it.
BACKFILL_DAYS ?= 3

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
	@# Seeding and backfilling talk to the instances over the forwards, so they
	@# come last. Neither is fatal: the cluster is still usable without them.
	@$(MAKE) seed || echo "==> Warning: seeding failed — run 'make seed' once the instances are up"
	@$(MAKE) backfill || echo "==> Warning: backfill failed — run 'make backfill' to retry"
	@echo ""
	@for spec in $(INSTANCES); do \
		ns=$${spec%%:*}; rest=$${spec#*:}; port=$${rest%%:*}; identifier=$${spec##*:}; \
		printf '  %-20s http://localhost:%s\n' "$$ns ($$identifier)" "$$port"; \
	done
	@printf '  %-20s http://localhost:%s\n' "monitoring API" "$(MONITORING_PORT)"
	@echo ""
	@echo "  n8n login           $(OWNER_EMAIL) / $(OWNER_PASSWORD)"
	@echo "  write token         $(WRITE_TOKEN)"
	@echo "  read token          $(READ_TOKEN)"
	@echo ""
	@echo "  Both instances report once a day, at a random UTC time chosen on first boot,"
	@echo "  to the cluster-internal URL"
	@echo "  $(INGEST_BASE_URL)"
	@echo "  Run 'make reports' to see what has arrived so far."

.PHONY: down
down: unforward uninstall ## Teardown: stop port-forwards + remove workloads (keeps the cluster)

.PHONY: nuke
nuke: down delete-cluster ## Full destruction: teardown + delete the kind cluster

# ── Cluster ───────────────────────────────────────────────────────────────────

.PHONY: cluster
# The kubeconfig is re-exported even when the cluster already exists: it can go
# missing while the cluster lives on (a stray `rm`, a checkout without it), and
# then every kubectl below falls back to localhost:8080 and fails.
cluster: ## Create the kind cluster (no-op if it already exists)
	@if kind get clusters 2>/dev/null | grep -qx $(CLUSTER); then \
		echo "==> Cluster $(CLUSTER) already exists. Skipping creation."; \
		kind export kubeconfig --name $(CLUSTER) --kubeconfig $(KUBECONFIG) >/dev/null; \
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
		--from-literal=N8N_MONITORING_WRITE_TOKEN=$(WRITE_TOKEN) \
		--from-literal=N8N_MONITORING_READ_TOKEN=$(READ_TOKEN) \
		--dry-run=client -o yaml | kubectl apply -f -
	@kubectl apply -f k8s/monitoring.yaml
	@kubectl rollout restart deployment/airgap-monitoring -n $(MONITORING_NS) >/dev/null

.PHONY: install-n8n
# The encryption key is reused when the secret already exists: n8n bakes it into
# the credentials it has written to the volume, so regenerating it on every run
# would make that data undecryptable after a restart.
install-n8n: ## Deploy both n8n instances
	@for spec in $(INSTANCES); do \
		ns=$${spec%%:*}; identifier=$${spec##*:}; \
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
			-e "s|__INGEST_BASE_URL__|$(INGEST_BASE_URL)|g" \
			-e "s|__WRITE_TOKEN__|$(WRITE_TOKEN)|g" \
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
	@for spec in $(INSTANCES); do \
		rest=$${spec#*:}; port=$${rest%%:*}; \
		./seed-workflow.py http://localhost:$$port $(OWNER_EMAIL) $(OWNER_PASSWORD) \
			workflows/schedule-demo.json || exit 1; \
	done

.PHONY: backfill
# Only the collector is backfilled, not n8n's own insights tables. n8n therefore
# still reports yesterday as 0 until it has run across a UTC midnight, which is
# why the invented days stop at the day before yesterday — see backfill-reports.py.
backfill: ## Post BACKFILL_DAYS of invented daily history to the collector
	@if [ "$(BACKFILL_DAYS)" -lt 1 ]; then \
		echo "==> BACKFILL_DAYS=$(BACKFILL_DAYS), skipping backfill"; \
	else \
		for spec in $(INSTANCES); do \
			ns=$${spec%%:*}; rest=$${spec#*:}; port=$${rest%%:*}; identifier=$${spec##*:}; \
			N8N_EMAIL=$(OWNER_EMAIL) \
			N8N_PASSWORD=$(OWNER_PASSWORD) \
			N8N_MONITORING_WRITE_TOKEN=$(WRITE_TOKEN) \
			N8N_ENCRYPTION_KEY=$$(kubectl get secret n8n-secrets -n $$ns -o jsonpath='{.data.N8N_ENCRYPTION_KEY}' | base64 -d) \
			./backfill-reports.py http://localhost:$$port http://localhost:$(MONITORING_PORT) \
				$$identifier $(BACKFILL_DAYS) || exit 1; \
		done; \
	fi

.PHONY: reports
# Read straight out of the SQLite file in the pod: the service is write-only for
# now (POST /api/v1/instance-reports is the only route), so there is no read
# endpoint to curl. Replace this with a request once one exists.
reports: ## Print the reports the monitoring service has received so far
	@kubectl exec deploy/airgap-monitoring -n $(MONITORING_NS) -- node -e \
		'new (require("sqlite3").Database)(process.env.N8N_DB_PATH).all("SELECT id, instanceId, batchId, label, n8nVersion, data, receivedAt FROM instance_reports ORDER BY id", (err, rows) => { if (err) throw err; console.log(JSON.stringify(rows.map(row => ({ ...row, data: JSON.parse(row.data) })), null, 2)) })' \
		|| echo "Query failed — is the monitoring pod running? Check 'make status'."

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
	@for spec in $(INSTANCES); do \
		ns=$${spec%%:*}; rest=$${spec#*:}; port=$${rest%%:*}; \
		echo "==> Forwarding localhost:$$port → $$ns/n8n:5678"; \
		kubectl port-forward svc/n8n -n $$ns $$port:5678 > logs/$$ns.log 2>&1 & \
		echo $$! >> $(PIDS_FILE); \
	done
	@echo "==> Forwarding localhost:$(MONITORING_PORT) → $(MONITORING_NS)/airgap-monitoring:3000"
	@kubectl port-forward svc/airgap-monitoring -n $(MONITORING_NS) $(MONITORING_PORT):3000 > logs/monitoring.log 2>&1 & \
		echo $$! >> $(PIDS_FILE)
	@# kubectl exits within milliseconds when a port is taken or the pod is gone,
	@# so the forwards are confirmed alive rather than assumed to be.
	@sleep 2
	@dead=0; \
	while IFS= read -r pid; do kill -0 "$$pid" 2>/dev/null || dead=1; done < $(PIDS_FILE); \
	if [ $$dead -eq 1 ]; then \
		echo "ERROR: at least one port-forward exited immediately. Logs:"; \
		tail -n 3 logs/*.log; \
		$(MAKE) --no-print-directory unforward >/dev/null; \
		exit 1; \
	fi
	@echo "Port-forwards started. Logs in ./logs/. Stop with 'make unforward'."

.PHONY: unforward
# Forwards are also killed by command line, not just by PID: a lost $(PIDS_FILE)
# used to strand them holding the ports, which made the next `make forward` fail
# to bind while the stale ones served a pod that no longer existed.
unforward: ## Stop all background port-forwards
	@if [ -f $(PIDS_FILE) ]; then \
		while IFS= read -r pid; do kill "$$pid" 2>/dev/null || true; done < $(PIDS_FILE); \
		rm -f $(PIDS_FILE); \
	fi
	@for spec in $(INSTANCES); do \
		ns=$${spec%%:*}; rest=$${spec#*:}; port=$${rest%%:*}; \
		pkill -f "port-forward svc/n8n -n $$ns $$port:5678" 2>/dev/null || true; \
	done
	@pkill -f "port-forward svc/airgap-monitoring -n $(MONITORING_NS) $(MONITORING_PORT):3000" 2>/dev/null || true
	@echo "Port-forwards stopped."
