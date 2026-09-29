# Sistema de diseño · izzi Media Monitoring Center

Dirección: tablero tipo Apple (v26/27, *Liquid Glass*). Calmado, preciso y primero el dato. La
navegación y los controles flotan en vidrio; el contenido vive en superficies sólidas.

## Principios

- **Primero el dato.** Números grandes en semibold con tracking negativo y cifras tabulares. Las
  etiquetas son pequeñas, secundarias y en minúsculas de oración (nada de MAYÚSCULAS con tracking).
- **Un solo acento por marca.** izzi usa teal y Sky azul; cambia con el botón izzi | Sky. El color de
  estado es solo para estado y siempre va con ícono y texto.
- **Profundidad declarada una vez.** En claro, sombra suave sin borde; en oscuro, un filo de 1 px sin
  sombra.
- **Movimiento solo para estado.** Respuesta inmediata al presionar, curvas de salida fuertes y
  150 a 250 ms. Nada de animaciones decorativas en bucle.

## Tokens (src/app/globals.css)

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--background` | `#f5f5f7` | `#0b0b0d` | Fondo, con luz ambiental tenue del color de la marca |
| `--card` | `#ffffff` | `#161618` | Superficies de contenido |
| `--foreground` / `--muted-foreground` | `#1d1d1f` / `#6e6e73` | `#f5f5f7` / `#98989f` | Texto (AA) |
| `--primary` | izzi `#007a73` · Sky `#0a66d8` | izzi `#00c1b5` · Sky `#6aa3ff` | Acento de marca |
| `--status-*` | verde `#34c759`, amarillo `#ffcc00`, naranja `#ff9500`, rojo `#ff3b30` | variantes oscuras del sistema | Relleno de estado |
| `--status-*-text` | `#1e7b34`, `#8a5200`, `#c93400`, `#d70015` | `#30d158`, `#ffd60a`, `#ff9f0a`, `#ff6961` | Texto de estado (AA) |
| `--shadow-card`, `--shadow-pop`, `--shadow-control` | sombras suaves | filos de 1 px | Profundidad |
| `--ease-out`, `--ease-in-out`, `--ease-drawer` | `cubic-bezier(0.23,1,0.32,1)`, `(0.77,0,0.175,1)`, `(0.32,0.72,0,1)` | igual | Movimiento |

Radios: controles 10 px, tarjetas 16 px, paneles flotantes y diálogos 22 px (esquinas concéntricas).
Tipografía: SF Pro en equipos Apple e Inter (autoalojada) en los demás.

## Utilidades

- `surface`: tarjeta de contenido (fondo, radio 16 px, profundidad del tema).
- `glass` / `glass-control`: vidrio para la barra lateral, la barra superior y los controles flotantes.
  Con `prefers-reduced-transparency` se vuelven sólidos.
- `pressable`: escala 0.97 al presionar, en 160 ms.
- `label-sm`: etiqueta de dato de 12 px, secundaria.
- Superficies agrupadas (franja de datos del Overview, KPIs): celdas `bg-card` separadas por un filo
  (`gap-px` sobre `bg-(--hairline)`).

## Componentes

- **Estado:** pastillas redondas con ícono y texto (`SeverityBadge`, `DataStateBadge`); puntos de 8 px
  en listas.
- **Tarjeta de plataforma:** sin barras de color laterales ni franjas; el estado va en la pastilla y el
  problema principal en una línea tintada.
- **Tablas:** encabezados de 12 px en minúsculas de oración, filas con filo fino y hover tenue.
- **Menús:** resaltado con el acento (estilo macOS), aparición de 150 ms desde el origen del disparador.
- **Alerta crítica:** diálogo de 22 px sobre un velo desenfocado, con glifo rojo y sin franja de color.

## Accesibilidad

Contraste AA en texto y estados. Foco visible con el acento. Respeta `prefers-reduced-motion`,
`prefers-reduced-transparency` y `prefers-contrast`.
