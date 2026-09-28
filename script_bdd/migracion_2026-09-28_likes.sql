-- ============================================================
-- Migración 2026-09-28: vendido + me gusta
-- Para una base de datos que ya existe (script.sql ya incluye estos
-- cambios para instalaciones nuevas). Se puede ejecutar más de una vez.
-- ============================================================

BEGIN;

ALTER TABLE anuncios
  ADD COLUMN IF NOT EXISTS vendido    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vendido_en TIMESTAMPTZ;

-- ADD CONSTRAINT no tiene IF NOT EXISTS: se comprueba a mano para poder re-ejecutar.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendido_con_fecha') THEN
        ALTER TABLE anuncios
            ADD CONSTRAINT vendido_con_fecha CHECK (vendido = (vendido_en IS NOT NULL));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS anuncio_likes (
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anuncio_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_anuncios_venta ON anuncios (autor_usuario_id, vendido);

-- El DROP es obligatorio: el índice viejo no excluye vendidos y el feed nuevo
-- filtra por NOT vendido; sin rehacerlo, PostgreSQL no puede usarlo.
DROP INDEX IF EXISTS idx_anuncios_feed;
CREATE INDEX idx_anuncios_feed ON anuncios (pilar, publicado_en DESC, id DESC)
    WHERE estado = 'PUBLICADO' AND eliminado_en IS NULL AND NOT vendido;

COMMIT;
