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
