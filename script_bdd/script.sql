-- ============================================================
-- BAKNAZO · esquema completo de base de datos
-- Un único script para una instalación nueva.
-- Requiere PostgreSQL 13+ (gen_random_uuid viene de pgcrypto o de la core en 13+).
-- ============================================================

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


-- ============================================================
-- Usuarios
-- ============================================================
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


-- ============================================================
-- Categorías y negocios
-- ============================================================

CREATE TABLE categorias (
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
CREATE TABLE negocios (
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

CREATE INDEX idx_negocios_categoria ON negocios(categoria_id);
CREATE INDEX idx_negocios_provincia ON negocios(provincia);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_negocios_actualizado') THEN
        CREATE TRIGGER trg_negocios_actualizado
            BEFORE UPDATE ON negocios
            FOR EACH ROW
            EXECUTE FUNCTION set_actualizado_en();
    END IF;
END $$;


-- ============================================================
-- Políticas (términos y privacidad) versionadas
-- y registro de consentimiento por usuario
--
-- BAKNAZO guarda las versiones de sus políticas y un registro
-- de cada aceptación (Ley Orgánica de Protección de Datos
-- Personales del Ecuador: el responsable debe poder demostrar
-- el consentimiento).
-- ============================================================

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

-- Una sola versión vigente por tipo de política
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


-- ============================================================
-- Contenido inicial de políticas (versión 1)
-- ============================================================

INSERT INTO politicas (clave, version, titulo, contenido, vigente) VALUES
    ('TERMINOS', 1, 'Términos y Condiciones de BAKNAZO',
'TÉRMINOS Y CONDICIONES DE BAKNAZO
Fecha de entrada en vigencia: 24 de septiembre de 2026

1. OBJETO

BAKNAZO es un marketplace en línea que permite a personas y negocios publicar, buscar, ofrecer y coordinar la compra y venta de productos y servicios dentro del Ecuador. Estos Términos y Condiciones regulan el registro y el uso de la plataforma por parte de los usuarios.

2. ACEPTACIÓN

Al crear tu cuenta en BAKNAZO confirmas que has leído, comprendido y aceptado estos Términos y Condiciones, así como la Política de Privacidad. Si no estás de acuerdo, no debes usar la plataforma.

3. REGISTRO Y REQUISITOS

3.1 Para usar BAKNAZO debes ser mayor de 18 años o contar con la autorización legal correspondiente.

3.2 Te comprometes a proporcionar información verdadera, exacta y vigente al registrarte y a mantenerla actualizada.

3.3 Eres responsable de cuidar tu contraseña y de todo lo que ocurra con tu cuenta. Debes avisarnos de inmediato si sospechas un uso no autorizado.

4. USO PERMITIDO

4.1 BAKNAZO es un punto de encuentro. Los vendedores son responsables de sus publicaciones, precios, calidad, tiempos de entrega y de la coordinación con los compradores.

4.2 Queda prohibido publicar contenido ilícito, engañoso, ofensivo, discriminatorio o que infrinja derechos de terceros.

4.3 No puedes suplantar la identidad de otras personas ni crear cuentas con fines fraudulentos.

5. PUBLICACIONES

5.1 Al publicar, declaras que el contenido es tuyo o que cuentas con los derechos necesarios.

5.2 BAKNAZO puede revisar y retirar publicaciones que incumplan estos términos o las leyes aplicables.

6. RESPONSABILIDAD

6.1 BAKNAZO actúa como intermediario tecnológico y no es parte en las transacciones entre usuarios.

6.2 BAKNAZO no garantiza la veracidad de las publicaciones ni se hace responsable por los acuerdos celebrados entre usuarios.

6.3 En la medida permitida por la ley, la responsabilidad de BAKNAZO se limita a la disposición razonable de sus servicios.

7. SUSPENSIÓN Y CIERRE

BAKNAZO puede suspender, limitar o cerrar cuentas que incumplan estos términos, sin perjuicio de las acciones legales correspondientes. Si cierras tu cuenta, conservaremos tus datos únicamente mientras lo exija la normativa vigente.

8. CAMBIOS

BAKNAZO puede actualizar estos Términos y Condiciones. La versión vigente estará siempre publicada y se indicará su número de versión. Si los cambios son relevantes, te lo informaremos a través de la plataforma o por correo.

9. LEY APLICABLE Y JURISDICCIÓN

Estos Términos y Condiciones se rigen por las leyes de la República del Ecuador. Para cualquier controversia se estará a lo dispuesto por la normativa vigente.

10. CONTACTO

Para consultas sobre estos términos puedes escribir al correo de contacto publicado en la plataforma BAKNAZO.',
        TRUE),

    ('PRIVACIDAD', 1, 'Política de Privacidad de BAKNAZO',
'POLÍTICA DE PRIVACIDAD Y TRATAMIENTO DE DATOS PERSONALES
Fecha de entrada en vigencia: 24 de septiembre de 2026

1. RESPONSABLE

BAKNAZO, con domicilio en Ecuador, es el responsable del tratamiento de los datos personales que recolecta a través de su plataforma, conforme a la Ley Orgánica de Protección de Datos Personales de la República del Ecuador (LOPDP) y demás normativa aplicable.

2. DATOS QUE RECOPILAMOS

2.1 Datos que tú proporcionas: nombres, apellidos, correo electrónico, contraseña, foto de perfil y datos opcionales de tu negocio como nombre comercial, categoría, información de contacto, ubicación, redes sociales y horarios.

2.2 Datos técnicos: dirección IP, tipo de dispositivo, navegador y fechas de acceso, generados al usar la plataforma.

3. FINALIDAD DEL TRATAMIENTO

Tus datos se utilizan para:

3.1 Crear y gestionar tu cuenta y tu perfil de negocio.

3.2 Verificar tu identidad y garantizar la seguridad de la plataforma.

3.3 Conectar compradores y vendedores y permitir la operación del marketplace.

3.4 Atender solicitudes, reclamos y consultas.

3.5 Cumplir obligaciones legales y prevenir el fraude y el uso indebido.

3.6 Mejorar nuestros servicios mediante análisis agregados que no identifiquen personalmente a los usuarios.

4. BASE LEGAL

Tratamos tus datos: (i) con tu consentimiento, que otorgas libremente al registrarte y que puedes retirar en cualquier momento; (ii) para la ejecución del contrato que aceptas al usar la plataforma; (iii) para cumplir obligaciones legales; y (iv) con base en nuestro interés legítimo de operar y mejorar el servicio de forma segura.

5. DESTINATARIOS

No vendemos ni alquilamos tus datos personales. Podemos compartirlos con: (i) proveedores tecnológicos y de servicios necesarios para operar la plataforma; (ii) autoridades competentes cuando la ley lo exija; y (iii) personas que hayas autorizado mediante la propia plataforma.

6. CONSERVACIÓN

Conservamos tus datos mientras tu cuenta esté activa y, después, durante los plazos que exija la normativa aplicable o para el cumplimiento de obligaciones legales.

7. TUS DERECHOS

De acuerdo con la LOPDP tienes derecho a: acceso, rectificación, actualización, supresión, oposición y portabilidad de tus datos, así como a retirar tu consentimiento. Para ejercerlos puedes escribir al correo de contacto publicado en la plataforma, indicando tu nombre y el derecho que deseas ejercer.

8. MENORES DE EDAD

La plataforma está dirigida a mayores de 18 años. No recolectamos intencionalmente datos de personas menores de edad sin autorización; si detectamos este caso, procederemos conforme a la ley.

9. SEGURIDAD

Aplicamos medidas técnicas y organizativas razonables para proteger tus datos contra pérdida, alteración, acceso no autorizado o uso indebido.

10. CAMBIOS

Si modificamos esta Política de Privacidad, publicaremos la nueva versión con su número de versión y su fecha. Los cambios significativos se te informarán a través de la plataforma o por correo.

11. IDENTIFICACIÓN DEL RESPONSABLE

La identificación de BAKNAZO y de su representante estará disponible en la información de la plataforma.',
        TRUE)
ON CONFLICT (clave, version) DO NOTHING;