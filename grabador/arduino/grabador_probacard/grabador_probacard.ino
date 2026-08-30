/*
 * ProbaCard - grabador de tarjetas NTAG con RC522
 *
 * El Arduino es un ejecutor tonto: no sabe que tokens existen. El puente
 * (grabador/puente.js) le manda la URL y el Arduino responde que paso.
 *
 * IMPORTANTE: solo funciona con NTAG213/215/216 (NFC Forum Type 2).
 * Las tarjetas MIFARE Classic que vienen en los kits del RC522 NO sirven:
 * ningun iPhone las lee y Android no abre la URL automaticamente.
 *
 * Conexion (Arduino Uno):
 *   RC522 SDA(SS) -> D10      RC522 SCK  -> D13
 *   RC522 MOSI    -> D11      RC522 MISO -> D12
 *   RC522 RST     -> D9       RC522 3.3V -> 3.3V   (NO 5V)
 *   RC522 GND     -> GND
 *
 * Librería: MFRC522 de miguelbalboa (Gestor de librerías del IDE).
 *
 * Protocolo por serial, 115200 baudios. Una linea por mensaje:
 *   ->  PING                    <-  LISTO
 *   ->  ESCRIBIR <url>          <-  OK <uid>  |  ERROR <motivo>
 *   ->  LEER                    <-  URL <url> |  VACIO | ERROR <motivo>
 *   ->  BLOQUEAR                <-  OK        |  ERROR <motivo>
 */

#include <SPI.h>
#include <MFRC522.h>

#define PIN_SS   10
#define PIN_RST   9

MFRC522 lector(PIN_SS, PIN_RST);

const byte PAGINA_DATOS = 4;   // los datos de usuario del NTAG empiezan aqui

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  SPI.begin();
  lector.PCD_Init();
  Serial.println(F("LISTO"));
}

/* Espera a que haya una tarjeta presente y la selecciona. */
bool tomarTarjeta(unsigned long msEspera) {
  unsigned long limite = millis() + msEspera;
  while (millis() < limite) {
    if (lector.PICC_IsNewCardPresent() && lector.PICC_ReadCardSerial()) return true;
    delay(40);
  }
  return false;
}

void soltarTarjeta() {
  lector.PICC_HaltA();
  lector.PCD_StopCrypto1();
}

void imprimirUid() {
  for (byte i = 0; i < lector.uid.size; i++) {
    if (lector.uid.uidByte[i] < 0x10) Serial.print('0');
    Serial.print(lector.uid.uidByte[i], HEX);
  }
}

/*
 * Arma el mensaje NDEF con un registro URI y lo deja en destino.
 * Estructura: TLV 0x03 <largo> [cabecera NDEF][URL] 0xFE
 * Prefijo 0x04 = "https://", asi que la URL se guarda sin esa parte.
 */
int armarNdef(const char* url, byte* destino, int maximo) {
  const char* prefijo = "https://";
  int saltar = 0;
  if (strncmp(url, prefijo, 8) == 0) saltar = 8;
  int largoUrl = strlen(url) - saltar;

  int largoCarga = largoUrl + 1;          // +1 por el byte de prefijo
  int largoMensaje = largoCarga + 4;      // cabecera del registro NDEF
  if (largoMensaje + 3 > maximo) return -1;

  int i = 0;
  destino[i++] = 0x03;                    // TLV: mensaje NDEF
  destino[i++] = (byte)largoMensaje;
  destino[i++] = 0xD1;                    // MB|ME|SR|TNF=well-known
  destino[i++] = 0x01;                    // largo del tipo
  destino[i++] = (byte)largoCarga;
  destino[i++] = 0x55;                    // tipo "U" (URI)
  destino[i++] = 0x04;                    // prefijo "https://"
  for (int j = 0; j < largoUrl; j++) destino[i++] = url[saltar + j];
  destino[i++] = 0xFE;                    // fin de TLV

  while (i % 4 != 0) destino[i++] = 0x00; // el NTAG escribe de a 4 bytes
  return i;
}

