# ProbaCard — Checklist de desarrollo

Del prototipo actual (`app/`, Node puro + `db.json`) al sistema en producción sobre Plesk.

**Stack objetivo:** Node 22 + MySQL en Plesk, repo en GitHub, despliegue por GitHub Actions.
**Fecha:** 30 de agosto de 2026

---

## Decisión de base de datos: MySQL, no Mongo

Se usa **MySQL** con phpMyAdmin, no Mongo Atlas.

- Los datos son relacionales de manual: cliente ↔ tarjeta ↔ canje ↔ tienda. Todo son joins.
- Los reportes son agregaciones por tienda y por mes, que es exactamente lo que SQL hace bien.
- Ya está en el Plesk, sin costo extra ni servicio externo del que depender.
- Es el mismo patrón del CRM inmobiliario, así que no se abre un stack nuevo que mantener.

Mongo tendría sentido si el esquema fuera cambiante o los volúmenes enormes. No es el caso: son unas pocas tablas estables y miles de filas, no millones.

---

## Fase 0 — Repositorio y entorno

- [ ] Crear repo `LucumaAgency/probacard` (privado).
- [ ] Mover el prototipo de `app/` al repo, con la estructura definitiva.
- [ ] `.gitignore`: `node_modules`, `.env`, `data/*.json`, `uploads/`.
- [ ] `.env.example` con todas las variables, sin valores reales.
- [ ] `package.json` con `engines.node: "22.x"` y scripts `start`, `dev`, `migrate`, `seed`.
- [ ] README con instrucciones de arranque local.
- [ ] Rama `main` protegida; trabajo en `develop` y ramas de feature.

**Variables de entorno a definir:**

```
PORT
NODE_ENV
DB_HOST / DB_USER / DB_PASS / DB_NAME
PROBACARD_SECRET        # firma de cookies de sesión
URL_BASE                # https://probacard.pe  (queda impresa en las tarjetas)
UPLOADS_DIR             # fotos de clientes
WHATSAPP_TOKEN          # bienvenida y avisos (fase 2)
```

---

## Fase 1 — Base de datos

- [ ] Crear la base en Plesk y su usuario, con permisos solo sobre esa base.
- [ ] Escribir `migrations/001_esquema.sql` y correrlo por phpMyAdmin.
- [ ] Script `seed.js` que cargue las tiendas y tarjetas de prueba.
- [ ] Script de migración que lleve `db.json` a MySQL (sirve para no perder las pruebas).
- [ ] Configurar respaldo diario en Plesk y **probar una restauración** antes del lanzamiento.

### Esquema

```sql
CREATE TABLE tiendas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  rubro         VARCHAR(60),
  direccion     VARCHAR(200),
  lat           DECIMAL(10,7),
  lng           DECIMAL(10,7),
  estado        ENUM('activa','pausada','baja') DEFAULT 'activa',
  creado_en     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Una tienda puede cambiar de beneficio; el historial no se pisa.
CREATE TABLE beneficios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tienda_id     INT NOT NULL,
  descripcion   VARCHAR(160) NOT NULL,
  condiciones   TEXT,
  tope_diario   TINYINT DEFAULT 1,
  monto_minimo  DECIMAL(10,2) DEFAULT 0,
  dias_validos  VARCHAR(20) DEFAULT '1234567',   -- 1=lunes
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  FOREIGN KEY (tienda_id) REFERENCES tiendas(id)
);

CREATE TABLE clientes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  doc           VARCHAR(15) NOT NULL,
  celular       VARCHAR(15),
  correo        VARCHAR(120),
  foto          VARCHAR(200),
  consentimiento_en DATETIME NULL,
  creado_en     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (doc),
  INDEX (celular)
);

-- El token es la identidad de la tarjeta, no del cliente:
-- si se pierde, se emite otra y el historial del cliente sigue.
CREATE TABLE tarjetas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  token         VARCHAR(12) NOT NULL,
  uid_chip      VARCHAR(20) NULL,          -- UID físico, para detectar clones
  lote          VARCHAR(30),
  cliente_id    INT NULL,
  estado        ENUM('en_blanco','activa','suspendida','perdida','vencida') DEFAULT 'en_blanco',
  vence         DATE NULL,
  reemplaza_a   INT NULL,
  emitida_en    DATETIME NULL,
  UNIQUE KEY (token),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  INDEX (estado)
);

CREATE TABLE usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  usuario       VARCHAR(40) NOT NULL,
  clave_hash    VARCHAR(255) NOT NULL,     -- scrypt, nunca texto plano
  rol           ENUM('admin','tienda','caja') NOT NULL,
  tienda_id     INT NULL,
  nombre        VARCHAR(120),
  activo        BOOLEAN DEFAULT TRUE,
  UNIQUE KEY (usuario),
  FOREIGN KEY (tienda_id) REFERENCES tiendas(id)
);

CREATE TABLE canjes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  id_local      CHAR(36) NULL,             -- idempotencia de la cola offline
  cliente_id    INT NOT NULL,
  tarjeta_id    INT NOT NULL,
  tienda_id     INT NOT NULL,
  beneficio_id  INT NOT NULL,
  usuario_id    INT NOT NULL,
  monto         DECIMAL(10,2) DEFAULT 0,
  fecha         DATETIME NOT NULL,
  offline       BOOLEAN DEFAULT FALSE,
  UNIQUE KEY (id_local),
  INDEX (tienda_id, fecha),
  INDEX (cliente_id, fecha)
);

-- Toda validación, termine o no en canje. El ratio entre ambas
-- es el mejor termómetro de salud del programa.
CREATE TABLE validaciones (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  token         VARCHAR(12),
  tienda_id     INT NULL,
  usuario_id    INT NULL,
  resultado     VARCHAR(20),
  offline       BOOLEAN DEFAULT FALSE,
  fecha         DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (tienda_id, fecha)
);
```

