{{/*
Expand the name of the chart.
*/}}
{{- define "helpdesk-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name, avoiding double-naming when the
release name already contains the chart name.
*/}}
{{- define "helpdesk-api.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "helpdesk-api.labels" -}}
app.kubernetes.io/name: {{ include "helpdesk-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "helpdesk-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "helpdesk-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "helpdesk-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "helpdesk-api.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "helpdesk-api.secretName" -}}
{{- printf "%s-secret" (include "helpdesk-api.fullname" .) }}
{{- end }}
