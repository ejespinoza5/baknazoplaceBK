-- Extensión para correo case-insensitive
CREATE EXTENSION IF NOT EXISTS citext;

-- Función para actualizar 'actualizado_en' automáticamente
CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_cuenta VARCHAR(20) NOT NULL
        CHECK (tipo_cuenta IN ('PERSONA', 'NEGOCIO')),
    correo CITEXT NOT NULL UNIQUE,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100),
    foto_perfil TEXT,
    foto_logo TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
        CHECK (estado IN ('ACTIVO', 'INACTIVO', 'SUSPENDIDO')),
    correo_verificado BOOLEAN NOT NULL DEFAULT FALSE,
    correo_verificado_en TIMESTAMPTZ,
    ultimo_acceso_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_usuarios_actualizado
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();


CREATE TABLE cuentas_autenticacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL
        REFERENCES usuarios(id) ON DELETE CASCADE,
    proveedor VARCHAR(20) NOT NULL
        CHECK (proveedor IN ('CORREO', 'GOOGLE')),
    id_proveedor VARCHAR(255),
    contrasena_hash TEXT,   -- solo cuando proveedor = 'CORREO'
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (proveedor, id_proveedor),
    UNIQUE (usuario_id, proveedor)
);

CREATE INDEX idx_cuentas_auth_usuario ON cuentas_autenticacion(usuario_id);


CREATE TABLE codigos_verificacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL
        REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    expira_en TIMESTAMPTZ NOT NULL,
    verificado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_codigos_verif_usuario ON codigos_verificacion(usuario_id);


CREATE TABLE codigos_recuperacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL
        REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    expira_en TIMESTAMPTZ NOT NULL,
    utilizado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_codigos_recup_usuario ON codigos_recuperacion(usuario_id);


CREATE TABLE tokens_actualizacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL
        REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expira_en TIMESTAMPTZ NOT NULL,
    revocado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tokens_usuario ON tokens_actualizacion(usuario_id);


-- Políticas versionadas (términos y privacidad) y consentimiento por usuario
CREATE TABLE politicas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clave VARCHAR(30) NOT NULL CHECK (clave IN ('TERMINOS', 'PRIVACIDAD')),
    version INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    vigente BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_publicacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (clave, version)
);

CREATE UNIQUE INDEX uq_politicas_vigente
    ON politicas (clave) WHERE vigente;

CREATE TABLE aceptaciones_politicas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL
        REFERENCES usuarios(id) ON DELETE CASCADE,
    politica_id UUID NOT NULL
        REFERENCES politicas(id) ON DELETE RESTRICT,
    ip TEXT,
    user_agent TEXT,
    fecha_aceptacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (usuario_id, politica_id)
);

CREATE INDEX idx_aceptaciones_usuario ON aceptaciones_politicas(usuario_id);
CREATE INDEX idx_aceptaciones_politica ON aceptaciones_politicas(politica_id);