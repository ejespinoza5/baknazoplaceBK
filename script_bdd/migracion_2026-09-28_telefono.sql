-- ============================================================
-- Migración 2026-09-28: teléfono de contacto
-- Para una base de datos que ya existe (script.sql ya incluye estos
-- cambios para instalaciones nuevas). Se puede ejecutar más de una vez.
-- ============================================================

BEGIN;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS telefono VARCHAR(20),
  ADD COLUMN IF NOT EXISTS mostrar_telefono BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE anuncios
  ADD COLUMN IF NOT EXISTS mostrar_telefono BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS anuncio_contactos (
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    ultimo_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anuncio_id, usuario_id)
);

COMMIT;
