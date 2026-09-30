-- Privacidad del perfil público: qué partes ve alguien que no es el dueño.
-- Objeto jsonb con booleanos (vendidos, me_gusta, seguidores, ubicacion,
-- miembro_desde, direccion, horario, redes, contacto_negocio). Vacío = todo visible.
-- Idempotente: se puede ejecutar más de una vez.

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS privacidad_perfil JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN usuarios.privacidad_perfil IS
    'Qué partes del perfil público se ocultan a los visitantes. Clave ausente = visible.';
