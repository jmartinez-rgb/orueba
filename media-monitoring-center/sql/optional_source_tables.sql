-- izzi Media Monitoring Center · tablas de apoyo OPCIONALES (las llena el equipo, la app solo las lee).
-- Úsalas solo si prefieres BigQuery en lugar de Settings (tipo de cambio) o de la hoja de Google
-- Sheets (control de ejecución). Reemplaza `PROYECTO.DATASET` y declara las tablas en el mapeo
-- (`fxRates` y `executionControl` con "type": "bigquery"). Detalle en docs/DATOS.md.

-- Tipo de cambio mensual: 1 USD = tasa MXN. Una fila por mes.
CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.tipo_cambio_mensual` (
  mes STRING NOT NULL,        -- "2026-09"
  tasa NUMERIC NOT NULL,      -- 18.4500
  moneda STRING,              -- "USD" (opcional)
  actualizado_en TIMESTAMP
);

-- Control de ejecución: una fila por paso (Dataslayer, Apps Script, API), actualizada en cada corrida.
CREATE TABLE IF NOT EXISTS `PROYECTO.DATASET.control_ejecucion` (
  paso STRING NOT NULL,       -- "Apps Script · Sheets → BigQuery"
  plataforma STRING,          -- google | meta | tiktok | microsoft | spotify | x (NULL = todas)
  fuente STRING,              -- Dataslayer | Apps Script | API | n8n
  estado STRING NOT NULL,     -- OK | PARCIAL | PENDIENTE | EJECUTANDO | ERROR
  ultima_ejecucion TIMESTAMP, -- con zona; un DATETIME sin zona se interpreta en la zona de negocio
  filas INT64,
  mensaje STRING,
  cada_minutos INT64          -- frecuencia esperada (default 120)
);

-- Ejemplo de actualización al final de un proceso (MERGE para mantener una fila por paso):
-- MERGE `PROYECTO.DATASET.control_ejecucion` t
-- USING (SELECT "Apps Script · Sheets → BigQuery" AS paso, CAST(NULL AS STRING) AS plataforma, "Apps Script" AS fuente,
--               "OK" AS estado, CURRENT_TIMESTAMP() AS ultima_ejecucion, 148 AS filas, CAST(NULL AS STRING) AS mensaje, 120 AS cada_minutos) s
-- ON t.paso = s.paso
-- WHEN MATCHED THEN UPDATE SET estado = s.estado, ultima_ejecucion = s.ultima_ejecucion, filas = s.filas, mensaje = s.mensaje
-- WHEN NOT MATCHED THEN INSERT ROW;
