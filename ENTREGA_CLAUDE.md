# Entrega para Claude — auditoría final y candidata v1

Preparada el **2 de octubre de 2026, zona America/Bogota**.
Repositorio: `jmartinez-rgb/orueba`. Rama vigente: **`codex/dominios-absolute-top`**.
Base funcional comprobada: **`2c8ca5608de8801af42524ffa0a5ef8a1e5d20ae`**.
Usar el último HEAD publicado de esta rama, incluyendo la entrega documental posterior,
y registrar su hash al empezar. Crear una rama propia; no reescribir las ramas anteriores.

- [Guía vigente de la fase final](media-monitoring-center/docs/ENTREGA_CLAUDE_FASE_FINAL.md): estado, evidencia, prioridades, límites y pendientes.
- [Prompt completo listo para pegar](media-monitoring-center/docs/PROMPT_PARA_CLAUDE.md).
- [Dominios y Absolute Top, informe A–J](media-monitoring-center/docs/DOMINIOS_ABSOLUTE_TOP.md) y [contrato Google v25](unified-ads-api/docs/GOOGLE_ABSOLUTE_TOP.md).
- [Revisión manual del equipo](media-monitoring-center/docs/ENTREGA_CLAUDE_FASE_FINAL.md#revisión-manual-del-equipo-antes-de-aceptar).
- [Base v1 anterior, histórica](media-monitoring-center/docs/ENTREGA_CLAUDE_V1.md): conservar su contexto, sin usar su rama o conteos como actuales.

API: **775 pruebas**; monitoreo: **1217**. CI de la API pasa Node 22 y 24 para la base
funcional. El informe distingue fixtures, UX, ocho lecturas Google reales y aceptación pendiente.
La nueva extracción y conciliación cubren **solo izzi**; conservar Sky y sus permisos.

La publicación confirmada corresponde al **entorno de Codex**. No hay URLs públicas confirmadas
del monitoreo ni de la API. Faltan conciliación independiente y aceptación del alojamiento.
Secretos, contraseñas y datos privados no viajan en Git. No desplegar ni activar envíos/schedulers
para realizar esta auditoría; preparar el resultado y los bloqueos para revisión.

**Resultado de Claude:** rama `claude/auditoria-final-v1`. [Informe de la auditoría final](media-monitoring-center/docs/AUDITORIA_FINAL_V1_2026-10-02.md)
y [checklist de candidata v1](media-monitoring-center/docs/CANDIDATA_V1.md). La v1 no está terminada:
faltan conciliación independiente y aceptación del alojamiento.
