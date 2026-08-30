# Grabador de tarjetas

Escribe la URL de cada tarjeta en el chip NTAG, verifica lo escrito y lo bloquea.

Hay dos caminos. Ambos piden los códigos al servidor y le confirman cada grabado, así que la base siempre sabe qué tarjetas quedan pendientes.

| | Web NFC (panel) | RC522 por USB |
|---|---|---|
| Hardware | Un Android con NFC | Arduino + módulo RC522 |
| Dónde | Panel, pestaña Grabar | Este script, desde la PC |
| Bloqueo | Sí | Sí |
| Contraseña del chip | No | Posible (no implementado aún) |
| Funciona en iPhone | No | Sí, el iPhone no participa |

## Importante: las tarjetas del kit no sirven

El RC522 suele venderse con una tarjeta azul y un llavero **MIFARE Classic 1K**. No sirven para ProbaCard: un iPhone no los lee y Android no abre la URL sola.

Hay que usar **NTAG213, NTAG215 o NTAG216** (NFC Forum Type 2).

## Camino A: desde el panel (Android)

Panel → **Grabar** → elegir lote → Empezar. Acercar una tarjeta por vez. Si el navegador no soporta Web NFC, el panel lo avisa.

## Camino B: RC522 por USB

### Conexión (Arduino Uno)

```
RC522 SDA(SS) -> D10      RC522 SCK  -> D13
RC522 MOSI    -> D11      RC522 MISO -> D12
RC522 RST     -> D9       RC522 3.3V -> 3.3V   (NO 5V: se quema)
RC522 GND     -> GND
```

### Preparación

1. Instalar la librería **MFRC522 de miguelbalboa** desde el Gestor de librerías del IDE de Arduino.
2. Cargar `arduino/grabador_probacard/grabador_probacard.ino`.
3. Cerrar el Monitor Serie del IDE: si queda abierto, el puerto está ocupado.

### Uso

```bash
# Prueba, sin bloquear el chip
node grabador/puente.js --lote LOTE-2026-01 --puerto /dev/ttyUSB0 --sin-bloqueo

# Producción
node grabador/puente.js --lote LOTE-2026-01 --puerto /dev/ttyUSB0
```

El puerto suele ser `/dev/ttyUSB0` o `/dev/ttyACM0` en Linux, `COM3` en Windows.

Opciones: `--servidor` (por defecto `http://localhost:3020`). Usuario y clave se piden por consola, o se pasan en `PC_USUARIO` y `PC_CLAVE`.

### Qué hace por cada tarjeta

1. Pide el siguiente código pendiente del lote.
2. Manda escribir la URL en el chip.
3. **Lee de vuelta y compara.** Si no coincide, no bloquea y se detiene.
4. Bloquea el chip, salvo con `--sin-bloqueo`.
5. Confirma al servidor con el UID físico del chip.

El paso 3 no es opcional: **el bloqueo es irreversible.** Si la URL quedó mal y se bloqueó, esa tarjeta se pierde.

Ante cualquier error el proceso se detiene en vez de seguir. Un error de grabado hay que mirarlo, no acumularlo.

### Protocolo serial

El Arduino no sabe qué tokens existen: solo ejecuta. 115200 baudios, una línea por mensaje.

| Se le manda | Responde |
|---|---|
| `PING` | `LISTO` |
| `ESCRIBIR <url>` | `OK <uid>` o `ERROR <motivo>` |
| `LEER` | `URL <url>`, `VACIO` o `ERROR <motivo>` |
| `BLOQUEAR` | `OK` o `ERROR <motivo>` |

Esa separación permite cambiar de hardware sin tocar la lógica: si más adelante se compra un lector ACR122U, solo se reemplaza la clase `Arduino` del puente.

## Verificar que una tarjeta es NTAG

Con el sketch cargado, abrir el Monitor Serie a 115200 y mandar `LEER` con la tarjeta encima:

- Responde `VACIO` o `URL ...` → es un Type 2, sirve.
- Responde `ERROR sin_tarjeta` con la tarjeta puesta → probablemente es MIFARE Classic, no sirve.

Desde el celular es más rápido: la app **NFC Tools** muestra el tipo de chip en la pestaña Leer.
