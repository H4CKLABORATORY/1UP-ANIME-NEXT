# 1UP ANIME NEXT

Repositorio de apoyo para el runner aislado de GitHub Actions de 1UP ANIME 2.37.49.

## Máquina A 2.37.49

Este repositorio contiene únicamente los insumos mínimos para adquirir y verificar las dependencias fijadas por el lockfile:

- `machine-a/2.37.49/package-lock.json.gz.b64`: snapshot comprimido del lockfile, cuya huella se valida antes de usarlo.
- `machine-a/2.37.49/run-machine-a.mjs`: descarga los tarballs públicos de npm, verifica SRI, genera el ZIP y comprueba el sidecar.
- `.github/workflows/machine-a-2.37.49.yml`: ejecución manual en Ubuntu 24.04 con Node.js 22.16.0.

### Ejecutar

1. Abre **Actions**.
2. Selecciona **1UP ANIME 2.37.49 — Máquina A**.
3. Pulsa **Run workflow** en `main`.
4. Selecciona `RUN_MACHINE_A` y confirma.
5. Espera el resultado. Un bundle solo se acepta si el job termina correctamente y el log contiene:
   - `AUDIT: PASS (98/98 ubicaciones, 97/97 archivos)`
   - `VEREDICTO: PASS (98/98 ubicaciones, 97/97 archivos, integridad OK)`
   - `=== MÁQUINA A COMPLETADA (PASS real) ===`
6. Descarga el artefacto de ese run. Contiene ZIP, sidecar SHA-256 y log; retención de 7 días.

### Límites

- Workflow manual únicamente; no se ejecuta en push ni pull requests.
- Permisos: `contents: read`.
- No utiliza secretos ni credenciales npm.
- No ejecuta `npm ci`, no instala la aplicación, no toca SQLite y no modifica el lockfile.
- No copia el proyecto completo, `node_modules` ni caché npm.
- No modifica el repositorio anterior ni producción.
- Este proceso certifica únicamente la descarga y el bundle de dependencias; no certifica build, suite global, Chromium, Playwright, Safari, VoiceOver, RBAC ni producción.

Si el job falla, no existe bundle aceptado. Conserva el log para diagnosticar el error y no declares PASS sin las verificaciones literales.
