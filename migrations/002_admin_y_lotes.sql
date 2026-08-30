-- Panel de administracion: lotes de tarjetas y usuario admin.

-- Un lote agrupa las tarjetas que se mandan a imprimir juntas.
CREATE TABLE IF NOT EXISTS lotes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  codigo        VARCHAR(30)  NOT NULL,
  cantidad      INT          NOT NULL,
  nota          VARCHAR(200),
  creado_por    INT          NULL,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lotes_codigo (codigo),
  CONSTRAINT fk_lotes_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Momento en que cada tarjeta se grabo fisicamente. Sirve para saber
-- que quedo pendiente si se interrumpe el grabado de un lote.
ALTER TABLE tarjetas ADD COLUMN grabada_en DATETIME NULL AFTER lote;

-- Usuario administrador inicial.
-- Clave: admin123. CAMBIARLA en el primer ingreso.
INSERT INTO usuarios (usuario, clave_hash, rol, tienda_id, nombre)
SELECT 'admin',
       'scrypt$00000000000000000000000000000000$0',
       'admin', NULL, 'Administrador'
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE usuario = 'admin');
