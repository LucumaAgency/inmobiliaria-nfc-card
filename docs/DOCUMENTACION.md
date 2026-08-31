# ProbaCard NFC — Documentación del flujo

Programa de tarjeta de descuentos para clientes, con chip NFC y red de tiendas afiliadas que validan la tarjeta desde una app.

**Fecha:** 30 de agosto de 2026
**Estado:** exploración / definición

---

## 1. La tarjeta física (NFC)

- **Tipo de chip:** NTAG213/215/216 es lo estándar y barato (~USD 0.30–1 c/u en volumen). NTAG213 (144 bytes) alcanza de sobra si solo guardas un ID o una URL.
- **Qué se escribe en el chip:** NO guardar datos del cliente. Solo un identificador opaco (UUID aleatorio o token firmado) o una URL tipo `https://tarjeta.tudominio.com/c/AB12XY`. El chip es de lectura pública: cualquiera con un celular puede leerlo.
- **Bloqueo:** usar la protección de escritura (lock) del NTAG. Si no se bloquea, cualquier cliente puede reescribir su tarjeta.
- **Clonación:** un NTAG normal se clona en 30 segundos. Si el fraude preocupa, evaluar **NTAG 424 DNA**, que genera un código dinámico (SUN/mirror) en cada lectura validado por el servidor. Cuesta más (~USD 1.5–3) pero es la única forma real de evitar clonación.
- **Fallback obligatorio:** imprimir también un QR y un código alfanumérico corto. iPhones viejos, Android con NFC apagado, tarjetas dañadas. Sin fallback, entre el 15% y 20% de las lecturas fallan y el negocio queda mal parado.
- **Impresión:** PVC 0.76 mm. El chip a veces marca relieve; pedir muestra antes de mandar el lote.

## 2. El backend (el corazón del sistema)

- Base de datos con: cliente, tarjeta (una tarjeta puede reemplazarse y el cliente sigue), estado (activa / suspendida / perdida), fecha de vencimiento.
- **Endpoint de validación:** recibe el token de la tarjeta más el ID de la tienda y responde vigente / no vigente, nombre, foto y qué descuento aplica en esa tienda.
- **Registro de cada canje:** fecha, hora, tienda, monto de la compra, descuento aplicado. Esto es lo que después se vende como valor a las tiendas afiliadas.
- **Reglas por tienda:** no todas dan lo mismo. Se necesita una tabla tienda × beneficio × condiciones (tope de usos, días válidos, monto mínimo, exclusión de promociones).
- **Antifraude básico:** límite de canjes por día, alerta si la misma tarjeta se usa en dos ciudades con minutos de diferencia, y foto del titular en pantalla para que el cajero compare.

## 3. La app de la tienda

- **Modo offline:** las tiendas tienen internet malo. Hace falta caché local de tarjetas válidas y cola de canjes que se suben al recuperar señal. Sin eso, el día que se cae el wifi el sistema no existe.
- Flujo del cajero en 3 toques máximo: escanear, ver "VÁLIDO / Juan Pérez / 15% dcto", confirmar monto. Si se le pide más, no lo usa.
- **PWA vs app nativa:** en Android, una PWA con Web NFC funciona; en iOS, Web NFC no existe, así que haría falta app nativa o depender del QR. La opción más pragmática: **PWA con QR más lectura NFC nativa del iPhone vía URL** (el iPhone lee un NTAG con URL y abre el navegador sin necesidad de app). Ese camino ahorra desarrollar nativo.
- Usuarios por tienda, no una cuenta compartida, para saber qué sucursal y qué cajero canjeó.
- Panel para el dueño de la tienda: cuántos canjes y cuánto facturó por el programa.

## 3.1 iOS vs Android: cómo lee cada uno la tarjeta

El problema no es "NFC sí o no", es **quién puede leer qué**. Hay dos formas distintas de leer una tarjeta NFC y los dos sistemas se comportan muy diferente en cada una.

### Forma A: lectura por el sistema operativo (sin app propia)

La tarjeta lleva grabado un registro NDEF de tipo URL. Se acerca el teléfono, el sistema lee la URL y abre el navegador. La app propia no participa.

- **iOS:** funciona desde iPhone XS / XR en adelante (iOS 13+), con la pantalla encendida y desbloqueada. Aparece una notificación tipo banner que el usuario debe tocar para abrir el link. Es un toque extra, pero funciona sin instalar nada. Ojo: iPhone 7 y 8 tienen NFC pero **no** hacen background reading; necesitan dispararlo desde el Centro de Control o desde una app.
- **Android:** funciona desde hace años en prácticamente todo equipo con NFC. Abre el navegador directo, sin banner intermedio.

