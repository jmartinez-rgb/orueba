# Componentes RareUI adaptados

Adaptados de [RareUI](https://rareui.in) (repositorio `Codewithswappy/rareui`, licencia MIT,
© 2025 Swapnil Kalambe). Cambios: `motion/react` en lugar de `framer-motion`, tokens de color de
la app (modo claro/oscuro), accesibilidad (roles ARIA, foco visible) y respeto a
`prefers-reduced-motion`.

| Componente | Origen RareUI | Uso en la app |
|---|---|---|
| `animated-tabs.tsx` | AnimatedTab | Selectores segmentados (Compare, Monitoreos, Tickets, Guía) |
| `loading-spinner.tsx` | LoadingSpinner | Estados de carga |
| `feature-badge.tsx` | FeatureBadge | Insignias ("Solo lectura", "Nuevo") |
| `avatar-group.tsx` | AvatarGroup | Personas conectadas (con blobatar) |
| `shimmer-button.tsx` | GlassShimmerButton | Botón principal de inicio de sesión |
