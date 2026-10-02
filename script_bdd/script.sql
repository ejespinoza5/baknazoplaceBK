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
    -- Teléfono personal en E.164 (+593991234567). Nunca viaja en los listados:
    -- solo lo entrega POST /api/anuncios/:id/contacto a un usuario con sesión.
    telefono VARCHAR(20),
    mostrar_telefono BOOLEAN NOT NULL DEFAULT FALSE,
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


-- ============================================================
-- ANUNCIOS (productos · servicios · empleo)
--
-- Esta sección se puede ejecutar sola sobre una base que ya
-- tiene todo lo anterior (usuarios, negocios, set_actualizado_en).
--
-- Diferencias con el diseño original, adaptadas a este esquema:
--  · usuarios.id y negocios.id son UUID, así que las FK también.
--  · 'categorias' ya existe y es de NEGOCIOS (UUID, sin pilar);
--    las de anuncios van en 'categorias_anuncio' para no romperla.
--  · autor_usuario_id siempre se llena (quién publicó) y
--    autor_negocio_id solo si publicó como negocio. El CHECK
--    num_nonnulls(...) = 1 del diseño era imposible de cumplir
--    con autor_usuario_id NOT NULL.
-- ============================================================

-- ------------------------------------------------------------
-- Categorías de anuncios (una lista por pilar)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias_anuncio (
    id      SERIAL PRIMARY KEY,
    slug    VARCHAR(60) NOT NULL,
    nombre  VARCHAR(80) NOT NULL,
    pilar   VARCHAR(20) NOT NULL
        CHECK (pilar IN ('productos', 'servicios', 'empleo')),
    activa  BOOLEAN NOT NULL DEFAULT TRUE,
    orden   SMALLINT NOT NULL DEFAULT 0,
    -- "Tecnología" puede existir en productos y en empleo: el slug es único por pilar.
    UNIQUE (pilar, slug)
);

INSERT INTO categorias_anuncio (slug, nombre, pilar, orden) VALUES
    -- Las 9 que hoy tiene el formulario (datos.ts)
    ('tecnologia',        'Tecnología',                  'productos', 1),
    ('vehiculos',         'Vehículos',                   'productos', 2),
    ('hogar',             'Hogar y Electrodomésticos',   'productos', 3),
    ('moda',              'Moda',                        'productos', 4),
    ('inmuebles',         'Inmuebles',                   'productos', 5),
    ('entretenimiento',   'Entretenimiento',             'productos', 6),
    ('deportes',          'Deportes',                    'productos', 7),
    ('construccion',      'Construcción y herramientas', 'productos', 8),
    ('otros',             'Otros',                       'productos', 99),
    -- Servicios
    ('tecnologia',        'Tecnología y diseño',         'servicios', 1),
    ('hogar',             'Hogar y reparaciones',        'servicios', 2),
    ('belleza',           'Belleza y cuidado personal',  'servicios', 3),
    ('clases',            'Clases y tutorías',           'servicios', 4),
    ('eventos',           'Eventos',                     'servicios', 5),
    ('transporte',        'Transporte y mudanzas',       'servicios', 6),
    ('salud',             'Salud y bienestar',           'servicios', 7),
    ('profesionales',     'Servicios profesionales',     'servicios', 8),
    ('otros',             'Otros',                       'servicios', 99),
    -- Empleo
    ('tecnologia',        'Tecnología',                  'empleo', 1),
    ('ventas',            'Ventas y atención al cliente','empleo', 2),
    ('administracion',    'Administración y finanzas',   'empleo', 3),
    ('gastronomia',       'Gastronomía',                 'empleo', 4),
    ('construccion',      'Construcción y oficios',      'empleo', 5),
    ('salud',             'Salud',                       'empleo', 6),
    ('educacion',         'Educación',                   'empleo', 7),
    ('logistica',         'Logística y transporte',      'empleo', 8),
    ('otros',             'Otros',                       'empleo', 99)
ON CONFLICT (pilar, slug) DO NOTHING;


