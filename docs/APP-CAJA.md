# ProbaCard — PWA de validación en caja (Fase 1)

App que usa el cajero para validar una tarjeta ProbaCard NFC y registrar el canje.
Node puro, sin dependencias npm. Base de datos en `data/db.json`.

## Correr en local

```bash
node server.js          # http://localhost:3020
```

Usuarios demo (clave `demo123` en los tres):

| Usuario | Tienda | Beneficio |
|---|---|---|
| `pezon` | Cevichería El Pez On | 15% en carta (1 uso/día) |
| `botica` | Botica Salud Norte | 10% en genéricos (2 usos/día) |
| `gym` | Gimnasio Fuerza Lima | 20% en mensualidad (1 uso/día) |

Tarjetas demo, para probar los cuatro estados:

| Código | Cliente | DNI | Estado esperado |
|---|---|---|---|
| `AB12XY` | Juan Pérez Ramos | 45879632 | VÁLIDO |
| `CD34ZW` | María Quispe Loayza | 70112233 | VÁLIDO |
| `EF56KL` | Carlos Medina Sáenz | 08123456 | SUSPENDIDA |
| `GH78MN` | Rosa Ttito Huamán | 76543210 | VENCIDA |

Escribe el código a mano o entra a `/c/AB12XY`, que es la URL que va grabada en el chip.

## Qué probar

1. **Canje normal:** login → `AB12XY` → Validar → monto → registrar.
2. **Tope diario:** repite `AB12XY` el mismo día. Debe salir TOPE.
3. **Tarjeta olvidada:** despliega "El cliente olvidó su tarjeta" y busca por DNI `45879632`.
4. **Offline:** DevTools → Network → Offline. Valida `CD34ZW` (responde con el padrón cacheado)
   y registra el canje: queda en cola. Vuelve a Online y se sube solo.
5. **Instalación:** DevTools → Application → Manifest / Service Workers. En Android sale el
   botón "Instalar"; en iPhone hay que usar Compartir → Agregar a inicio.

## Qué hay dentro

```
server.js              API + estáticos. Sesión por cookie firmada con HMAC (30 días).
data/db.json           Tiendas, usuarios, clientes y canjes.
public/index.html      Las 4 pantallas: login, caja, resultado, menú.
public/app.js          Lógica: IndexedDB, cola offline, Web NFC, validación.
public/sw.js           Service worker: caché del armazón, red primero para /api/.
public/manifest.json   Instalación como PWA.
public/estilos.css     Marca Proba (amarillo #FBB900, negro, fondo blanco).
```

## API

| Método y ruta | Para qué |
|---|---|
| `POST /api/login` | Inicia sesión del cajero. Devuelve su tienda. |
| `GET /api/sesion` | ¿Hay sesión viva? |
| `GET /api/sync` | Padrón de tarjetas para el modo offline. |
| `GET /api/validar/:token` | Evalúa la tarjeta contra las reglas de esa tienda. |
| `GET /api/buscar?q=` | Respaldo por DNI o celular. |
| `POST /api/canje` | Registra canjes. Acepta lote (la cola offline) y es idempotente por `idLocal`. |
| `GET /api/canjes` | Últimos 50 canjes de la tienda. |
| `GET /c/:token` | La URL del chip NFC. Redirige a la app con el token. |

## Decisiones de diseño

- **Todo pasa por la URL del chip.** Web NFC solo se activa si el navegador la soporta (Android).
  En iOS el sistema abre la URL y la app funciona igual. Ver sección 3.1 de `../DOCUMENTACION.md`.
- **El canje se guarda en IndexedDB antes de subirlo.** Si el teléfono se apaga o no hay señal,
  no se pierde. El servidor descarta duplicados por `idLocal`.
- **Sesión de 30 días.** Si el cajero tiene que loguearse cada día, deja de usar la app.
- **El servidor manda.** El padrón offline es solo un respaldo; cuando hay red, decide el backend.

## Para producción (pendiente)

- [ ] HTTPS obligatorio (Let's Encrypt en Plesk). El service worker no arranca sin él.
- [ ] Claves hasheadas con `scrypt`, no en texto plano como en la demo.
- [ ] `PROBACARD_SECRET` como variable de entorno real.
- [ ] Migrar `db.json` a MySQL al pasar de ~5 tiendas.
- [ ] Fotos de clientes (hoy `foto: null`, se muestra la inicial).
- [ ] Rate limiting en `/api/login` y `/api/validar`.
- [ ] Panel del dueño de tienda y panel de administración de Lucuma.

## Estados en pantalla

El color ocupa el banner completo para que el cajero decida de reojo. Cada estado dice además qué hacer.

| Estado | Color | Qué ve el cajero |
|---|---|---|
| `VALIDO` | Verde | El beneficio de la tienda |
| `TOPE` | Ámbar | Ya la usó hoy. Cobra sin descuento |
| `DIA_NO_VALIDO` | Ámbar | Hoy no aplica. Cobra sin descuento |
| `SIN_ACTIVAR` | Pizarra | El cliente debe activarla desde su celular |
| `SIN_BENEFICIO` | Pizarra | La tienda no tiene beneficio vigente. Avisar a Proba |
| `VENCIDA` | Rojo | Derivar a Proba para renovar |
| `SUSPENDIDA` | Rojo | No aplicar el descuento |
| `BLOQUEADA` | Rojo | Reportada como perdida |
| `NO_EXISTE` | Rojo | Revisar el código o buscar por DNI |

Los dos estados en pizarra no son errores del cliente ni de la tarjeta: son situaciones que se resuelven fuera de la caja. Por eso no van en rojo, que el cajero asocia a rechazo.

`test/estados.test.js` verifica que la app cubra todos los estados que devuelven las reglas. Si se agrega uno nuevo al servidor y se olvida la interfaz, las pruebas fallan.
