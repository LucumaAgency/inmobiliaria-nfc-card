# ProbaCard

Plataforma de tarjeta de beneficios con chip NFC: validación en caja, panel de administración y carnet digital del cliente.

Cada tarjeta lleva grabada una URL única (`/c/TOKEN`). El servidor decide qué mostrar según quién la abre y en qué estado está la tarjeta: formulario de activación, pantalla de validación para el cajero, o carnet digital para el titular.

---

## Arrancar en local

Requiere **MySQL o MariaDB**.

```bash
mysql -e "CREATE DATABASE probacard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

cp .env.example .env      # completar PROBACARD_SECRET y los datos de la base
npm ci
npm run migrate           # crea el esquema
npm run importar          # carga las tiendas y tarjetas de prueba
node scripts/clave.js admin "una-clave-larga"   # clave del panel
npm start                 # http://localhost:3020
```

- App de caja: `http://localhost:3020`
- Panel de administración: `http://localhost:3020/panel` (usuario `admin`)
- Carnet del titular: `http://localhost:3020/c/AB12XY`
- Directorio de tiendas: `http://localhost:3020/tiendas`

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
lib/reglas.js          Reglas de negocio, aisladas para poder probarlas sin base.
lib/repos.js           Todas las consultas SQL, parametrizadas.
lib/db.js              Pool de MySQL y transacciones.
lib/claves.js          Hash de claves con scrypt.
lib/limite.js          Rate limiting en memoria.
lib/entorno.js         Carga .env sin dependencias.
lib/fechas.js          Fechas en la zona del programa. Nunca usar UTC para "hoy".
lib/rutas-publico.js   Carnet del titular, activación y directorio.
lib/rutas-admin.js     Rutas del panel, separadas de las de caja.
lib/tokens.js          Generación de códigos de tarjeta.
migrations/            Esquema versionado. npm run migrate aplica lo que falte.
grabador/              Grabado de chips con RC522 por USB. Ver grabador/README.md.
public/admin/          Panel de administración.
public/tarjeta/        Carnet del titular y activación.
public/tiendas/        Directorio público de tiendas afiliadas.
scripts/migrar.js      Runner de migraciones, idempotente.
scripts/importar-json.js  Pasa data/seed.json a MySQL.
test/                  21 pruebas de reglas, claves y rate limiting.
public/                PWA del cajero: index.html, app.js, sw.js, manifest.json, estilos.css
docs/                  Documentación del sistema.
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/DOCUMENTACION.md`](docs/DOCUMENTACION.md) | Cómo funciona todo el sistema: tarjeta, iOS vs Android, flujos, grabado de chips, datos, legal |
| [`docs/CHECKLIST-DESARROLLO.md`](docs/CHECKLIST-DESARROLLO.md) | Plan de trabajo por fases, esquema de MySQL y despliegue |
| [`docs/APP-CAJA.md`](docs/APP-CAJA.md) | La PWA del cajero: API, decisiones de diseño y cómo probarla |
| [`grabador/README.md`](grabador/README.md) | Grabado y bloqueo de chips: Web NFC y RC522 |

---

## Estado

| Fase | Estado |
|---|---|
| App de caja (validación, offline, cola de canjes) | Construida y probada |
| Repositorio, pruebas y despliegue | Construido |
| Base de datos MySQL | Construida y probada |
| Panel de administración | Construido y probado |
| Carnet digital y directorio | Construido y probado |

## Despliegue

`main` despliega solo a Plesk por GitHub Actions: corre las pruebas, sube por rsync, instala dependencias, **aplica las migraciones pendientes**, reinicia Passenger y verifica `/api/salud`.

Secrets necesarios en el repositorio: `PLESK_HOST`, `PLESK_USER`, `PLESK_SSH_KEY`, `PLESK_PATH`, `URL_PRODUCCION`.

El despliegue nunca pisa `.env` ni `uploads/`: viven solo en el servidor.

---

Lucuma Agency