-- ------------------------------------------------------------
-- Territorio: cantones (con su provincia desnormalizada)
-- Código de 6 dígitos: 2 provincia (INEC) + 2 cantón + '01'.
-- Generado desde src/data/ecuador.ts del front.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cantones (
    codigo            CHAR(6) PRIMARY KEY,   -- '170101' Pichincha / Quito
    nombre            VARCHAR(80) NOT NULL,
    provincia_codigo  CHAR(2)     NOT NULL,
    provincia_nombre  VARCHAR(80) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cantones_provincia ON cantones (provincia_codigo);

INSERT INTO cantones (codigo, nombre, provincia_codigo, provincia_nombre) VALUES
    ('010101', 'Cuenca', '01', 'Azuay'),
    ('010201', 'Girón', '01', 'Azuay'),
    ('010301', 'Gualaceo', '01', 'Azuay'),
    ('010401', 'Nabón', '01', 'Azuay'),
    ('010501', 'Paute', '01', 'Azuay'),
    ('010601', 'Pucará', '01', 'Azuay'),
    ('010701', 'San Fernando', '01', 'Azuay'),
    ('010801', 'Santa Isabel', '01', 'Azuay'),
    ('010901', 'Sevilla de Oro', '01', 'Azuay'),
    ('011001', 'Sígsig', '01', 'Azuay'),
    ('011101', 'Oña', '01', 'Azuay'),
    ('011201', 'Chordeleg', '01', 'Azuay'),
    ('011301', 'El Pan', '01', 'Azuay'),
    ('011401', 'Guachapala', '01', 'Azuay'),
    ('011501', 'Camilo Ponce Enríquez', '01', 'Azuay'),
    ('020101', 'Guaranda', '02', 'Bolívar'),
    ('020201', 'Chillanes', '02', 'Bolívar'),
    ('020301', 'Chimbo', '02', 'Bolívar'),
    ('020401', 'Echeandía', '02', 'Bolívar'),
    ('020501', 'San Miguel', '02', 'Bolívar'),
    ('020601', 'Caluma', '02', 'Bolívar'),
    ('020701', 'Las Naves', '02', 'Bolívar'),
    ('030101', 'Azogues', '03', 'Cañar'),
    ('030201', 'Biblián', '03', 'Cañar'),
    ('030301', 'Cañar', '03', 'Cañar'),
    ('030401', 'Déleg', '03', 'Cañar'),
    ('030501', 'El Tambo', '03', 'Cañar'),
    ('030601', 'La Troncal', '03', 'Cañar'),
    ('030701', 'Suscal', '03', 'Cañar'),
    ('040101', 'Tulcán', '04', 'Carchi'),
    ('040201', 'Bolívar', '04', 'Carchi'),
    ('040301', 'Espejo', '04', 'Carchi'),
    ('040401', 'Mira', '04', 'Carchi'),
    ('040501', 'Montúfar', '04', 'Carchi'),
    ('040601', 'San Pedro de Huaca', '04', 'Carchi'),
    ('050101', 'Latacunga', '05', 'Cotopaxi'),
    ('050201', 'La Maná', '05', 'Cotopaxi'),
    ('050301', 'Pangua', '05', 'Cotopaxi'),
    ('050401', 'Pujilí', '05', 'Cotopaxi'),
    ('050501', 'Salcedo', '05', 'Cotopaxi'),
    ('050601', 'Saquisilí', '05', 'Cotopaxi'),
    ('050701', 'Sigchos', '05', 'Cotopaxi'),
    ('060101', 'Riobamba', '06', 'Chimborazo'),
    ('060201', 'Alausí', '06', 'Chimborazo'),
    ('060301', 'Colta', '06', 'Chimborazo'),
    ('060401', 'Cumandá', '06', 'Chimborazo'),
    ('060501', 'Guamote', '06', 'Chimborazo'),
    ('060601', 'Guano', '06', 'Chimborazo'),
    ('060701', 'Pallatanga', '06', 'Chimborazo'),
    ('060801', 'Penipe', '06', 'Chimborazo'),
    ('060901', 'Chambo', '06', 'Chimborazo'),
    ('061001', 'Chunchi', '06', 'Chimborazo'),
    ('070101', 'Machala', '07', 'El Oro'),
    ('070201', 'Arenillas', '07', 'El Oro'),
    ('070301', 'Atahualpa', '07', 'El Oro'),
    ('070401', 'Balsas', '07', 'El Oro'),
    ('070501', 'Chilla', '07', 'El Oro'),
    ('070601', 'El Guabo', '07', 'El Oro'),
    ('070701', 'Huaquillas', '07', 'El Oro'),
    ('070801', 'Marcabelí', '07', 'El Oro'),
    ('070901', 'Pasaje', '07', 'El Oro'),
    ('071001', 'Piñas', '07', 'El Oro'),
    ('071101', 'Portovelo', '07', 'El Oro'),
    ('071201', 'Santa Rosa', '07', 'El Oro'),
    ('071301', 'Zaruma', '07', 'El Oro'),
    ('071401', 'Las Lajas', '07', 'El Oro'),
    ('080101', 'Esmeraldas', '08', 'Esmeraldas'),
    ('080201', 'Eloy Alfaro', '08', 'Esmeraldas'),
    ('080301', 'Muisne', '08', 'Esmeraldas'),
    ('080401', 'Quinindé', '08', 'Esmeraldas'),
    ('080501', 'San Lorenzo', '08', 'Esmeraldas'),
    ('080601', 'Atacames', '08', 'Esmeraldas'),
    ('080701', 'Río Verde', '08', 'Esmeraldas'),
    ('090101', 'Guayaquil', '09', 'Guayas'),
    ('090201', 'Alfredo Baquerizo Moreno', '09', 'Guayas'),
    ('090301', 'Balao', '09', 'Guayas'),
    ('090401', 'Balzar', '09', 'Guayas'),
    ('090501', 'Colimes', '09', 'Guayas'),
    ('090601', 'Coronel Marcelino Maridueña', '09', 'Guayas'),
    ('090701', 'Daule', '09', 'Guayas'),
    ('090801', 'Durán', '09', 'Guayas'),
    ('090901', 'El Empalme', '09', 'Guayas'),
    ('091001', 'El Triunfo', '09', 'Guayas'),
    ('091101', 'General Antonio Elizalde', '09', 'Guayas'),
    ('091201', 'Isidro Ayora', '09', 'Guayas'),
    ('091301', 'Lomas de Sargentillo', '09', 'Guayas'),
    ('091401', 'Milagro', '09', 'Guayas'),
    ('091501', 'Naranjal', '09', 'Guayas'),
    ('091601', 'Naranjito', '09', 'Guayas'),
    ('091701', 'Nobol', '09', 'Guayas'),
    ('091801', 'Palestina', '09', 'Guayas'),
    ('091901', 'Pedro Carbo', '09', 'Guayas'),
    ('092001', 'Playas', '09', 'Guayas'),
    ('092101', 'Salitre', '09', 'Guayas'),
    ('092201', 'Samborondón', '09', 'Guayas'),
    ('092301', 'Santa Lucía', '09', 'Guayas'),
    ('092401', 'Simón Bolívar', '09', 'Guayas'),
    ('092501', 'Yaguachi', '09', 'Guayas'),
    ('100101', 'Ibarra', '10', 'Imbabura'),
    ('100201', 'Antonio Ante', '10', 'Imbabura'),
    ('100301', 'Cotacachi', '10', 'Imbabura'),
    ('100401', 'Otavalo', '10', 'Imbabura'),
    ('100501', 'Pimampiro', '10', 'Imbabura'),
    ('100601', 'San Miguel de Urcuquí', '10', 'Imbabura'),
    ('110101', 'Loja', '11', 'Loja'),
    ('110201', 'Calvas', '11', 'Loja'),
    ('110301', 'Catamayo', '11', 'Loja'),
    ('110401', 'Celica', '11', 'Loja'),
    ('110501', 'Chaguarpamba', '11', 'Loja'),
    ('110601', 'Espíndola', '11', 'Loja'),
    ('110701', 'Gonzanamá', '11', 'Loja'),
    ('110801', 'Macará', '11', 'Loja'),
    ('110901', 'Paltas', '11', 'Loja'),
    ('111001', 'Pindal', '11', 'Loja'),
    ('111101', 'Puyango', '11', 'Loja'),
    ('111201', 'Quilanga', '11', 'Loja'),
    ('111301', 'Saraguro', '11', 'Loja'),
    ('111401', 'Sozoranga', '11', 'Loja'),
    ('111501', 'Zapotillo', '11', 'Loja'),
    ('111601', 'Olmedo', '11', 'Loja'),
    ('120101', 'Babahoyo', '12', 'Los Ríos'),
    ('120201', 'Baba', '12', 'Los Ríos'),
    ('120301', 'Buena Fe', '12', 'Los Ríos'),
    ('120401', 'Mocache', '12', 'Los Ríos'),
    ('120501', 'Montalvo', '12', 'Los Ríos'),
    ('120601', 'Palenque', '12', 'Los Ríos'),
    ('120701', 'Pueblo Viejo', '12', 'Los Ríos'),
    ('120801', 'Quevedo', '12', 'Los Ríos'),
    ('120901', 'Quinsaloma', '12', 'Los Ríos'),
    ('121001', 'Urdaneta', '12', 'Los Ríos'),
    ('121101', 'Valencia', '12', 'Los Ríos'),
    ('121201', 'Ventanas', '12', 'Los Ríos'),
    ('121301', 'Vinces', '12', 'Los Ríos'),
    ('130101', 'Portoviejo', '13', 'Manabí'),
    ('130201', 'Bolívar', '13', 'Manabí'),
    ('130301', 'Chone', '13', 'Manabí'),
    ('130401', 'El Carmen', '13', 'Manabí'),
    ('130501', 'Flavio Alfaro', '13', 'Manabí'),
    ('130601', 'Jipijapa', '13', 'Manabí'),
    ('130701', 'Junín', '13', 'Manabí'),
    ('130801', 'Manta', '13', 'Manabí'),
    ('130901', 'Montecristi', '13', 'Manabí'),
    ('131001', 'Olmedo', '13', 'Manabí'),
    ('131101', 'Paján', '13', 'Manabí'),
    ('131201', 'Pedernales', '13', 'Manabí'),
    ('131301', 'Pichincha', '13', 'Manabí'),
    ('131401', 'Rocafuerte', '13', 'Manabí'),
    ('131501', 'Santa Ana', '13', 'Manabí'),
    ('131601', 'Sucre', '13', 'Manabí'),
    ('131701', 'Tosagua', '13', 'Manabí'),
    ('131801', '24 de Mayo', '13', 'Manabí'),
    ('131901', 'Puerto López', '13', 'Manabí'),
    ('132001', 'Jama', '13', 'Manabí'),
    ('132101', 'Jaramijó', '13', 'Manabí'),
    ('132201', 'San Vicente', '13', 'Manabí'),
    ('140101', 'Macas', '14', 'Morona Santiago'),
    ('140201', 'Gualaquiza', '14', 'Morona Santiago'),
    ('140301', 'Limón Indanza', '14', 'Morona Santiago'),
    ('140401', 'Palora', '14', 'Morona Santiago'),
    ('140501', 'Santiago', '14', 'Morona Santiago'),
    ('140601', 'San Juan Bosco', '14', 'Morona Santiago'),
    ('140701', 'Huamboya', '14', 'Morona Santiago'),
    ('140801', 'San José de Morona', '14', 'Morona Santiago'),
    ('140901', 'Sucúa', '14', 'Morona Santiago'),
    ('141001', 'Taisha', '14', 'Morona Santiago'),
    ('141101', 'Tiwintza', '14', 'Morona Santiago'),
    ('141201', 'Pablo Sexto', '14', 'Morona Santiago'),
    ('150101', 'Tena', '15', 'Napo'),
    ('150201', 'Archidona', '15', 'Napo'),
    ('150301', 'El Chaco', '15', 'Napo'),
    ('150401', 'Quijos', '15', 'Napo'),
    ('150501', 'Carlos Julio Arosemena Tola', '15', 'Napo'),
    ('160101', 'Pastaza', '16', 'Pastaza'),
    ('160201', 'Mera', '16', 'Pastaza'),
    ('160301', 'Santa Clara', '16', 'Pastaza'),
    ('160401', 'Arajuno', '16', 'Pastaza'),
    ('170101', 'Quito', '17', 'Pichincha'),
    ('170201', 'Cayambe', '17', 'Pichincha'),
    ('170301', 'Mejía', '17', 'Pichincha'),
    ('170401', 'Pedro Moncayo', '17', 'Pichincha'),
    ('170501', 'Pedro Vicente Maldonado', '17', 'Pichincha'),
    ('170601', 'Puerto Quito', '17', 'Pichincha'),
    ('170701', 'San Miguel de Los Bancos', '17', 'Pichincha'),
    ('170801', 'Rumiñahui', '17', 'Pichincha'),
    ('180101', 'Ambato', '18', 'Tungurahua'),
    ('180201', 'Baños de Agua Santa', '18', 'Tungurahua'),
    ('180301', 'Cevallos', '18', 'Tungurahua'),
    ('180401', 'Mocha', '18', 'Tungurahua'),
    ('180501', 'Patate', '18', 'Tungurahua'),
    ('180601', 'Quero', '18', 'Tungurahua'),
    ('180701', 'San Pedro de Pelileo', '18', 'Tungurahua'),
    ('180801', 'Santiago de Píllaro', '18', 'Tungurahua'),
    ('180901', 'Tisaleo', '18', 'Tungurahua'),
    ('190101', 'Zamora', '19', 'Zamora Chinchipe'),
    ('190201', 'Chinchipe', '19', 'Zamora Chinchipe'),
    ('190301', 'El Pangui', '19', 'Zamora Chinchipe'),
    ('190401', 'Nangaritza', '19', 'Zamora Chinchipe'),
    ('190501', 'Palanda', '19', 'Zamora Chinchipe'),
    ('190601', 'Paquisha', '19', 'Zamora Chinchipe'),
    ('190701', 'Yacuambi', '19', 'Zamora Chinchipe'),
    ('190801', 'Yantzaza', '19', 'Zamora Chinchipe'),
    ('190901', 'Centinela del Cóndor', '19', 'Zamora Chinchipe'),
    ('200101', 'San Cristóbal', '20', 'Galápagos'),
    ('200201', 'Isabela', '20', 'Galápagos'),
    ('200301', 'Santa Cruz', '20', 'Galápagos'),
    ('210101', 'Lago Agrio', '21', 'Sucumbíos'),
    ('210201', 'Cascales', '21', 'Sucumbíos'),
    ('210301', 'Cuyabeno', '21', 'Sucumbíos'),
    ('210401', 'Gonzalo Pizarro', '21', 'Sucumbíos'),
    ('210501', 'Putumayo', '21', 'Sucumbíos'),
    ('210601', 'Shushufindi', '21', 'Sucumbíos'),
    ('220101', 'Francisco de Orellana', '22', 'Orellana'),
    ('220201', 'Aguarico', '22', 'Orellana'),
    ('220301', 'La Joya de los Sachas', '22', 'Orellana'),
    ('220401', 'Loreto', '22', 'Orellana'),
    ('230101', 'Santo Domingo', '23', 'Santo Domingo de los Tsáchilas'),
    ('230201', 'La Concordia', '23', 'Santo Domingo de los Tsáchilas'),
    ('240101', 'Santa Elena', '24', 'Santa Elena'),
    ('240201', 'La Libertad', '24', 'Santa Elena'),
    ('240301', 'Salinas', '24', 'Santa Elena')
ON CONFLICT (codigo) DO NOTHING;


-- ------------------------------------------------------------
-- Anuncios (núcleo)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anuncios (
    id                BIGSERIAL PRIMARY KEY,
    slug              VARCHAR(140) NOT NULL UNIQUE,   -- SEO: lavadora-samsung-15kg-a1b2c3
    pilar             VARCHAR(20)  NOT NULL
        CHECK (pilar IN ('productos', 'servicios', 'empleo')),

    titulo            VARCHAR(120) NOT NULL,
    descripcion       TEXT,                           -- opcional a propósito
    categoria_id      INT          NOT NULL REFERENCES categorias_anuncio(id),
    provincia_codigo  CHAR(2)      NOT NULL,
    canton_codigo     CHAR(6)      NOT NULL REFERENCES cantones(codigo),
    sector            VARCHAR(80),                    -- barrio / sector

    precio            NUMERIC(12, 2) CHECK (precio IS NULL OR precio >= 0),  -- NULL = "a convenir"
    moneda            CHAR(3)      NOT NULL DEFAULT 'USD',

    latitud           NUMERIC(9, 6) CHECK (latitud  IS NULL OR latitud  BETWEEN -90  AND 90),
    longitud          NUMERIC(9, 6) CHECK (longitud IS NULL OR longitud BETWEEN -180 AND 180),

    autor_usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    autor_negocio_id  UUID          REFERENCES negocios(id) ON DELETE SET NULL,

    estado            VARCHAR(20)  NOT NULL DEFAULT 'BORRADOR'
        CHECK (estado IN ('BORRADOR', 'PUBLICADO', 'PAUSADO', 'RECHAZADO', 'ELIMINADO')),
    notas_moderacion  TEXT,

    vistas            INT NOT NULL DEFAULT 0,
    contactos         INT NOT NULL DEFAULT 0,

    -- El dueño decide por anuncio si se puede pedir su número.
    mostrar_telefono  BOOLEAN NOT NULL DEFAULT FALSE,

    -- Ya se vendió. NO es un estado a propósito: un anuncio puede estar pausado y
    -- vendido a la vez, y con un solo 'estado' se perdería una de las dos cosas.
    -- Viaja aparte y el feed lo excluye con 'AND NOT vendido'.
    vendido           BOOLEAN NOT NULL DEFAULT FALSE,
    vendido_en        TIMESTAMPTZ,

    publicado_en      TIMESTAMPTZ,
    expira_en         TIMESTAMPTZ,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_en      TIMESTAMPTZ,                    -- soft delete

    -- Un anuncio publicado siempre tiene fecha.
    CONSTRAINT publicado_con_fecha CHECK (estado <> 'PUBLICADO' OR publicado_en IS NOT NULL),
    -- Coordenadas: las dos o ninguna.
    CONSTRAINT coordenadas_completas CHECK ((latitud IS NULL) = (longitud IS NULL)),
    -- Eliminado <=> tiene fecha de eliminación.
    CONSTRAINT eliminado_con_fecha CHECK ((estado = 'ELIMINADO') = (eliminado_en IS NOT NULL)),
    -- Vendido <=> tiene fecha de venta. Mismo patrón que el de eliminado: sin
    -- esto se puede marcar vendido sin fecha, y el backend no sabría desde
    -- cuándo hiding en el feed.
    CONSTRAINT vendido_con_fecha CHECK (vendido = (vendido_en IS NOT NULL))
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_anuncios_actualizado') THEN
        CREATE TRIGGER trg_anuncios_actualizado
            BEFORE UPDATE ON anuncios
            FOR EACH ROW
            EXECUTE FUNCTION set_actualizado_en();
    END IF;
END $$;


-- ------------------------------------------------------------
-- Detalle por pilar (1 a 1 con anuncios)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anuncio_producto (
    anuncio_id  BIGINT PRIMARY KEY REFERENCES anuncios(id) ON DELETE CASCADE,
    condicion   VARCHAR(20) NOT NULL CHECK (condicion IN ('NUEVO', 'USADO'))
);

CREATE TABLE IF NOT EXISTS anuncio_servicio (
    anuncio_id       BIGINT PRIMARY KEY REFERENCES anuncios(id) ON DELETE CASCADE,
    modalidad_cobro  VARCHAR(20) NOT NULL CHECK (modalidad_cobro IN ('POR_PROYECTO', 'POR_HORA')),
    zona_cobertura   VARCHAR(150)
);

-- Jornada y modalidad son cosas distintas: dos columnas, no una.
CREATE TABLE IF NOT EXISTS anuncio_empleo (
    anuncio_id  BIGINT PRIMARY KEY REFERENCES anuncios(id) ON DELETE CASCADE,
    jornada     VARCHAR(20) NOT NULL CHECK (jornada IN ('TIEMPO_COMPLETO', 'MEDIO_TIEMPO', 'POR_TEMPORADA')),
    modalidad   VARCHAR(20) NOT NULL CHECK (modalidad IN ('REMOTO', 'PRESENCIAL', 'HIBRIDO'))
);


-- ------------------------------------------------------------
-- Fotos del anuncio (0..6). La portada es orden = 0 (derivado,
-- nunca un booleano). El UNIQUE es DEFERRABLE para poder
-- reordenar/reindexar dentro de una transacción.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anuncio_fotos (
    id           BIGSERIAL PRIMARY KEY,
    anuncio_id   BIGINT       NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    storage_key  VARCHAR(255) NOT NULL,     -- clave en disco/S3, NUNCA la URL pública
    ancho        INT          NOT NULL,
    alto         INT          NOT NULL,
    bytes        INT          NOT NULL,
    mime         VARCHAR(30)  NOT NULL
        CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
    orden        SMALLINT     NOT NULL CHECK (orden BETWEEN 0 AND 5),
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_anuncio_fotos_orden UNIQUE (anuncio_id, orden) DEFERRABLE INITIALLY IMMEDIATE
);


-- ------------------------------------------------------------
-- Idempotencia de POST /api/anuncios: el mismo Idempotency-Key
-- del mismo usuario devuelve el mismo anuncio (doble toque,
-- reintento con datos móviles).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anuncio_idempotencia (
    usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    clave       VARCHAR(100) NOT NULL,
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usuario_id, clave)
);


-- ------------------------------------------------------------
-- Quién pidió el número de qué anuncio. Sirve para que el contador
-- 'contactos' sume una sola vez por (anuncio, usuario) cada hora.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anuncio_contactos (
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    ultimo_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anuncio_id, usuario_id)
);