Esta es la vía que sobrevive en ambos mundos.

### Forma B: lectura desde dentro de la web (Web NFC)

La API `NDEFReader` en JavaScript, que permite que la PWA escanee sin salir de la pantalla.

- **Android:** funciona en Chrome/Edge. Requiere HTTPS y un gesto del usuario. Es la mejor experiencia: el cajero está en la pantalla de cobro, acerca la tarjeta y el resultado aparece ahí mismo.
- **iOS:** **no existe.** Safari no implementa Web NFC y no hay señales de que vaya a hacerlo. Ningún navegador en iOS puede, porque todos usan el motor de Safari. La única salida en iOS es una app nativa con Core NFC, que además exige un entitlement de Apple y publicar en la App Store.

### Qué significa para el diseño de ProbaCard

El punto crítico: **el flujo del cajero no puede depender de Web NFC**, porque si esa tienda usa un iPad o un iPhone, se cae.

Arquitectura recomendada — **todo pasa por la URL**. La tarjeta lleva `https://probacard.tudominio.com/c/AB12XY`. Esa URL es una página web que:

1. Si el cajero ya tiene sesión iniciada en su navegador, muestra directo la pantalla de validación con nombre, foto y descuento aplicable.
2. Si no hay sesión, pide login.

Así el flujo es idéntico en Android y iOS y no depende de ninguna API especial. El sistema operativo abre la URL, la web hace el resto.

Mejoras opcionales encima de eso:

- En Android, si se detecta `NDEFReader` disponible, se activa el escaneo dentro de la PWA. Cajero más rápido, misma web.
- El QR impreso apunta a **la misma URL**. Cero código adicional, y resuelve el iPhone 7, el NFC apagado y la tarjeta rota.

### La trampa a evitar

Que el cajero tenga que abrir el navegador, buscar la pestaña e iniciar sesión cada vez. La sesión tiene que durar semanas (cookie larga, o mejor: la PWA instalada en la pantalla de inicio con sesión persistente). Si el cajero hace login cinco veces al día, deja de usarlo en una semana y el programa muere ahí, no en el chip.

Si más adelante se pasa a NTAG 424 DNA por el tema de clonación: funciona igual en ambos sistemas, porque el chip solo cambia los parámetros de la URL en cada lectura. No necesita app.

### Resumen para decidir

| | iOS | Android |
|---|---|---|
| NFC abre URL solo | Sí (XS+, con un toque en el banner) | Sí, directo |
| Web NFC en la PWA | No, nunca | Sí, en Chrome |
| QR como respaldo | Sí | Sí |

Via única viable en ambos: **URL en el chip + web con sesión + QR de respaldo**. Web NFC solo como mejora en Android.

### Qué es una PWA

PWA significa *Progressive Web App*: una **página web normal** que cumple tres requisitos técnicos y por eso el teléfono la trata casi como si fuera una app instalada.

Los tres requisitos:

1. **HTTPS** (obligatorio).
2. Un **manifest.json**: un archivo chico que declara nombre, icono, color y cómo debe abrirse.
3. Un **service worker**: un script que corre en segundo plano y guarda archivos y datos en el teléfono, lo que permite que funcione sin internet.

Lo que gana frente a una web común:

- Se instala en la pantalla de inicio con su propio ícono, sin pasar por App Store ni Play Store.
- Se abre a pantalla completa, sin barra del navegador. El cajero no la distingue de una app.
- **Funciona offline** gracias al service worker: cachea las tarjetas válidas y encola los canjes hasta que vuelva la señal.
- Se actualiza sola. Se sube el cambio al servidor y todas las tiendas lo tienen; no hay que esperar aprobación de Apple ni que nadie actualice nada.
- Un solo código para Android, iOS, tablet y PC.

Lo que **no** puede hacer en iOS (limitaciones de Apple):

- Web NFC (por eso el diseño se apoya en la URL y el QR).
- Notificaciones push solo desde iOS 16.4 en adelante, y únicamente si el usuario la instaló en la pantalla de inicio.
- El almacenamiento se puede borrar si la PWA no se usa por varias semanas. Por eso los datos críticos nunca viven solo en el teléfono.

Para ProbaCard es la elección correcta: cubre las dos plataformas con un solo desarrollo, da el modo offline que las tiendas necesitan y evita el costo y la fricción de publicar apps nativas.

## 3.2 Flujos del cliente

