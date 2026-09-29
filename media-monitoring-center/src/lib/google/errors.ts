/**
 * Traduce los errores de Google (credenciales, permisos, hoja) a la causa y el paso para arreglarlo.
 * Devuelve null si el error no es uno de los conocidos.
 */
export function explainGoogleError(technical: string): string | null {
  const m = technical;
  if (/Invalid JWT Signature|account not found|invalid_client|deleted_client|disabled_client/i.test(m)) {
    return "La llave de la cuenta de servicio ya no es válida: se borró o se reemplazó en Google Cloud. Con la llave nueva en Descargas corre npm run sheets:setup y reinicia la app; en Netlify actualiza GOOGLE_PRIVATE_KEY y vuelve a desplegar.";
  }
  if (/short-lived|reasonable timeframe/i.test(m)) {
    return "Google rechazó la llave porque la hora del equipo está desfasada. Activa el ajuste automático de la hora y reinicia la app.";
  }
  if (/DECODER|no start line|PEM routines|asn1|error:1E08010C/i.test(m)) {
    return "La llave privada (GOOGLE_PRIVATE_KEY) está incompleta o mal copiada. Vuelve a correr npm run sheets:setup; en Netlify pega el valor completo de private_key, con las líneas BEGIN y END.";
  }
  if (/SERVICE_DISABLED|has not been used in project|API has not been used|is disabled/i.test(m)) {
    return "La API de Google Sheets no está habilitada en el proyecto de la cuenta de servicio. En Google Cloud: APIs y servicios → Biblioteca → Google Sheets API → Habilitar.";
  }
  if (/\b403\b|PERMISSION_DENIED|does not have permission/i.test(m)) {
    return "La hoja no está compartida con la cuenta de servicio. En la hoja: Compartir → el correo de GOOGLE_CLIENT_EMAIL → Lector.";
  }
  if (/not supported for this document/i.test(m)) {
    return "El archivo es un Excel abierto en Drive, no una hoja de Google. Guárdalo como Hojas de cálculo de Google y usa el ID de la copia.";
  }
  if (/\b404\b|NOT_FOUND|Requested entity was not found/i.test(m)) {
    return "No existe una hoja con el ID de SHEETS_SPREADSHEET_ID. Revisa que sea lo que va entre /d/ y /edit en la URL.";
  }
  if (/Unable to parse range/i.test(m)) {
    return "Una pestaña del mapeo cambió de nombre o se borró. Corre npm run sheets:check para ver cuál.";
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|timeout/i.test(m)) {
    return "No hubo conexión con Google en este momento. Reintenta en unos minutos.";
  }
  return null;
}