-- ------------------------------------------------------------
-- Quién le dio like a qué anuncio.
--
-- Calcada de 'anuncio_contactos' a propósito. La clave primaria compuesta es lo
-- que hace gratis las dos cosas que importan: que nadie pueda dar dos likes al
-- mismo anuncio, y que no haga falta una columna 'me_gusta' en 'anuncios' que
-- pueda desincronizarse de las filas.
--
-- No lleva contador 'likes INT' en anuncios a diferencia de 'vistas' y
-- 'contactos'. Esos dos se suben con una llamada cada vez y no se leen con el
-- anuncio; los likes se piden siempre junto al anuncio, y COUNT(*) agrupado de
-- los ids de una página es una consulta más y siempre exacto. Un contador
-- desnormalizado solo añade formas de que se desvíe de la verdad.
--
-- Exige sesión: un like tiene que ser atribuible a alguien, o el mismo usuario
-- puede repetirlo mil veces y el contador no significa nada.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anuncio_likes (
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anuncio_id, usuario_id)
);


-- ------------------------------------------------------------
-- Índices
-- ------------------------------------------------------------
-- El feed: filtrado por pilar y ordenado por fecha. Parcial: no paga por borradores
-- ni por los ya vendidos, que es el caso más común de un marketplace maduro.
--
-- OJO: si la base ya tenía este índice sin `AND NOT vendido`, hay que rehacerlo
-- con DROP primero. Un índice parcial que no cubre el WHERE de la consulta no
-- está simplemente inútil: PostgreSQL lo ignora y filtra fila por fila en cada
-- petición al feed, que es justo lo que pasa cuando el filtro y el índice no
-- coinciden.
DROP INDEX IF EXISTS idx_anuncios_feed;
CREATE INDEX IF NOT EXISTS idx_anuncios_feed ON anuncios (pilar, publicado_en DESC, id DESC)
    WHERE estado = 'PUBLICADO' AND eliminado_en IS NULL AND NOT vendido;