Aclaración importante: **el teléfono del cliente no participa en el canje.** El cliente no escanea nada; entrega o acerca su tarjeta física al teléfono del cajero. Si tiene iPhone, Android o un equipo sin NFC da exactamente igual, porque quien lee es el dispositivo de la tienda.

### Flujo A: canje en caja (el principal)

1. El cliente compra, llega a caja y menciona que tiene ProbaCard.
2. Saca la tarjeta y la apoya sobre el celular del cajero, o se la entrega.
3. El celular **del cajero** lee el NFC, abre la URL y la web muestra: `VÁLIDO · Juan Pérez · [foto] · 15% dcto`.
4. El cajero compara la foto, aplica el descuento, digita el monto y confirma.
5. El sistema registra el canje.

Total: unos 10 segundos. El cliente solo estira la mano.

### Flujo B: activación de la tarjeta

Aquí sí entra el teléfono del cliente. Se le entrega la tarjeta, la acerca a su propio equipo (iPhone XS o más nuevo, o cualquier Android con NFC), sale el banner, toca y llega a una página donde completa sus datos y acepta los términos.

Si su iPhone es viejo o no le aparece el banner, escanea el **QR impreso** con la cámara y llega a la misma página. Por eso el QR no es opcional.

### Flujo C: el cliente olvidó la tarjeta

Pasa cerca del 30% de las veces y es la principal causa de que estos programas se caigan. Sin una solución, el piloto arroja métricas falsamente malas.

Opciones, en orden de recomendación:

1. **Búsqueda por DNI o celular** en la app del cajero. La más simple; es la que se implementa en Fase 1.
2. **Tarjeta en Apple Wallet / Google Wallet:** un pass con código de barras que el cliente muestra en pantalla. En iPhone es la experiencia premium: se guarda solo y aparece en la pantalla bloqueada. Requiere cuenta de desarrollador de Apple (USD 99/año) y desarrollo del pass. Candidato para Fase 2.
3. **PWA del cliente con su QR en pantalla.** Más barata que Wallet, pero tiene que abrirla y buscarla, que es justo la fricción que Wallet elimina.

### Flujo D: consulta del directorio e historial

Web pública con el mapa de tiendas afiliadas ("¿dónde puedo usar esto?") y, opcionalmente, historial de cuánto ahorró y dónde compró. Cualquier teléfono, cualquier navegador.

### Lo que NO va a funcionar

Que el cliente use el NFC de **su** iPhone para identificarse acercándolo al teléfono del cajero. iOS no permite emular tarjetas NFC fuera de Apple Pay: teléfono contra teléfono no es un camino disponible.

Por eso la tarjeta física manda, y el respaldo es DNI o Wallet, nunca el NFC del cliente.

## 3.3 Flujo completo: de la fábrica a la caja

### Etapa 1 — Fabricación: tarjetas pre-grabadas y anónimas

Decisión que define todo lo demás: **el chip se graba una vez, en fábrica, y nunca más se toca.**

Se le entrega al proveedor un CSV con N tokens aleatorios (nunca correlativos, porque los correlativos se adivinan) y él graba, bloquea el chip e imprime en cada tarjeta el QR con la misma URL y el código legible.

```
Tarjeta #1  ->  https://probacard.pe/c/AB12XY
Tarjeta #2  ->  https://probacard.pe/c/K9P2QR
Tarjeta #3  ->  https://probacard.pe/c/M4T7WZ
```

Las tarjetas llegan con estado `en_blanco`: no pertenecen a nadie. Si alguien se roba una, no sirve para nada.

La alternativa (grabar el chip cuando llega el cliente) obliga a tener un equipo con NFC en cada punto de entrega y a que alguien sepa hacerlo; si se equivoca, la tarjeta se pierde. Ver 3.4 para el procedimiento de grabado propio cuando el proveedor no ofrece el servicio.

### Etapa 2 — Entrega y activación

**Camino A: activación asistida (recomendado para el piloto).** El vendedor abre el panel en su celular, sección "Emitir tarjeta":

1. Toma la tarjeta física del fajo.
2. La acerca a su celular o escanea el QR. El panel lee `AB12XY` y responde: "Tarjeta en blanco, disponible".
3. Llena el formulario: nombre, DNI, celular, correo, fecha de nacimiento.
4. Toma la foto del cliente con la cámara.
5. El cliente firma el consentimiento de datos en pantalla.
6. Emitir.

El servidor hace el *bind*: la tarjeta pasa de `en_blanco` a `activa` y queda ligada al cliente. Se envía SMS o WhatsApp de bienvenida con el link al directorio de tiendas.

Ventaja: la tarjeta sale funcionando de la mano del vendedor y la foto queda bien tomada, que es clave para que el cajero pueda comparar.