---

## Fase 2 — Endurecer el servidor

Lo que hoy está resuelto "a lo demo" y no puede salir así.

- [ ] Reemplazar `db.json` por MySQL con `mysql2/promise` y pool de conexiones.
- [ ] Claves con **scrypt** (`crypto.scrypt`), nunca texto plano. Migrar los usuarios demo.
- [ ] `PROBACARD_SECRET` real desde variable de entorno; que el arranque falle si falta.
- [ ] Cookie de sesión con `Secure` además de `HttpOnly` y `SameSite=Lax`.
- [ ] Rate limiting en `/api/login` (5 intentos por usuario cada 15 min) y en `/api/validar`.
- [ ] Validar y sanear toda entrada; consultas siempre parametrizadas.
- [ ] Registrar en `validaciones` cada consulta, incluidas las que no terminan en canje.
- [ ] Manejo de errores que no filtre trazas al cliente.
- [ ] Logs a archivo con rotación.
- [ ] Endpoint `/api/salud` para monitoreo.

---

## Fase 3 — Despliegue en Plesk

- [ ] Crear el subdominio y activar **Node.js** en Plesk.
- [ ] Definir Application Root, Startup File (`server.js`) y Application Mode `production`.
- [ ] Cargar las variables de entorno en el panel de Node.js de Plesk.
- [ ] Certificado **Let's Encrypt**, con redirección forzada a HTTPS.
  Sin HTTPS el service worker no arranca y la PWA no se instala.
- [ ] Verificar que Passenger sirve bien los estáticos y el `sw.js` sin caché.
- [ ] Probar `/c/TOKEN` con una tarjeta real desde Android y desde iPhone.

### GitHub Actions

- [ ] Secrets del repo: `PLESK_HOST`, `PLESK_USER`, `PLESK_SSH_KEY`, `PLESK_PATH`.
- [ ] Workflow en `main`: instalar dependencias, correr pruebas, subir por rsync, `npm ci --omit=dev` en el servidor y reiniciar.
- [ ] Reinicio de Passenger con `touch tmp/restart.txt`.
- [ ] Excluir del despliegue: `.git`, `node_modules`, `.env`, `uploads`.
- [ ] Que el workflow **no pise** `uploads/` ni el `.env` del servidor.
- [ ] Probar el despliegue completo antes de tener datos reales.

```yaml
# .github/workflows/deploy.yml (esqueleto)
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci && npm test
      - uses: webfactory/ssh-agent@v0.9.0
        with: { ssh-private-key: ${{ secrets.PLESK_SSH_KEY }} }
      - run: |
          rsync -az --delete \
            --exclude '.git' --exclude 'node_modules' \
            --exclude '.env' --exclude 'uploads' \
            ./ ${{ secrets.PLESK_USER }}@${{ secrets.PLESK_HOST }}:${{ secrets.PLESK_PATH }}
          ssh ${{ secrets.PLESK_USER }}@${{ secrets.PLESK_HOST }} \
            "cd ${{ secrets.PLESK_PATH }} && npm ci --omit=dev && mkdir -p tmp && touch tmp/restart.txt"
```