-- Búsqueda por texto.
CREATE INDEX IF NOT EXISTS idx_anuncios_titulo ON anuncios USING GIN (to_tsvector('spanish', titulo));

-- "Mis anuncios" y filtro por cantón.
-- Incluye id DESC para casar exacto con el ORDER BY / cursor de GET /api/anuncios/mios.
CREATE INDEX IF NOT EXISTS idx_anuncios_autor ON anuncios (autor_usuario_id, creado_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_anuncios_geo   ON anuncios (canton_codigo, publicado_en DESC);
CREATE INDEX IF NOT EXISTS idx_anuncios_categoria ON anuncios (categoria_id);

CREATE INDEX IF NOT EXISTS idx_anuncio_fotos_anuncio ON anuncio_fotos (anuncio_id, orden);

-- Los likes de un anuncio concreto, para la cuenta y para el INSERT/DELETE.
-- La PK compuesta ya cubre `WHERE anuncio_id = ?` porque va su columna primera,
-- así que este índice solo hace falta si se cuenta por anuncio muy a menudo.
-- CREATE INDEX IF NOT EXISTS idx_anuncio_likes_anuncio ON anuncio_likes (anuncio_id);

-- "Mis anuncios" ordenado por fecha, para no escanear los vendidos.
CREATE INDEX IF NOT EXISTS idx_anuncios_venta ON anuncios (autor_usuario_id, vendido);


-- ============================================================
-- Perfil público: foto de portada y seguidores
-- ============================================================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_portada TEXT;

CREATE TABLE IF NOT EXISTS seguidores (
    seguidor_id UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    seguido_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (seguidor_id, seguido_id),
    CONSTRAINT no_seguirse_a_si_mismo CHECK (seguidor_id <> seguido_id)
);

-- La PK cubre "a quién sigo" (seguidor_id primero); este índice cubre "quién me sigue".
CREATE INDEX IF NOT EXISTS idx_seguidores_seguido ON seguidores (seguido_id, creado_en DESC);


-- ============================================================
-- Perfil público: privacidad (qué ve alguien que no es el dueño)
-- Objeto jsonb con booleanos: vendidos, me_gusta, seguidores, ubicacion,
-- miembro_desde, direccion, horario, redes, contacto_negocio.
-- Clave ausente = visible, así que '{}' es un perfil completo.
-- ============================================================
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS privacidad_perfil JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN usuarios.privacidad_perfil IS
    'Qué partes del perfil público se ocultan a los visitantes. Clave ausente = visible.';


-- ============================================================
-- Empleo: postulaciones con CV
-- Una persona se postula una sola vez a cada vacante. El CV es un PDF que se
-- guarda FUERA de /uploads (carpeta privada): solo lo descargan el dueño de la
-- vacante y quien se postuló, a través de la API y con sesión.
-- ============================================================
CREATE TABLE IF NOT EXISTS postulaciones (
    id              BIGSERIAL PRIMARY KEY,
    anuncio_id      BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    postulante_id   UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    mensaje         VARCHAR(1500),
    telefono        VARCHAR(20),
    cv_key          TEXT        NOT NULL,   -- ruta relativa dentro de la carpeta privada
    cv_nombre       VARCHAR(160) NOT NULL,  -- nombre original, para la descarga
    cv_bytes        INTEGER     NOT NULL,
    -- NUEVA → VISTA al abrirla; PRESELECCIONADA / DESCARTADA / CONTRATADA las decide el dueño.
    estado          VARCHAR(20) NOT NULL DEFAULT 'NUEVA'
        CHECK (estado IN ('NUEVA', 'VISTA', 'PRESELECCIONADA', 'DESCARTADA', 'CONTRATADA')),
    nota_interna    VARCHAR(1000),          -- solo la ve el dueño de la vacante
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (anuncio_id, postulante_id)
);

-- Bandeja del dueño: por vacante y más recientes primero.
CREATE INDEX IF NOT EXISTS idx_postulaciones_anuncio ON postulaciones (anuncio_id, creado_en DESC);
-- "Mis postulaciones" de quien busca trabajo.
CREATE INDEX IF NOT EXISTS idx_postulaciones_postulante ON postulaciones (postulante_id, creado_en DESC);

DROP TRIGGER IF EXISTS trg_postulaciones_actualizado ON postulaciones;
CREATE TRIGGER trg_postulaciones_actualizado
    BEFORE UPDATE ON postulaciones
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();


-- ============================================================
-- Búsqueda y filtros del feed
-- ============================================================
-- Orden por precio (más baratos / más caros) sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS idx_anuncios_precio ON anuncios (precio, id)
    WHERE estado = 'PUBLICADO' AND eliminado_en IS NULL AND NOT vendido;


-- ============================================================
-- Guardados: los anuncios que cada persona se guarda para después
-- ============================================================
CREATE TABLE IF NOT EXISTS anuncio_guardados (
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anuncio_id, usuario_id)
);

