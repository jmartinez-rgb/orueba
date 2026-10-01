/**
 * Vocabulario común de `normalized_conversion`. Todas las plataformas usan estas mismas etiquetas
 * (en mayúsculas) para que sumar o comparar por categoría tenga sentido entre plataformas. Una
 * categoría por omisión es una ayuda de lectura: qué evento cuenta como venta o lead para un
 * cliente es una decisión de negocio que se fija con los mapeos de cada proveedor.
 */
export const CONVERSION_CATEGORIES = [
  "PURCHASE",
  "LEAD",
  "CALL",
  "CONTACT",
  "REGISTRATION",
  "ORDER",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "VIEW_CONTENT",
  "PAGE_VIEW",
] as const;

export type ConversionCategory = (typeof CONVERSION_CATEGORIES)[number];
