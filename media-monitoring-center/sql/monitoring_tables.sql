-- izzi Media Monitoring Center · tablas propias de la app (estado operativo).
-- Reemplaza `PROYECTO.DATASET` por el dataset de estado (BIGQUERY_STATE_DATASET o BIGQUERY_DATASET).
-- Todas son append-only: cada cambio inserta una versión; la app lee la última por id.
-- Particionadas por día y agrupadas (clustering) para que las lecturas sean baratas.

CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.monitoring_alerts` (
  id STRING NOT NULL,
  fingerprint STRING NOT NULL,
  platform STRING,
  severity STRING,
  status STRING,
  detected_at TIMESTAMP,
  resolved_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL,
  payload STRING NOT NULL -- JSON completo de la alerta
)
PARTITION BY DATE(updated_at)
CLUSTER BY id, platform
OPTIONS (partition_expiration_days = 400);

CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.monitoring_incidents` (
  id STRING NOT NULL,
  fingerprint STRING NOT NULL,
  platform STRING,
  severity STRING,
  status STRING,
  started_at TIMESTAMP,
  resolved_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL,
  payload STRING NOT NULL
)
PARTITION BY DATE(updated_at)
CLUSTER BY id, platform;

CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.monitoring_notifications` (
  id STRING NOT NULL,
  incident_id STRING,
  platform STRING,
  kind STRING,
  severity STRING,
  channel STRING,
  status STRING,
  created_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL,
  payload STRING NOT NULL
)
PARTITION BY DATE(updated_at)
CLUSTER BY incident_id, platform;

CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.monitoring_runs` (
  id STRING NOT NULL,
  business_date DATE NOT NULL,
  run_at TIMESTAMP NOT NULL,
  trigger STRING,
  overall STRING,
  updated_at TIMESTAMP NOT NULL,
  payload STRING NOT NULL
)
PARTITION BY business_date
CLUSTER BY overall;

CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.monitoring_settings` (
  id STRING NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  updated_by STRING,
  payload STRING NOT NULL
)
PARTITION BY DATE(updated_at);

CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.monitoring_budget_overrides` (
  id STRING NOT NULL, -- mes|nivel|plataforma|cuenta|campaña
  updated_at TIMESTAMP NOT NULL,
  payload STRING NOT NULL
)
PARTITION BY DATE(updated_at);

-- Permisos mínimos de la service account de la app:
--   roles/bigquery.jobUser en el proyecto (ejecutar consultas)
--   roles/bigquery.dataViewer en el dataset de métricas (solo lectura)
--   roles/bigquery.dataEditor en el dataset de estado (insertar en estas tablas)
