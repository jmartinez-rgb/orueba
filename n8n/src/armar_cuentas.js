/* Versión del motor: el sitio la compara con la suya y avisa si el workflow activo es otro.
   También viaja la versión de la API de Meta configurada en n8n (META_API_VERSION). */
const MOTOR_VERSION = '5.6.0';
const x = $input.first().json || {};
return [{ json: { cuentas: x.cuentas || [], motor_version: MOTOR_VERSION, api_version: x.api_version || '', api_vigente: x.api_vigente !== false, api_minima: x.api_minima || '' } }];