**Camino B: autoactivación.** Se entrega la tarjeta apagada; el cliente la acerca a su teléfono o escanea el QR, cae en `/c/AB12XY` y, como está `en_blanco`, ve el formulario de registro. Verifica su celular por SMS, sube una selfie y acepta términos.

Ventaja: cero trabajo. Desventaja: **entre 30% y 50% nunca la activa.** Si se usa, hacen falta recordatorios automáticos a los 2 y 7 días.

**Una sola URL, tres comportamientos.** El servidor decide qué mostrar según quién abre y en qué estado está la tarjeta:

| Quién abre `/c/AB12XY` | Estado tarjeta | Qué ve |
|---|---|---|
| Cualquiera | `en_blanco` | Formulario de activación |
| Cajero con sesión | `activa` | Pantalla de validación |
| Cliente sin sesión | `activa` | Su carnet digital |

Por eso no hacen falta apps distintas.

### Etapa 3 — En la tienda

El cliente saca la tarjeta y la apoya sobre el celular del cajero. Su propio teléfono no participa.

**Tienda con Android (mejor experiencia).** El cajero tiene la PWA abierta, toca "Acercar tarjeta (NFC)", el botón cambia a "Listo: acerca la tarjeta" y la app queda escuchando. El cliente apoya la tarjeta y el resultado aparece en la misma pantalla, sin cambiar de app. Esto es Web NFC (`NDEFReader`).

**Tienda con iPhone (XS o más nuevo).** El cliente apoya la tarjeta con la pantalla encendida y desbloqueada. iOS muestra un banner arriba con "probacard.pe"; el cajero lo toca y se abre la app en la pantalla de resultado con el cliente cargado. Un toque extra frente a Android, nada más.

**iPad, iPhone viejo, o el NFC no engancha.** El cajero escanea el QR impreso con la cámara o digita el código en el campo grande de la pantalla de caja.

**Desde la validación en adelante, Android e iOS ven exactamente lo mismo**, porque es la misma web:

```
┌──────────────────────────────┐
│  ✓                           │
│  VÁLIDO                      │  <- banner verde a pantalla completa
│  15% en carta                │
├──────────────────────────────┤
│  [foto]  Juan Pérez Ramos    │
│          DNI 45879632        │
│                              │
│  Compara la foto y el        │
│  documento con la persona.   │
│                              │
│  Monto de la compra (S/)     │
│  [ 85.50            ]        │
│                              │
│  [ Aplicar y registrar ]     │
└──────────────────────────────┘
```

Nueve estados posibles. El color a pantalla completa es deliberado: el cajero decide de reojo, sin leer. Cada uno dice además qué hacer.

| Estado | Color | Qué hace el cajero |
|---|---|---|
| VÁLIDO | Verde | Aplica el descuento |
| YA LA USÓ HOY | Ámbar | Cobra sin descuento; el tope diario está alcanzado |
| HOY NO APLICA | Ámbar | El beneficio no corre este día de la semana |
| SIN ACTIVAR | Pizarra | El cliente debe activarla desde su celular |
| SIN BENEFICIO | Pizarra | La tienda no tiene beneficio vigente; avisar a Proba |
| VENCIDA | Rojo | Derivar a Proba para renovar |
| SUSPENDIDA | Rojo | No aplicar el descuento |
| BLOQUEADA | Rojo | Fue reportada como perdida |
| NO REGISTRADA | Rojo | Revisar el código o buscar por DNI |

**Los dos estados en pizarra no son rechazos.** La tarjeta está bien y el cliente no hizo nada mal: son situaciones que se resuelven fuera de la caja, y en el caso de SIN BENEFICIO el problema es de configuración, no del cliente. Si fueran rojos, el cajero los leería como "tarjeta mala" y trataría mal a quien no tiene la culpa.

**Olvidó la tarjeta:** se despliega "El cliente olvidó su tarjeta", se escribe el DNI, sale la lista y se toca al cliente. El flujo sigue igual.

**Sin internet:** la app valida contra el padrón descargado, muestra "Validado sin conexión" y guarda el canje en cola. Al volver la señal se sube solo; si el servidor lo rechaza (por ejemplo, la tarjeta fue suspendida ayer), la app avisa al cajero.

### Etapa 4 — Si el cliente escanea su propia tarjeta

Va a pasar seguido: la gente prueba su tarjeta por curiosidad. Como no tiene sesión de cajero, ve su **carnet digital**:

```
┌──────────────────────────────┐
│   ProbaCard                  │
│   [foto]                     │
│   Juan Pérez Ramos           │
│   Socio desde ago 2026       │
│   Vence: ago 2027   ● ACTIVA │
├──────────────────────────────┤
│   Has ahorrado S/ 342.80     │
│   en 14 visitas              │
├──────────────────────────────┤
│   [ Ver tiendas afiliadas ]  │
│   [ Mi historial ]           │
│   [ Reportar tarjeta perdida]│
└──────────────────────────────┘
```

Tres reglas:

- **Nunca mostrar datos sensibles sin verificar.** Cualquiera que encuentre la tarjeta puede abrir esa URL. Nombre y estado sí; para el historial completo, verificación por SMS.
- **"Cuánto has ahorrado" es la mejor herramienta de retención.** Un número concreto en soles hace que el cliente renueve y que le cuente a otros.
- **"Reportar tarjeta perdida" ahí mismo**, que bloquea el token al instante. Es la razón por la que el token es opaco y reemplazable: se emite otra tarjeta, mismo cliente, mismo historial.

### Etapa 5 — Los paneles

Son tres, con permisos distintos.

**Panel de ProbaCard (interno).**
- Tarjetas: lote, estado (en blanco / activa / suspendida / perdida / vencida), a quién está ligada; bloquear y reemitir.
- Clientes: alta, edición, foto, historial, exportar.
- Tiendas: alta, beneficio, condiciones, tope diario, días válidos, monto mínimo.
- Usuarios de caja: uno por sucursal, nunca cuentas compartidas.
- Reportes: canjes por día, tienda y rubro; ticket promedio; clientes activos vs dormidos; tarjetas emitidas vs activadas.
- Auditoría: quién canjeó qué y cuándo, con alertas de uso raro.

**Panel del dueño de tienda.** Solo lo suyo: canjes del mes, ticket promedio con y sin ProbaCard, clientes nuevos que trajo el programa. **Es el argumento de venta**: sin él, la tienda no sabe si el programa le sirve y no renueva.

**Vista del cajero.** La PWA de `app/`. No ve reportes ni datos de otras tiendas.

### Etapa 6 — Qué información se recolecta

| Momento | Qué se captura | Dónde queda |
|---|---|---|
| Fabricación | Token, lote, fecha | Tabla `tarjetas`, estado `en_blanco` |
| Activación | Nombre, DNI, celular, correo, foto, consentimiento con fecha y hora | Tabla `clientes` + bind a la tarjeta |
| Validación en caja | Token, tienda, cajero, resultado, si fue offline | Log de consultas |
| Canje | Cliente, tienda, cajero, monto, beneficio, fecha y hora, offline sí/no | Tabla `canjes` |
| Sincronización | Cuándo bajó el padrón cada dispositivo | Metadata por dispositivo |
| Pérdida o reemplazo | Token viejo, token nuevo, motivo | Historial de la tarjeta |

Dos cosas que no hay que olvidar:

- **Registrar también las validaciones que no terminaron en canje.** Si una tienda valida 200 tarjetas y registra 40 canjes, algo pasa: el cajero no cierra el flujo, está probando el sistema, o hay fraude. Ese ratio es el mejor semáforo de salud del programa.
- **Pedir siempre el monto de la compra.** Sin monto no se le puede decir a la tienda cuánto facturó por el programa, y sin eso no hay con qué venderle la renovación.

### Las cuatro ideas que sostienen el sistema

1. El chip se graba una vez, en fábrica, y nunca más. Todo lo demás es servidor.
2. La tarjeta es anónima hasta que se activa. Robarla en blanco no sirve de nada.
3. Una sola URL que se comporta distinto según quién la abra y en qué estado esté la tarjeta.
4. Android e iOS solo se diferencian en el primer toque. De la validación en adelante es la misma pantalla.

## 3.4 Grabado y protección de las tarjetas

Casi ningún proveedor local ofrece grabado personalizado, y los que lo hacen cobran caro y se equivocan. Conviene hacerlo internamente.

### Quién toca qué

La contraseña o el bloqueo se aplican **una sola vez, en la mesa de grabado**. No son parte del flujo de uso diario.

| Actor | ¿Toca la protección del chip? |
|---|---|
| Quien graba el lote (Lucuma / ProbaCard) | **Sí.** La configura al grabar cada tarjeta |
| La empresa ProbaCard | Solo si graba lotes propios. Custodia la clave, no la usa a diario |
| Las tiendas afiliadas | **No.** Solo leen |
| Los clientes con tarjeta | **No.** Ni saben que existe |

Es la llave de la fábrica, no la llave que se le entrega al cliente.

