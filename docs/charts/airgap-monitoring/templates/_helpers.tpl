{{/*
Expand the name of the chart.
*/}}
{{- define "airgap-monitoring.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name, truncated to 63 characters for name-length limits.
A release called "airgap-monitoring" yields "airgap-monitoring", not
"airgap-monitoring-airgap-monitoring".
*/}}
{{- define "airgap-monitoring.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Selector labels. Stable across chart versions: changing them would orphan the
running pod from its Deployment.
*/}}
{{- define "airgap-monitoring.selectorLabels" -}}
app.kubernetes.io/name: {{ include "airgap-monitoring.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Labels applied to every resource, including the pod template.
*/}}
{{- define "airgap-monitoring.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "airgap-monitoring.selectorLabels" . }}
app.kubernetes.io/version: {{ include "airgap-monitoring.imageTag" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Image tag: image.tag when set, otherwise the chart's appVersion.
*/}}
{{- define "airgap-monitoring.imageTag" -}}
{{- default .Chart.AppVersion .Values.image.tag -}}
{{- end -}}

{{/*
Name of the PersistentVolumeClaim mounted at /data.
*/}}
{{- define "airgap-monitoring.claimName" -}}
{{- default (include "airgap-monitoring.fullname" .) .Values.persistence.existingClaim -}}
{{- end -}}
