-- ============================================================
-- Migración: categorías y perfiles de negocio
-- Requiere el esquema base de script.sql (tabla usuarios)
-- ============================================================

-- Categorías principales de negocio
CREATE TABLE IF NOT EXISTS categorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
        CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categorias (nombre) VALUES
    ('Restaurante'),
    ('Cafetería'),
    ('Panadería'),
    ('Repostería'),
    ('Comida rápida'),
    ('Ropa y accesorios'),
    ('Calzado'),
    ('Belleza y estética'),
    ('Salón de belleza'),
    ('Barbería'),
    ('Farmacia'),
    ('Salud y bienestar'),
    ('Gimnasio'),
    ('Tecnología y celulares'),
    ('Electrodomésticos'),
    ('Ferretería'),
    ('Negocios del hogar'),
    ('Mascotas'),
    ('Floristería'),
    ('Joyería'),
    ('Artículos de fiesta'),
    ('Libros y papelería'),
    ('Juguetes'),
    ('Supermercado'),
    ('Mini market'),
    ('Licorería'),
    ('Servicios profesionales'),
    ('Otros')
ON CONFLICT (nombre) DO NOTHING;

-- Perfil comercial de un negocio (1 a 1 con usuarios)
CREATE TABLE IF NOT EXISTS negocios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL UNIQUE
        REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre_comercial VARCHAR(150) NOT NULL,
    categoria_id UUID
        REFERENCES categorias(id) ON DELETE SET NULL,
    descripcion_breve TEXT,
    logo_url TEXT,
    provincia VARCHAR(100),
    ciudad VARCHAR(100),
    sector VARCHAR(150),
    direccion_local TEXT,
    tiene_local BOOLEAN NOT NULL DEFAULT TRUE,
    latitud NUMERIC(9, 6),
    longitud NUMERIC(9, 6),
    telefono VARCHAR(30),
    whatsapp VARCHAR(30),
    correo_contacto CITEXT,
    -- Ejemplo: {"facebook":"https://...","instagram":"https://...","tiktok":"https://..."}
    redes_sociales JSONB,
    -- Ejemplo: [{"dia":"Lunes","apertura":"09:00","cierre":"18:00"}, ...] o activar todo el día con {"lunes":true}
    horario_atencion JSONB,
    entrega_domicilio BOOLEAN NOT NULL DEFAULT FALSE,
    -- Si el negocio es solo a domicilio / sin local, aquí se describe la zona de cobertura
    zona_cobertura TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
        CHECK (estado IN ('ACTIVO', 'INACTIVO', 'SUSPENDIDO')),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_negocios_categoria ON negocios(categoria_id);
CREATE INDEX IF NOT EXISTS idx_negocios_provincia ON negocios(provincia);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_negocios_actualizado') THEN
        CREATE TRIGGER trg_negocios_actualizado
            BEFORE UPDATE ON negocios
            FOR EACH ROW
            EXECUTE FUNCTION set_actualizado_en();
    END IF;
END $$;