### Opción A — Bloqueo permanente (recomendado para Fase 1)

`makeReadOnly()` quema físicamente unos bits del chip y lo deja de solo lectura para siempre.

Se hace desde el panel con Web NFC en Android, sin apps ni compras:

```js
const lector = new NDEFReader();
await lector.write({
  records: [{ recordType: "url", data: "https://probacard.pe/c/AB12XY" }]
});
await lector.makeReadOnly();   // irreversible
```

**Procedimiento obligatorio, en este orden:**

1. Escribir la URL.
2. **Leer de vuelta y verificar** que quedó exactamente bien.
3. Recién entonces bloquear.

Es irreversible: si la URL quedó mal, esa tarjeta es basura. Ritmo real: 3 a 4 segundos por tarjeta; un lote de 500 son unos 30 minutos.

### Opción B — Contraseña (alternativa, para más adelante)

Los NTAG21x tienen páginas de configuración que casi nadie usa:

- **PWD**: 4 bytes, la contraseña.
- **PACK**: 2 bytes, la respuesta del chip cuando la contraseña es correcta.
- **AUTH0**: desde qué página empieza la protección.
- **PROT**: protege solo escritura, o lectura y escritura.
- **AUTHLIM**: intentos fallidos permitidos.

Configuración para este caso: `PROT = 0` (protege escritura, la lectura queda libre, que es justo lo que se necesita: cualquier teléfono debe poder leer la URL, nadie debe poder cambiarla) y `AUTHLIM = 7`, lo que impide la fuerza bruta y hace que 4 bytes basten.

**Contraseña derivada por tarjeta, no única.** Se guarda **una** clave maestra en el servidor y la contraseña de cada tarjeta se calcula desde el UID del chip, que es único:

```js
// La clave maestra vive solo en el servidor, nunca en la app de grabado
const pwd = crypto.createHmac('sha256', CLAVE_MAESTRA)
                  .update(uidDeLaTarjeta)
                  .digest()
                  .subarray(0, 4);   // los 4 bytes que acepta el chip
```

Si se filtra la contraseña de una tarjeta, no sirve para ninguna otra. Y no hay que almacenar 1.000 contraseñas: se recalculan cuando hacen falta. Esto se llama *diversificación de claves* y es lo que usan los sistemas de transporte y hotelería.

| | Bloqueo permanente | Contraseña |
|---|---|---|
| Reversible | No, nunca | Sí, con la clave |
| Si la URL quedó mal | Tarjeta perdida | Se reescribe |
| Evita edición por terceros | Sí | Sí |
| Reutilizar tarjeta devuelta | No | Sí |
| Se puede hacer con Web NFC | Sí | **No**, requiere app nativa o lector USB |

**Limitación importante:** Web NFC solo escribe y lee mensajes NDEF; no da acceso a las páginas de configuración del chip. Para poner contraseña hace falta NFC Tools Pro (manual, contraseña única), una app Android nativa (`NfcA` con comandos crudos) o un lector USB.

### Alternativa: grabar sin Android (equipo con iPhone)

Web NFC no existe en iOS, así que la pantalla "Grabar lote" del panel no funciona desde un iPhone. Alternativas, de mejor a peor:

**1. Lector USB en la computadora (recomendado para producción).** Un ACR122U (~USD 35) o ACR1252U (~USD 50, más estable) conectado por USB a Mac o PC, y un script que graba:

```js
// Node, con la librería nfc-pcsc
reader.on('card', async card => {
  const token = await siguienteToken();          // lo pide al servidor
  await reader.write(4, urlComoNDEF(token));     // escribe la URL
  const check = await reader.read(4, 48);        // lee de vuelta y verifica
  if (!verificar(check, token)) return alarma();
  await ponerPassword(card.uid);                 // comandos crudos: sí se puede
  await confirmarGrabado(token, card.uid);
});
```

Ventajas sobre el celular: más rápido (se apoya la tarjeta en el lector sobre la mesa, 1 a 2 segundos), **sí permite poner contraseña** porque da acceso a comandos crudos, funciona igual en Mac, Windows y Linux, y registra el UID físico de cada tarjeta, útil para detectar clones. Un celular sirve para 20 tarjetas; un lector USB para 5.000.

**2. Android prestado con el panel web.** Gratis, escribe y bloquea, pero no pone contraseña. Sirve para lotes chicos.

**3. NFC Tools en iPhone.** Escribe URLs en NTAG (iOS puede escribir NDEF desde iOS 13). El soporte para **bloquear** es irregular según versión de app y chip: verificar con una tarjeta de sacrificio antes de procesar un lote. Contraseña, no. Sirve para las primeras 5 tarjetas de prueba, no para producir.

