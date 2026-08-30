-- ProbaCard - esquema inicial
-- Correr una sola vez, sobre una base vacia.
-- En Plesk: Bases de datos > phpMyAdmin > pestania Importar.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------- tiendas
CREATE TABLE IF NOT EXISTS tiendas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120)   NOT NULL,
  rubro         VARCHAR(60),
  direccion     VARCHAR(200),
  distrito      VARCHAR(60),
  lat           DECIMAL(10,7),
  lng           DECIMAL(10,7),
  estado        ENUM('activa','pausada','baja') NOT NULL DEFAULT 'activa',
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tiendas_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una tienda puede cambiar de beneficio. El anterior se cierra con
-- vigente_hasta en vez de pisarse, para que un canje viejo siga
-- mostrando el beneficio que estaba vigente ese dia.
CREATE TABLE IF NOT EXISTS beneficios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tienda_id     INT            NOT NULL,
  descripcion   VARCHAR(160)   NOT NULL,
  condiciones   TEXT,
  tope_diario   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  monto_minimo  DECIMAL(10,2)  NOT NULL DEFAULT 0,
  dias_validos  VARCHAR(7)     NOT NULL DEFAULT '1234567',  -- 1=lunes ... 7=domingo
  vigente_desde DATE           NOT NULL,
  vigente_hasta DATE           NULL,
  CONSTRAINT fk_beneficios_tienda FOREIGN KEY (tienda_id) REFERENCES tiendas(id),
  INDEX idx_beneficios_vigencia (tienda_id, vigente_hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- clientes
CREATE TABLE IF NOT EXISTS clientes (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  nombre            VARCHAR(120) NOT NULL,
  doc               VARCHAR(15)  NOT NULL,
  celular           VARCHAR(15),
  correo            VARCHAR(120),
  foto              VARCHAR(200),
  consentimiento_en DATETIME NULL,      -- exigido por la Ley 29733
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clientes_doc (doc),
  INDEX idx_clientes_celular (celular)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- tarjetas
-- El token identifica a la TARJETA, no al cliente. Si se pierde,
-- se emite otra apuntando al mismo cliente y el historial no se corta.
CREATE TABLE IF NOT EXISTS tarjetas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  token         VARCHAR(12)  NOT NULL,
  uid_chip      VARCHAR(20)  NULL,       -- UID fisico del NTAG, para detectar clones
  lote          VARCHAR(30),
  cliente_id    INT          NULL,       -- NULL mientras esta en blanco
  estado        ENUM('en_blanco','activa','suspendida','perdida','vencida')
                NOT NULL DEFAULT 'en_blanco',
  vence         DATE         NULL,
  reemplaza_a   INT          NULL,
  emitida_en    DATETIME     NULL,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tarjetas_token (token),
  UNIQUE KEY uq_tarjetas_uid (uid_chip),
  CONSTRAINT fk_tarjetas_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT fk_tarjetas_reemplaza FOREIGN KEY (reemplaza_a) REFERENCES tarjetas(id),
  INDEX idx_tarjetas_estado (estado),
  INDEX idx_tarjetas_lote (lote)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  usuario       VARCHAR(40)  NOT NULL,
  clave_hash    VARCHAR(255) NOT NULL,   -- scrypt. Nunca texto plano.
  rol           ENUM('admin','tienda','caja') NOT NULL,
  tienda_id     INT          NULL,       -- NULL solo para rol admin
  nombre        VARCHAR(120),
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  ultimo_acceso DATETIME     NULL,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_usuario (usuario),
  CONSTRAINT fk_usuarios_tienda FOREIGN KEY (tienda_id) REFERENCES tiendas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------- canjes
CREATE TABLE IF NOT EXISTS canjes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  id_local      CHAR(36)     NULL,       -- idempotencia de la cola offline
  cliente_id    INT          NOT NULL,
  tarjeta_id    INT          NOT NULL,
  tienda_id     INT          NOT NULL,
  beneficio_id  INT          NOT NULL,
  usuario_id    INT          NOT NULL,
  monto         DECIMAL(10,2) NOT NULL DEFAULT 0,
  fecha         DATETIME     NOT NULL,
  offline       BOOLEAN      NOT NULL DEFAULT FALSE,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_canjes_local (id_local),
  CONSTRAINT fk_canjes_cliente   FOREIGN KEY (cliente_id)   REFERENCES clientes(id),
  CONSTRAINT fk_canjes_tarjeta   FOREIGN KEY (tarjeta_id)   REFERENCES tarjetas(id),
  CONSTRAINT fk_canjes_tienda    FOREIGN KEY (tienda_id)    REFERENCES tiendas(id),
  CONSTRAINT fk_canjes_beneficio FOREIGN KEY (beneficio_id) REFERENCES beneficios(id),
  CONSTRAINT fk_canjes_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(id),
  INDEX idx_canjes_tienda_fecha (tienda_id, fecha),
  INDEX idx_canjes_cliente_fecha (cliente_id, fecha),
  INDEX idx_canjes_tope (cliente_id, tienda_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------ validaciones
-- Toda consulta de tarjeta, termine o no en canje.
-- El ratio validaciones/canjes es el termometro de salud del programa.
CREATE TABLE IF NOT EXISTS validaciones (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  token         VARCHAR(12),
  tienda_id     INT          NULL,
  usuario_id    INT          NULL,
  resultado     VARCHAR(20)  NOT NULL,
  offline       BOOLEAN      NOT NULL DEFAULT FALSE,
  fecha         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_validaciones_tienda_fecha (tienda_id, fecha),
  INDEX idx_validaciones_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------ control de version
CREATE TABLE IF NOT EXISTS migraciones (
  archivo    VARCHAR(80) PRIMARY KEY,
  aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
