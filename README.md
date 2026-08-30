# ProbaCard

Plataforma de tarjeta de beneficios con chip NFC: validación en caja, panel de administración y carnet digital del cliente.

Cada tarjeta lleva grabada una URL única (`/c/TOKEN`). El servidor decide qué mostrar según quién la abre y en qué estado está la tarjeta: formulario de activación, pantalla de validación para el cajero, o carnet digital para el titular.

---

## Arrancar en local

```bash
cp .env.example .env      # completar PROBACARD_SECRET
npm run seed              # crea data/db.json desde la semilla
npm start                 # http://localhost:3020
```

Sin dependencias externas: Node 22 puro. `npm ci` no instala nada todavía.

**Usuarios de prueba** (clave `demo123`): `pezon`, `botica`, `gym`.
**Tarjetas de prueba:** `AB12XY` y `CD34ZW` válidas, `EF56KL` suspendida, `GH78MN` vencida.

Detalle de las pruebas manuales en [`docs/APP-CAJA.md`](docs/APP-CAJA.md).

```bash
npm test                  # reglas de negocio
```

---

## Estructura

```
server.js              API y estáticos. Sesión por cookie firmada con HMAC.
lib/reglas.js          Reglas de negocio, aisladas para poder probarlas.
data/seed.json         Semilla versionada. data/db.json es la base de trabajo, ignorada.
scripts/seed.js        Regenera la base de trabajo desde la semilla.
test/                  Pruebas de las reglas de negocio.
public/                PWA del cajero: index.html, app.js, sw.js, manifest.json, estilos.css
docs/                  Documentación del sistema.
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/DOCUMENTACION.md`](docs/DOCUMENTACION.md) | Cómo funciona todo el sistema: tarjeta, iOS vs Android, flujos, grabado de chips, datos, legal |
| [`docs/CHECKLIST-DESARROLLO.md`](docs/CHECKLIST-DESARROLLO.md) | Plan de trabajo por fases, esquema de MySQL y despliegue |
| [`docs/APP-CAJA.md`](docs/APP-CAJA.md) | La PWA del cajero: API, decisiones de diseño y cómo probarla |

---

## Estado

| Fase | Estado |
|---|---|
| App de caja (validación, offline, cola de canjes) | Construida y probada |
| Repositorio, pruebas y despliegue | En curso |
| Base de datos MySQL | Pendiente |
| Panel de administración | Pendiente |
| Carnet digital y directorio | Pendiente |

## Despliegue

`main` despliega solo a Plesk por GitHub Actions: corre las pruebas, sube por rsync, reinicia Passenger y verifica `/api/salud`.

Secrets necesarios en el repositorio: `PLESK_HOST`, `PLESK_USER`, `PLESK_SSH_KEY`, `PLESK_PATH`, `URL_PRODUCCION`.

El despliegue nunca pisa `.env`, `uploads/` ni `data/db.json`: viven solo en el servidor.

---

Lucuma Agency