**4. App iOS propia con Core NFC.** Técnicamente puede todo, incluida la contraseña, pero exige cuenta de desarrollador de Apple (USD 99/año), una Mac con Xcode y solicitar el entitlement de NFC. Para grabar tarjetas en oficina propia, no se justifica.

| Camino | Costo | Escribe | Bloquea | Contraseña | Para qué sirve |
|---|---|---|---|---|---|
| Lector USB ACR122U | USD 35 | Sí | Sí | Sí | **Producción real** |
| Android + panel web | S/ 0 | Sí | Sí | No | Lotes chicos |
| NFC Tools en iPhone | S/ 0 | Sí | Dudoso | No | Primeras pruebas |
| App iOS propia | USD 99/año + Mac | Sí | Sí | Sí | No se justifica |

**El grabado es un problema de oficina, no del producto.** La app del cajero y la PWA funcionan idénticas en iPhone; el iPhone solo limita para fabricar tarjetas, no para operar el sistema.

### Qué protege realmente cada cosa

Bloquear el chip evita que alguien **reescriba** su tarjeta, pero **no evita que la clonen**: copiar un NTAG a una tarjeta virgen toma 30 segundos con cualquier celular.

Lo que protege de verdad ya está en el diseño del sistema:

- El token no vale nada sin el servidor: un clon apunta a la misma URL y el servidor decide.
- La **foto en pantalla** es el control real; el cajero ve que el clon no coincide con quien lo presenta.
- El **tope diario** limita un token clonado a un uso por día.
- El **log** delata usos raros: la misma tarjeta en dos distritos en 10 minutos.

Si el fraude llega a ser medible, ahí sí se pasa a NTAG 424 DNA. No antes.

### Recomendación

Fase 1 (primeras 200 tarjetas): **bloqueo permanente desde el panel web**, sin contraseña. No requiere app nativa, y si una tarjeta sale mal se pierden S/ 2.

Al pasar de 500 tarjetas, o si el cliente quiere reutilizar tarjetas devueltas: app nativa o lector USB con contraseña derivada.

Regla de fondo: no invertir en seguridad del chip antes de tener fraude que medir. Invertir en que el cajero no abandone la app, que es lo que sí puede matar el proyecto.

## 3.5 Zona horaria: por qué importa

Un detalle de implementación que merece estar documentado, porque se encontró como bug y habría sido muy difícil de diagnosticar en producción.

El sistema calculaba "hoy" con la fecha **UTC**. En Perú (UTC-5) eso adelanta el día desde las 19:00, con cuatro consecuencias reales:

- **El tope diario se reiniciaba a las 7 de la noche.** Un cliente podía usar el mismo beneficio dos veces cada noche.
- Una tarjeta que vencía hoy se leía como vencida.
- Los beneficios limitados a ciertos días cambiaban de día antes de tiempo.
- Un beneficio creado de noche nacía sin estar vigente.

En producción esto aparece como "a veces el descuento se aplica dos veces" y cuesta semanas encontrarlo, porque solo ocurre en un rango de horas.

**La regla:** ninguna fecha se calcula con UTC ni con la hora local del servidor. El Plesk puede estar en UTC. Todo pasa por una zona horaria explícita del programa (`ZONA_HORARIA`, Lima por defecto). El conteo de canjes del día usa un rango calculado en esa zona, no `DATE(fecha) = CURDATE()`, que dependía de la zona de MySQL.

Si el programa se expandiera a otro país, esa variable es lo único que hay que cambiar.

## 3.6 Material de capacitación

Sin esto el software no sirve: un cajero que no entiende la app deja de usarla en una semana, y ahí muere el programa.

**Guía de caja imprimible.** Una hoja con la instalación en Android y en iPhone, el canje en cinco pasos, los nueve colores con su acción, y las situaciones frecuentes (olvidó la tarjeta, se cayó el internet, la foto no coincide). Se entrega impresa y pegada junto a la caja. Archivo: `instructivo-caja.html`, con estilos de impresión listos para exportar a PDF.

Tres reglas fijas que la guía repite:

- Siempre comparar la foto con la persona. Es el único control real contra el uso de tarjetas ajenas.
- Siempre registrar el monto. Sin ese dato no se puede demostrar a la tienda cuánto le aportó el programa.
- Nunca discutir un rechazo con el cliente. El cajero no puede saber el motivo y no es su responsabilidad.