---

## Fase 4 — Panel de administración

Es la pieza que falta para que el sistema sea operable.

**Tarjetas**
- [ ] Generar lote: N tokens aleatorios, CSV para el proveedor de impresión.
- [ ] Listado con filtro por estado y lote.
- [ ] Pantalla **Grabar lote** con Web NFC: escribir la URL, leer de vuelta, verificar y recién bloquear.
- [ ] Bloquear tarjeta y reemitir conservando el historial (`reemplaza_a`).

**Clientes**
- [ ] Alta con foto tomada desde la cámara.
- [ ] Registro del consentimiento con fecha y hora.
- [ ] Vinculación tarjeta ↔ cliente (el *bind*).
- [ ] Búsqueda, edición y ficha con historial de canjes.

**Tiendas**
- [ ] Alta de tienda con dirección y coordenadas.
- [ ] Beneficio con condiciones, tope, monto mínimo y días válidos.
- [ ] Cambio de beneficio que cierra el anterior en vez de pisarlo.
- [ ] Usuarios de caja, uno por sucursal.

**Reportes**
- [ ] Canjes por día, tienda y rubro.
- [ ] Ticket promedio y monto total por tienda.
- [ ] Ratio validaciones / canjes por tienda.
- [ ] Clientes activos vs dormidos.
- [ ] Tarjetas emitidas vs activadas.
- [ ] Exportar a CSV.

---

## Fase 5 — Carnet digital y directorio

- [ ] `/c/TOKEN` sin sesión de cajero muestra el carnet del cliente.
- [ ] Carnet: foto, estado, vencimiento y cuánto ha ahorrado.
- [ ] Datos sensibles solo tras verificación por SMS.
- [ ] Botón de reportar tarjeta perdida, que bloquea el token al instante.
- [ ] Directorio público de tiendas con mapa y filtro por rubro.
- [ ] Formulario de autoactivación para tarjetas `en_blanco`.

---

## Fase 6 — Pruebas

- [ ] Pruebas de las reglas de negocio: tope diario, vencimiento, días válidos, monto mínimo.
- [ ] Prueba de idempotencia de la cola (mismo `id_local` dos veces).
- [ ] Prueba de canje offline y su sincronización posterior.
- [ ] Prueba de canje offline **rechazado** al sincronizar (tarjeta suspendida entre medio).
- [ ] Prueba en dispositivos reales: Android con NFC, iPhone XS o superior, iPad con QR.
- [ ] Lighthouse: auditoría de PWA en verde.
- [ ] Prueba de carga básica: 50 validaciones por minuto.
- [ ] Prueba de restauración del respaldo.

---

## Fase 7 — Antes del lanzamiento

- [ ] Registrar el banco de datos ante la ANPD (Ley 29733).
- [ ] Política de privacidad y términos publicados.
- [ ] Contrato de encargo de tratamiento firmado con cada tienda del piloto.
- [ ] Textos de consentimiento revisados.
- [ ] Video y PDF instructivo de la app de caja.
- [ ] Capacitación a los cajeros del piloto.
- [ ] Canal de WhatsApp de soporte operativo.
- [ ] Google Analytics en directorio y carnet.
- [ ] Primer lote de tarjetas impreso, grabado y verificado.

---

## Orden sugerido

1. **Fases 0, 1 y 2** — repo, MySQL y endurecimiento. Sin esto no hay nada que desplegar.
2. **Fase 3** — despliegue temprano, aunque el panel no exista. Desplegar al final siempre sale mal.
3. **Fase 4** — el panel, que es lo que permite operar de verdad.
4. **Fase 5** — carnet y directorio.
5. **Fases 6 y 7** — pruebas y requisitos legales, en paralelo con la producción de tarjetas.

Regla: **desplegar desde el primer día y desplegar seguido.** El despliegue que se deja para el final es el que descubre que Passenger no sirve el `sw.js` como debe, y eso se descubre a una semana del lanzamiento.

---

## Pendientes de definición

- [ ] Dominio definitivo. Queda impreso en cada tarjeta y no se puede cambiar después.
- [ ] Proveedor de impresión y si graba los chips o se graban internamente.
- [ ] Si se compra el lector USB ACR122U para el grabado.
- [ ] Proveedor de WhatsApp para los avisos automáticos.
- [ ] Vigencia de las tarjetas: uno o dos años.