-- "Mis guardados" de más reciente a más antiguo.
CREATE INDEX IF NOT EXISTS idx_guardados_usuario ON anuncio_guardados (usuario_id, creado_en DESC);


-- ============================================================
-- Vistas reales: una por persona y anuncio cada 24 horas
-- 'visitante' es 'u:<id de usuario>' con sesión, o 'a:<huella>' sin ella
-- (hash de IP + navegador, nunca la IP en claro). La del dueño no cuenta.
-- anuncios.vistas sigue siendo el total que se muestra; esta tabla solo
-- evita que recargar la página infle el número.
-- ============================================================
CREATE TABLE IF NOT EXISTS anuncio_vistas (
    anuncio_id  BIGINT      NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    visitante   VARCHAR(80) NOT NULL,
    ultimo_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anuncio_id, visitante)
);


-- ============================================================
-- Búsqueda tolerante: sin tildes, palabras a medias y errores de tipeo
-- pg_trgm compara por trigramas ("iphon" ~ "iphone", "computadra" ~
-- "computadora"); unaccent quita tildes ("telefono" = "teléfono").
-- f_unaccent existe porque unaccent() no es IMMUTABLE y un índice lo exige.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Título normalizado (minúsculas y sin tildes) indexado por trigramas.
CREATE INDEX IF NOT EXISTS idx_anuncios_titulo_trgm
    ON anuncios USING gin (f_unaccent(lower(titulo)) gin_trgm_ops);


-- ============================================================
-- Chat: conversaciones privadas entre dos personas
-- Hay UNA conversación por par de personas (el índice único usa LEAST/
-- GREATEST para que A→B y B→A sean la misma), aunque se hable de varios
-- anuncios: conversaciones.anuncio_id es el anuncio del que se habla ahora,
-- y cada mensaje guarda en mensajes.anuncio_id sobre cuál se escribió.
-- Los mensajes son texto plano; el frontend nunca los pinta como HTML.
-- Esta sección también migra la primera versión del chat (una conversación
-- por anuncio): fusiona las del mismo par sin perder ningún mensaje.
-- ============================================================
CREATE TABLE IF NOT EXISTS conversaciones (
    id                 BIGSERIAL PRIMARY KEY,
    iniciador_id       UUID   NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    destinatario_id    UUID   NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    -- El anuncio del que se habla ahora. Si se borrara, la conversación sigue.
    anuncio_id         BIGINT REFERENCES anuncios(id) ON DELETE SET NULL,
    -- Copia del último mensaje para listar sin recorrer 'mensajes'.
    ultimo_mensaje_id  BIGINT,
    ultimo_mensaje_en  TIMESTAMPTZ,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT conversacion_entre_dos CHECK (iniciador_id <> destinatario_id)
);