**Video de dos minutos.** Vertical, con subtítulos quemados porque se ve en el celular y sin audio. Abre con el beneficio para la tienda antes que con la app. Guion completo con marcas de tiempo en [`docs/GUION-VIDEO-CAJA.md`](GUION-VIDEO-CAJA.md).

Del mismo rodaje salen tres cortes que en la práctica se usan más que el video completo: el canje (25 s), sin internet (20 s) y los colores (25 s).

## 4. Modelo de negocio

Es lo que suele matar estos proyectos.

- **¿Por qué se afilia una tienda?** Tiene que ganar tráfico incremental, no regalar margen a clientes que igual iban a comprar. Lo que se les vende: clientes nuevos, data y presencia en el directorio.
- ¿Se cobra a la tienda (fee mensual o comisión por canje) o el programa es gratis y el valor se captura por retención? Decidirlo antes de firmar la primera tienda; cambiarlo después es feo.
- **Masa crítica:** con menos de 15 a 20 tiendas la tarjeta no se siente valiosa. Arrancar por 3 o 4 rubros de uso frecuente (comida, farmacia, gimnasio, lavado de autos), no por lujo ocasional.
- Acuerdo escrito con cada tienda: descuento exacto, vigencia, exclusiones, quién asume el costo, cómo se sale del programa.

## 5. Legal (Perú)

- **Ley 29733 de Protección de Datos Personales:** registro del banco de datos ante la ANPD, consentimiento explícito al entregar la tarjeta, política de privacidad y contrato de encargo de tratamiento con cada tienda afiliada (van a ver datos de los clientes).
- Términos y condiciones del programa visibles, con derecho a modificar beneficios avisando con anticipación.
- **Indecopi:** el descuento anunciado debe cumplirse tal cual; letra chica clara.

## 6. Operación diaria

- Cómo se entrega y activa la tarjeta (activación por el cliente; si no, la mitad nunca la usa).
- Qué pasa si se pierde: bloquear el token viejo, emitir otro, mismo cliente.
- Vencimiento y renovación.
- Capacitación de cajeros, con rotación alta: un video de 2 minutos y un sticker en la caja.
- Soporte cuando falla en caja: un WhatsApp donde alguien responda en el momento.

## 7. Recomendación de arranque

No construir todo de una.

**Fase 1 (3 meses):** tarjetas NTAG213 con URL, sin app nativa (la URL abre una web que el cajero valida con su login), 5 tiendas piloto.

Ahí se aprenden las reglas reales de negocio y recién entonces se invierte en app offline y chips antifraude.

## 8. Estado del desarrollo

| Pieza | Estado |
|---|---|
| App de caja: validación, offline, cola de canjes, nueve estados | Construida y probada |
| Base de datos MySQL con migraciones versionadas | Construida y probada |
| Endurecimiento: scrypt, rate limiting, cookies seguras, auditoría | Construido |
| Panel de administración: lotes, emisión, tarjetas, tiendas, reportes | Construido y probado |
| Grabador de chips: Web NFC y RC522 por USB | Construido, falta probar con hardware |
| Carnet del titular, autoactivación y directorio público | Construidos y probados |
| Repositorio, pruebas automatizadas y despliegue | Construidos |
| Material de capacitación | Redactado, falta producir el video |
| Puesta en producción en Plesk | Pendiente: falta el servidor |

Código en `LucumaAgency/inmobiliaria-nfc-card`. El plan de trabajo por fases, el esquema de la base y el detalle del despliegue están en [`CHECKLIST-DESARROLLO.md`](CHECKLIST-DESARROLLO.md).

## Pendientes por definir

Ordenados por urgencia. El primero bloquea la producción de tarjetas.

- [ ] **Dominio definitivo.** Queda impreso en cada tarjeta y no se puede cambiar después. Es la única decisión verdaderamente irreversible del proyecto.
- [ ] Servidor Plesk con certificado y los secrets cargados en GitHub, para que el despliegue empiece a correr.
- [ ] Proveedor de impresión y costo real por tarjeta, para confirmar el margen.
- [ ] Confirmar que las tarjetas son NTAG213/215/216 y no MIFARE Classic.
- [ ] Vigencia de las tarjetas: uno o dos años. Va impresa.
- [ ] Modelo de cobro a las tiendas afiliadas (fee, comisión o gratis).
- [ ] Rubros y tiendas del piloto.
- [ ] Número de WhatsApp de soporte, que aparece en la guía y en el video.
- [ ] Proveedor de WhatsApp para los avisos automáticos.
- [ ] Si el programa se conecta con el ProbaCard de propietarios y colaboradores, o corre por separado.