void comandoEscribir(const char* url) {
  byte buffer[144];
  int largo = armarNdef(url, buffer, sizeof(buffer));
  if (largo < 0) { Serial.println(F("ERROR url_demasiado_larga")); return; }

  if (!tomarTarjeta(8000)) { Serial.println(F("ERROR sin_tarjeta")); return; }

  // El NTAG solo acepta escrituras de 4 bytes por pagina.
  for (int i = 0; i < largo; i += 4) {
    byte pagina = PAGINA_DATOS + (i / 4);
    MFRC522::StatusCode s = lector.MIFARE_Ultralight_Write(pagina, buffer + i, 4);
    if (s != MFRC522::STATUS_OK) {
      Serial.print(F("ERROR escritura_pagina_"));
      Serial.println(pagina);
      soltarTarjeta();
      return;
    }
  }
  Serial.print(F("OK "));
  imprimirUid();
  Serial.println();
  soltarTarjeta();
}

void comandoLeer() {
  if (!tomarTarjeta(8000)) { Serial.println(F("ERROR sin_tarjeta")); return; }

  byte datos[64];
  int total = 0;
  // MIFARE_Read devuelve 16 bytes (4 paginas) por llamada.
  for (byte p = PAGINA_DATOS; p < PAGINA_DATOS + 16 && total < 60; p += 4) {
    byte buffer[18];
    byte tam = sizeof(buffer);
    if (lector.MIFARE_Read(p, buffer, &tam) != MFRC522::STATUS_OK) break;
    for (byte i = 0; i < 16 && total < 60; i++) datos[total++] = buffer[i];
  }
  soltarTarjeta();

  if (total < 8 || datos[0] != 0x03) { Serial.println(F("VACIO")); return; }

  int largoMensaje = datos[1];
  int inicio = 7;                          // salta TLV y cabecera NDEF
  int largoUrl = largoMensaje - 4;
  if (largoUrl <= 0 || inicio + largoUrl > total) { Serial.println(F("VACIO")); return; }

  Serial.print(F("URL https://"));
  for (int i = 0; i < largoUrl; i++) Serial.write(datos[inicio + i]);
  Serial.println();
}

/*
 * Bloqueo permanente. Escribe los lock bytes de la pagina 2 (bytes 2 y 3).
 * IRREVERSIBLE: el puente solo manda este comando despues de verificar.
 */
void comandoBloquear() {
  if (!tomarTarjeta(8000)) { Serial.println(F("ERROR sin_tarjeta")); return; }

  byte buffer[18];
  byte tam = sizeof(buffer);
  if (lector.MIFARE_Read(2, buffer, &tam) != MFRC522::STATUS_OK) {
    Serial.println(F("ERROR lectura_lock")); soltarTarjeta(); return;
  }
  byte pagina2[4] = { buffer[0], buffer[1], 0xFF, 0xFF };   // static lock bytes
  if (lector.MIFARE_Ultralight_Write(2, pagina2, 4) != MFRC522::STATUS_OK) {
    Serial.println(F("ERROR escritura_lock")); soltarTarjeta(); return;
  }
  Serial.println(F("OK"));
  soltarTarjeta();
}

void loop() {
  if (!Serial.available()) return;

  String linea = Serial.readStringUntil('\n');
  linea.trim();
  if (linea.length() == 0) return;

  if (linea == "PING") {
    Serial.println(F("LISTO"));
  } else if (linea.startsWith("ESCRIBIR ")) {
    comandoEscribir(linea.substring(9).c_str());
  } else if (linea == "LEER") {
    comandoLeer();
  } else if (linea == "BLOQUEAR") {
    comandoBloquear();
  } else {
    Serial.println(F("ERROR comando_desconocido"));
  }
}