-- Primera versión: al borrar un anuncio se borraba su conversación. Con una
-- conversación por par eso borraría todo el historial de esas dos personas.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversaciones_anuncio_id_fkey' AND confdeltype = 'c') THEN
        ALTER TABLE conversaciones DROP CONSTRAINT conversaciones_anuncio_id_fkey;
        ALTER TABLE conversaciones ADD CONSTRAINT conversaciones_anuncio_id_fkey
            FOREIGN KEY (anuncio_id) REFERENCES anuncios(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS mensajes (
    id               BIGSERIAL PRIMARY KEY,
    conversacion_id  BIGINT        NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
    remitente_id     UUID          NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    contenido        VARCHAR(2000) NOT NULL CHECK (char_length(btrim(contenido)) > 0),
    -- Lo genera el navegador al enviar: si el envío se reintenta tras una
    -- reconexión, el UNIQUE evita guardar el mismo mensaje dos veces.
    cliente_id       VARCHAR(64)   NOT NULL,
    -- Sobre qué anuncio se escribió (lo pone el servidor, no el navegador).
    anuncio_id       BIGINT        REFERENCES anuncios(id) ON DELETE SET NULL,
    creado_en        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    -- Llegó a algún dispositivo del destinatario / lo abrió en la conversación.
    entregado_en     TIMESTAMPTZ,
    leido_en         TIMESTAMPTZ,
    CONSTRAINT leido_implica_entregado CHECK (leido_en IS NULL OR entregado_en IS NOT NULL),
    UNIQUE (remitente_id, cliente_id)
);

ALTER TABLE mensajes
    ADD COLUMN IF NOT EXISTS anuncio_id BIGINT REFERENCES anuncios(id) ON DELETE SET NULL;

-- Migración de la primera versión (una conversación por anuncio). Solo corre
-- si todavía existe su índice, así que ejecutar el script otra vez no la repite.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_conversaciones_par_anuncio') THEN
        -- 1) Cada mensaje recuerda el anuncio de la conversación en la que estaba.
        UPDATE mensajes m SET anuncio_id = c.anuncio_id
        FROM conversaciones c
        WHERE c.id = m.conversacion_id AND m.anuncio_id IS NULL AND c.anuncio_id IS NOT NULL;

        -- 2) La conversación más antigua de cada par se queda con los mensajes
        --    de las demás, y las demás se borran (ya vacías).
        CREATE TEMP TABLE chat_fusion AS
        SELECT id,
               MIN(id) OVER (PARTITION BY LEAST(iniciador_id, destinatario_id),
                                          GREATEST(iniciador_id, destinatario_id)) AS destino
        FROM conversaciones;
        DELETE FROM chat_fusion WHERE id = destino;

        UPDATE mensajes m SET conversacion_id = f.destino FROM chat_fusion f WHERE m.conversacion_id = f.id;
        DELETE FROM conversaciones c USING chat_fusion f WHERE c.id = f.id;
        DROP TABLE chat_fusion;

        -- 3) Último mensaje y anuncio del que se habló al final, ya fusionados.
        UPDATE conversaciones c
        SET ultimo_mensaje_id = u.id,
            ultimo_mensaje_en = u.creado_en,
            anuncio_id = COALESCE(u.anuncio_id, c.anuncio_id)
        FROM (SELECT DISTINCT ON (conversacion_id) conversacion_id, id, creado_en, anuncio_id
              FROM mensajes
              ORDER BY conversacion_id, id DESC) u
        WHERE u.conversacion_id = c.id;

        DROP INDEX uq_conversaciones_par_anuncio;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversaciones_par ON conversaciones (
    LEAST(iniciador_id, destinatario_id),
    GREATEST(iniciador_id, destinatario_id)
);
-- La bandeja de cada participante, de la más reciente a la más antigua.
CREATE INDEX IF NOT EXISTS idx_conversaciones_iniciador ON conversaciones (iniciador_id, ultimo_mensaje_en DESC);
CREATE INDEX IF NOT EXISTS idx_conversaciones_destinatario ON conversaciones (destinatario_id, ultimo_mensaje_en DESC);

DROP TRIGGER IF EXISTS trg_conversaciones_actualizado ON conversaciones;
CREATE TRIGGER trg_conversaciones_actualizado
    BEFORE UPDATE ON conversaciones
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();

-- El historial se pagina hacia atrás por id.
CREATE INDEX IF NOT EXISTS idx_mensajes_conversacion ON mensajes (conversacion_id, id DESC);
-- Contador de no leídos: solo recorre lo que falta leer.
CREATE INDEX IF NOT EXISTS idx_mensajes_sin_leer ON mensajes (conversacion_id, remitente_id) WHERE leido_en IS NULL;
-- Acuses de entrega al conectarse: solo lo que todavía no llegó.
CREATE INDEX IF NOT EXISTS idx_mensajes_sin_entregar ON mensajes (conversacion_id) WHERE entregado_en IS NULL;

-- Bloqueos: quien bloquea deja de recibir mensajes de esa persona, y ninguno
-- de los dos puede escribir en su conversación hasta que se desbloquee.
CREATE TABLE IF NOT EXISTS bloqueos (
    bloqueador_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    bloqueado_id   UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bloqueador_id, bloqueado_id),
    CONSTRAINT bloqueo_a_otro CHECK (bloqueador_id <> bloqueado_id)
);

-- "¿Me bloqueó?" se pregunta desde el lado del bloqueado.
CREATE INDEX IF NOT EXISTS idx_bloqueos_bloqueado ON bloqueos (bloqueado_id);


-- ============================================================
-- Notificaciones: historial de la campana, push (FCM) y preferencias
-- El backend las genera; se reparten en vivo por el WebSocket del chat y,
-- si la persona no tiene la app abierta, por push a sus dispositivos.
--  · clave_grupo: las repetitivas (likes, seguidores, mensajes) se juntan en
--    UNA notificación sin leer que va sumando personas ("Ana y 3 más…").
--    actores evita contar dos veces a la misma persona.
--  · clave_unica: las que solo deben existir una vez (p. ej. un vencimiento).
--  · despachada_en NULL: la insertó la propia base (trigger de moderación) y
--    la tarea del backend todavía no la repartió.
-- El texto no se guarda: se arma al leer, con los nombres y títulos al día.
-- ============================================================
CREATE TABLE IF NOT EXISTS notificaciones (
    id               BIGSERIAL PRIMARY KEY,
    usuario_id       UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo             VARCHAR(30) NOT NULL CHECK (tipo IN (
                         'SEGUIDOR', 'ME_GUSTA', 'COMENTARIO', 'RESPUESTA', 'GUARDADO', 'MENSAJE',
                         'ANUNCIO_APROBADO', 'ANUNCIO_RECHAZADO', 'ANUNCIO_VENCIDO',
                         'NUEVA_VACANTE', 'POSTULACION_NUEVA', 'POSTULACION_ESTADO', 'CV_REVISADO',
                         'SEGURIDAD')),
    -- La última persona que hizo algo, y todas las del grupo (sin repetir).
    actor_id         UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
    actores          UUID[]      NOT NULL DEFAULT '{}',
    cantidad         INTEGER     NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    anuncio_id       BIGINT      REFERENCES anuncios(id) ON DELETE CASCADE,
    conversacion_id  BIGINT      REFERENCES conversaciones(id) ON DELETE CASCADE,
    postulacion_id   BIGINT      REFERENCES postulaciones(id) ON DELETE CASCADE,
    -- Detalles que no son relaciones (el nuevo estado, el evento de seguridad…).
    datos            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    clave_grupo      VARCHAR(120),
    clave_unica      VARCHAR(160),
    creada_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizada_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leida_en         TIMESTAMPTZ,
    despachada_en    TIMESTAMPTZ,
    push_enviado_en  TIMESTAMPTZ
);

-- Una sola notificación abierta (sin leer) por grupo: al leerla, la siguiente
-- empieza un grupo nuevo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_grupo_abierto
    ON notificaciones (usuario_id, clave_grupo)
    WHERE leida_en IS NULL AND clave_grupo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_clave
    ON notificaciones (usuario_id, clave_unica)
    WHERE clave_unica IS NOT NULL;
-- El historial de la campana, de la más reciente a la más antigua.
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones (usuario_id, actualizada_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas ON notificaciones (usuario_id) WHERE leida_en IS NULL;
-- Las que insertó la base y faltan por repartir.
CREATE INDEX IF NOT EXISTS idx_notificaciones_pendientes ON notificaciones (id) WHERE despachada_en IS NULL;

-- Dispositivos con push activado (un token FCM por navegador). El token es
-- del navegador: si otra cuenta entra en él y activa el push, pasa a ella.
CREATE TABLE IF NOT EXISTS dispositivos_push (
    id              BIGSERIAL PRIMARY KEY,
    usuario_id      UUID         NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token           TEXT         NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 20 AND 4096),
    plataforma      VARCHAR(20)  NOT NULL DEFAULT 'web' CHECK (plataforma IN ('web')),
    navegador       VARCHAR(160),
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_push_usuario ON dispositivos_push (usuario_id);

-- Preferencias. categorias = {"seguidores": {"app": true, "push": false}, …};
-- una categoría o canal ausente cuenta como activado. El sonido es el de los
-- avisos dentro de la app; con 'ninguno' el push también llega en silencio.
CREATE TABLE IF NOT EXISTS notificacion_preferencias (
    usuario_id      UUID        PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    categorias      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sonido          VARCHAR(20) NOT NULL DEFAULT 'campana'
        CHECK (sonido IN ('ninguno', 'campana', 'burbuja', 'pop', 'marimba')),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Moderación: no hay un panel en la API, así que el aviso lo genera la base
-- al cambiar el estado de un anuncio, venga de donde venga el cambio. El
-- dueño no puede rechazar su propio anuncio ni sacarlo de RECHAZADO por la
-- API, así que estas transiciones solo las hace quien modera.
CREATE OR REPLACE FUNCTION notificar_moderacion_anuncio()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado = 'RECHAZADO' THEN
        INSERT INTO notificaciones (usuario_id, tipo, anuncio_id)
        VALUES (NEW.autor_usuario_id, 'ANUNCIO_RECHAZADO', NEW.id);
    ELSIF OLD.estado = 'RECHAZADO' AND NEW.estado = 'PUBLICADO' THEN
        INSERT INTO notificaciones (usuario_id, tipo, anuncio_id)
        VALUES (NEW.autor_usuario_id, 'ANUNCIO_APROBADO', NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_anuncios_moderacion ON anuncios;
CREATE TRIGGER trg_anuncios_moderacion
    AFTER UPDATE OF estado ON anuncios
    FOR EACH ROW
    WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
    EXECUTE FUNCTION notificar_moderacion_anuncio();


-- ============================================================
-- Moderación y panel de administración
--  · Los administradores son cuentas aparte de los usuarios del marketplace:
--    ningún token de usuario sirve en el panel, ni al revés.
--  · Sesiones del panel: token opaco en cookie HttpOnly, guardado como hash.
--    Desactivar a alguien o "cerrar sesiones" corta el acceso al instante.
--  · Moderación por reglas (sin IA): términos que mandan a revisión o
--    bloquean, categorías prohibidas, revisión de cuentas nuevas y denuncias.
-- ============================================================

-- Estado nuevo: en revisión. Nunca es público (lo público es solo PUBLICADO).
ALTER TABLE anuncios DROP CONSTRAINT IF EXISTS anuncios_estado_check;
ALTER TABLE anuncios ADD CONSTRAINT anuncios_estado_check
    CHECK (estado IN ('BORRADOR', 'PENDIENTE_REVISION', 'PUBLICADO', 'PAUSADO', 'RECHAZADO', 'ELIMINADO'));

-- Una pausa puesta por moderación: el dueño no puede reanudarla.
ALTER TABLE anuncios ADD COLUMN IF NOT EXISTS pausa_administrativa BOOLEAN NOT NULL DEFAULT FALSE;
-- Por qué está en revisión (códigos de regla), para quien modera.
ALTER TABLE anuncios ADD COLUMN IF NOT EXISTS motivo_revision VARCHAR(200);
CREATE INDEX IF NOT EXISTS idx_anuncios_pendientes ON anuncios (creado_en) WHERE estado = 'PENDIENTE_REVISION';

-- Aprobar un anuncio que esperaba revisión también se avisa al dueño.
CREATE OR REPLACE FUNCTION notificar_moderacion_anuncio()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado = 'RECHAZADO' THEN
        INSERT INTO notificaciones (usuario_id, tipo, anuncio_id)
        VALUES (NEW.autor_usuario_id, 'ANUNCIO_RECHAZADO', NEW.id);
    ELSIF OLD.estado IN ('RECHAZADO', 'PENDIENTE_REVISION') AND NEW.estado = 'PUBLICADO' THEN
        INSERT INTO notificaciones (usuario_id, tipo, anuncio_id)
        VALUES (NEW.autor_usuario_id, 'ANUNCIO_APROBADO', NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS administradores (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                   VARCHAR(120) NOT NULL,
    correo                   CITEXT       NOT NULL,
    contrasena_hash          TEXT         NOT NULL,
    -- Tiene todos los permisos y nadie más puede tocarlo. Hay uno solo.
    es_super                 BOOLEAN      NOT NULL DEFAULT FALSE,
    activo                   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Las contraseñas temporales (inicial y restablecidas) obligan a cambiarla.
    debe_cambiar_contrasena  BOOLEAN      NOT NULL DEFAULT TRUE,
    intentos_fallidos        INTEGER      NOT NULL DEFAULT 0,
    bloqueado_hasta          TIMESTAMPTZ,
    ultimo_acceso_en         TIMESTAMPTZ,
    contrasena_cambiada_en   TIMESTAMPTZ,
    creado_por               UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    creado_en                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_en           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Revocado: no se borra para conservar su rastro en la auditoría.
    eliminado_en             TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_administradores_correo ON administradores (correo) WHERE eliminado_en IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_administradores_super ON administradores (es_super) WHERE es_super AND eliminado_en IS NULL;

DROP TRIGGER IF EXISTS trg_administradores_actualizado ON administradores;
CREATE TRIGGER trg_administradores_actualizado
    BEFORE UPDATE ON administradores
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();

CREATE TABLE IF NOT EXISTS administrador_permisos (
    admin_id      UUID        NOT NULL REFERENCES administradores(id) ON DELETE CASCADE,
    permiso       VARCHAR(40) NOT NULL CHECK (permiso IN (
                      'anuncios.ver', 'anuncios.aprobar', 'anuncios.rechazar', 'anuncios.pausar', 'anuncios.eliminar',
                      'usuarios.ver', 'usuarios.suspender', 'usuarios.reactivar',
                      'denuncias.ver', 'denuncias.resolver',
                      'estadisticas.ver', 'administradores.gestionar', 'permisos.gestionar',
                      'moderacion.configurar', 'auditoria.ver')),
    otorgado_por  UUID        REFERENCES administradores(id) ON DELETE SET NULL,
    otorgado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (admin_id, permiso)
);

CREATE TABLE IF NOT EXISTS sesiones_admin (
    id             BIGSERIAL    PRIMARY KEY,
    admin_id       UUID         NOT NULL REFERENCES administradores(id) ON DELETE CASCADE,
    token_hash     TEXT         NOT NULL UNIQUE,
    ip             VARCHAR(64),
    user_agent     VARCHAR(255),
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ultimo_uso_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expira_en      TIMESTAMPTZ  NOT NULL,
    revocada_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sesiones_admin_admin ON sesiones_admin (admin_id) WHERE revocada_en IS NULL;

-- Todo lo que hace un administrador queda aquí, con quién, qué y cuándo.
CREATE TABLE IF NOT EXISTS auditoria_admin (
    id             BIGSERIAL    PRIMARY KEY,
    admin_id       UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    accion         VARCHAR(60)  NOT NULL,
    objetivo_tipo  VARCHAR(30),
    objetivo_id    VARCHAR(64),
    detalle        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    ip             VARCHAR(64),
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_admin_fecha ON auditoria_admin (creado_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_admin_admin ON auditoria_admin (admin_id, creado_en DESC);

-- Configuración de la moderación (una sola fila).
CREATE TABLE IF NOT EXISTS moderacion_config (
    id                        SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision_usuarios_nuevos  BOOLEAN      NOT NULL DEFAULT FALSE,
    dias_usuario_nuevo        INTEGER      NOT NULL DEFAULT 7 CHECK (dias_usuario_nuevo BETWEEN 1 AND 365),
    -- Denuncias de personas distintas que mandan un anuncio a revisión.
    umbral_denuncias          INTEGER      NOT NULL DEFAULT 3 CHECK (umbral_denuncias BETWEEN 1 AND 100),
    categorias_prohibidas     INTEGER[]    NOT NULL DEFAULT '{}',
    actualizado_por           UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    actualizado_en            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
INSERT INTO moderacion_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Diccionario: REVISION manda el anuncio a revisión manual; BLOQUEO no deja
-- publicarlo. El término se guarda normalizado (minúsculas, sin tildes).
CREATE TABLE IF NOT EXISTS moderacion_palabras (
    id          SERIAL       PRIMARY KEY,
    termino     VARCHAR(80)  NOT NULL UNIQUE,
    nivel       VARCHAR(10)  NOT NULL CHECK (nivel IN ('REVISION', 'BLOQUEO')),
    creado_por  UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- Lista inicial de ejemplo: se edita desde el panel.
INSERT INTO moderacion_palabras (termino, nivel) VALUES
    ('cocaina', 'BLOQUEO'), ('marihuana', 'BLOQUEO'), ('arma de fuego', 'BLOQUEO'),
    ('municiones', 'BLOQUEO'), ('documentos falsos', 'BLOQUEO'), ('cedula falsa', 'BLOQUEO'),
    ('titulo falso', 'BLOQUEO'),
    ('replica', 'REVISION'), ('imitacion', 'REVISION'), ('sin receta', 'REVISION'),
    ('inversion garantizada', 'REVISION'), ('ganancias aseguradas', 'REVISION'),
    ('trabajo desde casa', 'REVISION'), ('pistola', 'REVISION'), ('fauna silvestre', 'REVISION')
ON CONFLICT (termino) DO NOTHING;

-- Historial de moderación de cada anuncio: qué pasó, por qué y quién
-- (admin_id NULL = lo decidió una regla automática).
CREATE TABLE IF NOT EXISTS moderacion_eventos (
    id               BIGSERIAL    PRIMARY KEY,
    anuncio_id       BIGINT       REFERENCES anuncios(id) ON DELETE CASCADE,
    usuario_id       UUID         REFERENCES usuarios(id) ON DELETE CASCADE,
    accion           VARCHAR(30)  NOT NULL CHECK (accion IN (
                         'ENVIADO_A_REVISION', 'BLOQUEADO', 'APROBADO', 'RECHAZADO', 'PAUSADO',
                         'ELIMINADO', 'DENUNCIAS_DESESTIMADAS', 'REENVIADO')),
    estado_anterior  VARCHAR(20),
    estado_nuevo     VARCHAR(20),
    motivo           VARCHAR(40),
    nota             TEXT,
    admin_id         UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    detalle          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    creado_en        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderacion_eventos_anuncio ON moderacion_eventos (anuncio_id, creado_en DESC);

-- Denuncias de usuarios. Una por persona y anuncio.
CREATE TABLE IF NOT EXISTS denuncias (
    id              BIGSERIAL    PRIMARY KEY,
    anuncio_id      BIGINT       NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
    denunciante_id  UUID         NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    motivo          VARCHAR(30)  NOT NULL CHECK (motivo IN (
                        'PROHIBIDO', 'ESTAFA', 'OFENSIVO', 'FALSO', 'DUPLICADO', 'OTRO')),
    detalle         VARCHAR(500),
    estado          VARCHAR(15)  NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'RESUELTA', 'DESESTIMADA')),
    resuelta_por    UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    resuelta_en     TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (anuncio_id, denunciante_id)
);
CREATE INDEX IF NOT EXISTS idx_denuncias_pendientes ON denuncias (anuncio_id) WHERE estado = 'PENDIENTE';


-- ============================================================
-- Soporte: un hilo por usuario con el equipo de Baknazo
--  · El usuario escribe desde la app; responde quien tenga el permiso
--    soporte.responder en el panel. El usuario nunca ve qué administrador
--    respondió: para él siempre es "Soporte Baknazo".
--  · Al abrir el hilo (o reabrirlo tras resolverse) el sistema contesta solo
--    que un administrador responderá: autor SISTEMA.
--  · leido_en es "lo leyó el otro lado": el equipo lee lo del usuario y el
--    usuario lee lo del equipo y del sistema.
-- ============================================================
CREATE TABLE IF NOT EXISTS soporte_hilos (
    usuario_id         UUID         PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    estado             VARCHAR(10)  NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'RESUELTO')),
    creado_en          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ultimo_mensaje_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resuelto_por       UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    resuelto_en        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_soporte_hilos_estado ON soporte_hilos (estado, ultimo_mensaje_en DESC);

CREATE TABLE IF NOT EXISTS soporte_mensajes (
    id          BIGSERIAL    PRIMARY KEY,
    usuario_id  UUID         NOT NULL REFERENCES soporte_hilos(usuario_id) ON DELETE CASCADE,
    autor       VARCHAR(10)  NOT NULL CHECK (autor IN ('USUARIO', 'ADMIN', 'SISTEMA')),
    -- Quién respondió (solo autor ADMIN). Lo ve el panel, nunca el usuario.
    admin_id    UUID         REFERENCES administradores(id) ON DELETE SET NULL,
    contenido   TEXT         NOT NULL CHECK (char_length(contenido) BETWEEN 1 AND 2000),
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    leido_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_soporte_mensajes_hilo ON soporte_mensajes (usuario_id, id DESC);
-- Lo que espera respuesta del equipo (el contador del panel).
CREATE INDEX IF NOT EXISTS idx_soporte_sin_leer_equipo ON soporte_mensajes (usuario_id)
    WHERE autor = 'USUARIO' AND leido_en IS NULL;

-- Nuevo permiso del panel.
ALTER TABLE administrador_permisos DROP CONSTRAINT IF EXISTS administrador_permisos_permiso_check;
ALTER TABLE administrador_permisos ADD CONSTRAINT administrador_permisos_permiso_check CHECK (permiso IN (
    'anuncios.ver', 'anuncios.aprobar', 'anuncios.rechazar', 'anuncios.pausar', 'anuncios.eliminar',
    'usuarios.ver', 'usuarios.suspender', 'usuarios.reactivar',
    'denuncias.ver', 'denuncias.resolver',
    'estadisticas.ver', 'administradores.gestionar', 'permisos.gestionar',
    'moderacion.configurar', 'auditoria.ver',
    'soporte.responder'));

-- Nuevo tipo de notificación: respondió el equipo de soporte.
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (tipo IN (
    'SEGUIDOR', 'ME_GUSTA', 'COMENTARIO', 'RESPUESTA', 'GUARDADO', 'MENSAJE',
    'ANUNCIO_APROBADO', 'ANUNCIO_RECHAZADO', 'ANUNCIO_VENCIDO',
    'NUEVA_VACANTE', 'POSTULACION_NUEVA', 'POSTULACION_ESTADO', 'CV_REVISADO',
    'SEGURIDAD', 'SOPORTE'));


