const pool = require('../config/db');

// Columnas y joins comunes: anuncio + categoría + cantón + detalle del pilar + autor + portada.
const SELECT_BASE = `
    SELECT a.*,
           c.nombre AS categoria_nombre, c.slug AS categoria_slug,
           ca.nombre AS canton_nombre, ca.provincia_nombre,
           ap.condicion,
           asv.modalidad_cobro, asv.zona_cobertura,
           ae.jornada, ae.modalidad,
           u.nombres AS autor_nombres, u.apellidos AS autor_apellidos,
           u.foto_perfil AS autor_foto, u.correo_verificado AS autor_verificado, u.estado AS autor_estado,
           -- Los teléfonos solo se usan para calcular telefonoVisible y en el reveal
           -- de contacto; los serializadores del servicio nunca los copian a la respuesta.
           u.telefono AS autor_telefono,
           n.nombre_comercial AS negocio_nombre, n.logo_url AS negocio_logo,
           n.telefono AS negocio_telefono, n.whatsapp AS negocio_whatsapp,
           f0.storage_key AS portada_key, f0.ancho AS portada_ancho, f0.alto AS portada_alto,
           (SELECT COUNT(*) FROM anuncio_likes l WHERE l.anuncio_id = a.id)::int AS likes
    FROM anuncios a
    JOIN categorias_anuncio c ON c.id = a.categoria_id
    JOIN cantones ca ON ca.codigo = a.canton_codigo
    JOIN usuarios u ON u.id = a.autor_usuario_id
    LEFT JOIN negocios n ON n.id = a.autor_negocio_id
    LEFT JOIN anuncio_producto ap ON ap.anuncio_id = a.id
    LEFT JOIN anuncio_servicio asv ON asv.anuncio_id = a.id
    LEFT JOIN anuncio_empleo ae ON ae.anuncio_id = a.id
    LEFT JOIN anuncio_fotos f0 ON f0.anuncio_id = a.id AND f0.orden = 0`;

// Lo que el público puede ver.
// Lo público es solo lo PUBLICADO (nunca en revisión ni rechazado) y de
// cuentas activas: suspender a alguien oculta todos sus anuncios.
const VISIBLE = `a.estado = 'PUBLICADO' AND a.eliminado_en IS NULL AND (a.expira_en IS NULL OR a.expira_en > NOW())
    AND EXISTS (SELECT 1 FROM usuarios ua WHERE ua.id = a.autor_usuario_id AND ua.estado = 'ACTIVO')`;

// Distancia en km (haversine) entre el anuncio y el punto ($lat, $lng).
const distanciaSql = (pLat, pLng) => `
    CASE WHEN a.latitud IS NULL THEN NULL ELSE
        6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(a.latitud::float8 - ${pLat}::float8) / 2), 2) +
            COS(RADIANS(${pLat}::float8)) * COS(RADIANS(a.latitud::float8)) *
            POWER(SIN(RADIANS(a.longitud::float8 - ${pLng}::float8) / 2), 2)
        ))
    END`;

const insertar = async (client, d) => {
    const { rows } = await client.query(
        `INSERT INTO anuncios (
             slug, pilar, titulo, descripcion, categoria_id, provincia_codigo, canton_codigo, sector,
             precio, latitud, longitud, autor_usuario_id, autor_negocio_id, mostrar_telefono,
             estado, publicado_en, motivo_revision
         )
         -- La moderación decide: PUBLICADO sale ya; PENDIENTE_REVISION espera
         -- a un administrador y no tiene fecha de publicación.
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::text,
                 CASE WHEN $15::text = 'PUBLICADO' THEN date_trunc('milliseconds', NOW()) END, $16)
         RETURNING id`,
        [
            d.slug,
            d.pilar,
            d.titulo,
            d.descripcion,
            d.categoriaId,
            d.provinciaCodigo,
            d.cantonCodigo,
            d.sector,
            d.precio,
            d.latitud,
            d.longitud,
            d.autorUsuarioId,
            d.autorNegocioId,
            d.mostrarTelefono,
            d.estado || 'PUBLICADO',
            d.motivoRevision ?? null,
        ]
    );
    return rows[0].id;
};

// Inserta o reemplaza el detalle del pilar.
const guardarDetalle = async (client, pilar, anuncioId, detalle) => {
    if (pilar === 'productos') {
        await client.query(
            `INSERT INTO anuncio_producto (anuncio_id, condicion) VALUES ($1, $2)
             ON CONFLICT (anuncio_id) DO UPDATE SET condicion = EXCLUDED.condicion`,
            [anuncioId, detalle.condicion]
        );
    } else if (pilar === 'servicios') {
        await client.query(
            `INSERT INTO anuncio_servicio (anuncio_id, modalidad_cobro, zona_cobertura) VALUES ($1, $2, $3)
             ON CONFLICT (anuncio_id) DO UPDATE
                 SET modalidad_cobro = EXCLUDED.modalidad_cobro, zona_cobertura = EXCLUDED.zona_cobertura`,
            [anuncioId, detalle.modalidadCobro, detalle.zonaCobertura]
        );
    } else if (pilar === 'empleo') {
        await client.query(
            `INSERT INTO anuncio_empleo (anuncio_id, jornada, modalidad) VALUES ($1, $2, $3)
             ON CONFLICT (anuncio_id) DO UPDATE SET jornada = EXCLUDED.jornada, modalidad = EXCLUDED.modalidad`,
            [anuncioId, detalle.jornada, detalle.modalidad]
        );
    }
};

const insertarFoto = async (client, anuncioId, foto, orden) => {
    await client.query(
        `INSERT INTO anuncio_fotos (anuncio_id, storage_key, ancho, alto, bytes, mime, orden)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [anuncioId, foto.storageKey, foto.ancho, foto.alto, foto.bytes, foto.mime, orden]
    );
};

const listarFotos = async (anuncioId, client) => {
    const db = client || pool;
    const { rows } = await db.query(
        `SELECT id, storage_key, ancho, alto, bytes, mime, orden
         FROM anuncio_fotos WHERE anuncio_id = $1 ORDER BY orden`,
        [anuncioId]
    );
    return rows;
};

const eliminarFotos = async (client, anuncioId, ids) => {
    if (ids.length === 0) return;
    await client.query(`DELETE FROM anuncio_fotos WHERE anuncio_id = $1 AND id = ANY($2::bigint[])`, [anuncioId, ids]);
};

// Reasigna 'orden' 0..n-1 en el orden recibido. Requiere que la restricción única esté diferida.
const reordenarFotos = async (client, anuncioId, idsEnOrden) => {
    await client.query('SET CONSTRAINTS uq_anuncio_fotos_orden DEFERRED');
    for (let i = 0; i < idsEnOrden.length; i++) {
        await client.query(`UPDATE anuncio_fotos SET orden = $3 WHERE anuncio_id = $1 AND id = $2`, [
            anuncioId,
            idsEnOrden[i],
            i,
        ]);
    }
};

const buscarPorId = async (id, client) => {
    const db = client || pool;
    const { rows } = await db.query(`${SELECT_BASE} WHERE a.id = $1`, [id]);
    return rows[0] || null;
};

const buscarPorSlug = async (slug) => {
    const { rows } = await pool.query(`${SELECT_BASE} WHERE a.slug = $1`, [slug]);
    return rows[0] || null;
};

// Bloquea la fila para editarla dentro de una transacción.
const bloquearParaEditar = async (client, id) => {
    const { rows } = await client.query(`SELECT * FROM anuncios WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] || null;
};

// Solo actualiza las columnas recibidas (claves ya validadas por el servicio).
const COLUMNAS_EDITABLES = {
    titulo: 'titulo',
    descripcion: 'descripcion',
    categoriaId: 'categoria_id',
    provinciaCodigo: 'provincia_codigo',
    cantonCodigo: 'canton_codigo',
    sector: 'sector',
    precio: 'precio',
    latitud: 'latitud',
    longitud: 'longitud',
    estado: 'estado',
    publicadoEn: 'publicado_en',
    mostrarTelefono: 'mostrar_telefono',
    vendido: 'vendido',
    // Lo pone el servicio junto con 'vendido', nunca el cliente.
    vendidoEn: 'vendido_en',
    // Lo pone la moderación al volver a validar una edición, nunca el cliente.
    motivoRevision: 'motivo_revision',
};

const actualizar = async (client, id, cambios) => {
    const sets = [];
    const valores = [id];
    for (const [clave, valor] of Object.entries(cambios)) {
        const columna = COLUMNAS_EDITABLES[clave];
        if (!columna) continue;
        valores.push(valor);
        sets.push(`${columna} = $${valores.length}`);
    }
    // Aunque solo cambien fotos o detalle, se marca la edición.
    if (sets.length === 0) sets.push('actualizado_en = NOW()');
    await client.query(`UPDATE anuncios SET ${sets.join(', ')} WHERE id = $1`, valores);
};

const eliminarSoft = async (id) => {
    await pool.query(
        `UPDATE anuncios SET estado = 'ELIMINADO', eliminado_en = NOW()
         WHERE id = $1 AND eliminado_en IS NULL`,
        [id]
    );
};

const incrementarVistas = async (id) => {
    await pool.query(`UPDATE anuncios SET vistas = vistas + 1 WHERE id = $1`, [id]);
};

// Suma al contador una sola vez por (anuncio, usuario) cada hora. El upsert solo
// devuelve fila si es el primer pedido o si el último fue hace más de una hora;
// en ese caso, y solo en ese, se incrementa. Devuelve true si sumó.
const registrarContacto = async (anuncioId, usuarioId) => {
    const { rowCount } = await pool.query(
        `WITH marca AS (
             INSERT INTO anuncio_contactos (anuncio_id, usuario_id, ultimo_en)
             VALUES ($1, $2, NOW())
             ON CONFLICT (anuncio_id, usuario_id) DO UPDATE SET ultimo_en = NOW()
                 WHERE anuncio_contactos.ultimo_en < NOW() - INTERVAL '1 hour'
             RETURNING 1
         )
         UPDATE anuncios a SET contactos = contactos + 1
         WHERE a.id = $1 AND ${VISIBLE} AND EXISTS (SELECT 1 FROM marca)`,
        [anuncioId, usuarioId]
    );
    return rowCount > 0;
};

// Todas las fotos del anuncio en un solo array, para que la vista de lista
// pueda mostrarla sin pedir el anuncio uno por uno. Es un subselect correlacionado
// (no un JOIN) porque un JOIN traería una fila por foto y rompería la paginación
// por cursor, que cuenta filas.
const FOTOS_JSON = `COALESCE((
        SELECT json_agg(json_build_object(
                   'id', f.id, 'storage_key', f.storage_key,
                   'ancho', f.ancho, 'alto', f.alto, 'orden', f.orden
               ) ORDER BY f.orden)
        FROM anuncio_fotos f
        WHERE f.anuncio_id = a.id
    ), '[]'::json) AS fotos`;

// Feed público con paginación por cursor (keyset).
// orden 'recientes': (publicado_en DESC, id DESC). orden 'cercanos': (distancia ASC, id ASC).
const feed = async (f) => {
    const valores = [];
    const p = (valor) => {
        valores.push(valor);
        return `$${valores.length}`;
    };

    // Los vendidos siguen visibles en su detalle, pero no en el feed. Debe
    // coincidir con el predicado del índice parcial idx_anuncios_feed.
    const where = [VISIBLE, 'NOT a.vendido'];
    if (f.pilar) where.push(`a.pilar = ${p(f.pilar)}`);
    if (f.categoriaId) where.push(`a.categoria_id = ${p(f.categoriaId)}`);
    if (f.cantonCodigo) where.push(`a.canton_codigo = ${p(f.cantonCodigo)}`);
    if (f.provinciaCodigo) where.push(`a.provincia_codigo = ${p(f.provinciaCodigo)}`);
    if (f.autorUsuarioId) where.push(`a.autor_usuario_id = ${p(f.autorUsuarioId)}`);
    if (f.precioMin !== null) where.push(`a.precio >= ${p(f.precioMin)}`);
    if (f.precioMax !== null) where.push(`a.precio <= ${p(f.precioMax)}`);
    // Búsqueda tolerante. El texto llega ya en minúsculas y sin tildes (qn), y
    // un anuncio coincide si pasa cualquiera de estas tres pruebas:
    //  1. Contiene el texto tal cual en el título, la descripción o la categoría
    //     ("iph" encuentra "iPhone"): cubre las palabras a medias.
    //  2. Se parece por trigramas a una parte del título ("computadra" ~
    //     "computadora"): cubre los errores de tipeo.
    //  3. Coincide por raíz de palabra en español ("zapatos" ~ "zapato").
    let relevancia = '0::float8';
    if (f.q) {
        const qn = p(f.q);
        const titulo = 'f_unaccent(lower(a.titulo))';
        where.push(`(
            ${titulo} LIKE '%' || ${qn} || '%'
            OR f_unaccent(lower(coalesce(a.descripcion, ''))) LIKE '%' || ${qn} || '%'
            OR f_unaccent(lower(c.nombre)) LIKE '%' || ${qn} || '%'
            OR word_similarity(${qn}, ${titulo}) >= 0.4
            OR to_tsvector('spanish', ${titulo}) @@ plainto_tsquery('spanish', ${qn})
        )`);
        // Lo que coincide en el título pesa más que lo que solo sale en la descripción.
        relevancia = `(word_similarity(${qn}, ${titulo})
            + CASE WHEN ${titulo} LIKE '%' || ${qn} || '%' THEN 1 ELSE 0 END
            + CASE WHEN ${titulo} LIKE ${qn} || '%' THEN 0.5 ELSE 0 END)::float8`;
    }
    // Detalle de cada pilar: los alias ap/asv/ae vienen de SELECT_BASE.
    if (f.condicion) where.push(`ap.condicion = ${p(f.condicion)}`);
    if (f.modalidadCobro) where.push(`asv.modalidad_cobro = ${p(f.modalidadCobro)}`);
    if (f.jornada) where.push(`ae.jornada = ${p(f.jornada)}`);
    if (f.modalidad) where.push(`ae.modalidad = ${p(f.modalidad)}`);
    if (f.conFoto) where.push('f0.storage_key IS NOT NULL');

    const hayPunto = f.lat !== null && f.lng !== null;
    const distancia = hayPunto ? distanciaSql(p(f.lat), p(f.lng)) : 'NULL::float8';
    if (hayPunto && (f.orden === 'cercanos' || f.radioKm !== null)) where.push('a.latitud IS NOT NULL');

    const filtrosExternos = [];
    if (hayPunto && f.radioKm !== null) filtrosExternos.push(`t.distancia_km <= ${p(f.radioKm)}`);

    // "A convenir" (precio NULL) va siempre al final: se sustituye por un tope
    // fuera de rango para que la clave del cursor nunca sea NULL.
    const precioOrden =
        f.orden === 'precio_desc' ? 'COALESCE(a.precio, -1)::numeric' : 'COALESCE(a.precio, 99999999999)::numeric';

    let ordenSql;
    if (f.orden === 'cercanos') {
        if (f.cursor) filtrosExternos.push(`(t.distancia_km, t.id) > (${p(f.cursor.d)}::float8, ${p(f.cursor.id)}::bigint)`);
        ordenSql = 't.distancia_km ASC, t.id ASC';
    } else if (f.orden === 'relevancia' && f.q) {
        if (f.cursor) filtrosExternos.push(`(t.relevancia, t.id) < (${p(f.cursor.r)}::float8, ${p(f.cursor.id)}::bigint)`);
        ordenSql = 't.relevancia DESC, t.id DESC';
    } else if (f.orden === 'precio_asc') {
        if (f.cursor) filtrosExternos.push(`(t.precio_orden, t.id) > (${p(f.cursor.v)}::numeric, ${p(f.cursor.id)}::bigint)`);
        ordenSql = 't.precio_orden ASC, t.id ASC';
    } else if (f.orden === 'precio_desc') {
        if (f.cursor) filtrosExternos.push(`(t.precio_orden, t.id) < (${p(f.cursor.v)}::numeric, ${p(f.cursor.id)}::bigint)`);
        ordenSql = 't.precio_orden DESC, t.id DESC';
    } else {
        if (f.cursor) {
            filtrosExternos.push(`(t.publicado_en, t.id) < (${p(f.cursor.p)}::timestamptz, ${p(f.cursor.id)}::bigint)`);
        }
        ordenSql = 't.publicado_en DESC, t.id DESC';
    }

    const sql = `
        SELECT * FROM (
            ${SELECT_BASE.replace(
                'SELECT a.*,',
                `SELECT a.*, ${distancia} AS distancia_km, ${precioOrden} AS precio_orden, ${relevancia} AS relevancia, ${FOTOS_JSON},`
            )}
            WHERE ${where.join(' AND ')}
        ) t
        ${filtrosExternos.length ? `WHERE ${filtrosExternos.join(' AND ')}` : ''}
        ORDER BY ${ordenSql}
        LIMIT ${p(f.limite + 1)}`;

    const { rows } = await pool.query(sql, valores);
    return rows;
};

// "Mis anuncios": todos los estados menos eliminados, más recientes primero, paginado por cursor.
// El keyset va sobre (creado_en, id): creado_en es NOT NULL, a diferencia de publicado_en (borradores).
// creado_en_exacto conserva los microsegundos para que el cursor no salte filas del mismo milisegundo.
const listarPorAutor = async ({ usuarioId, estado, cursor, limite }) => {
    const { rows } = await pool.query(
        `${SELECT_BASE.replace('SELECT a.*,', 'SELECT a.*, a.creado_en::text AS creado_en_exacto,')}
         WHERE a.autor_usuario_id = $1 AND a.eliminado_en IS NULL
           AND ($2::text IS NULL OR a.estado = $2)
           AND ($3::timestamptz IS NULL OR (a.creado_en, a.id) < ($3::timestamptz, $4::bigint))
         ORDER BY a.creado_en DESC, a.id DESC
         LIMIT $5`,
        [usuarioId, estado, cursor ? cursor.c : null, cursor ? cursor.id : null, limite + 1]
    );
    return rows;
};

// ---------- Me gusta ----------

// Idempotente: si el like ya existía no pasa nada, y el total no se duplica.
// true si el like es nuevo (para avisar solo una vez).
const darLike = async (anuncioId, usuarioId) => {
    const { rowCount } = await pool.query(
        `INSERT INTO anuncio_likes (anuncio_id, usuario_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [anuncioId, usuarioId]
    );
    return rowCount > 0;
};

const quitarLike = async (anuncioId, usuarioId) => {
    await pool.query(`DELETE FROM anuncio_likes WHERE anuncio_id = $1 AND usuario_id = $2`, [anuncioId, usuarioId]);
};

// Total y si este usuario le dio me gusta, en una sola consulta (tras el
// INSERT/DELETE, para que el total refleje el cambio).
const estadoLike = async (anuncioId, usuarioId) => {
    const { rows } = await pool.query(
        `SELECT
             (SELECT COUNT(*) FROM anuncio_likes WHERE anuncio_id = $1)::int AS likes,
             EXISTS (SELECT 1 FROM anuncio_likes WHERE anuncio_id = $1 AND usuario_id = $2) AS me_gusta`,
        [anuncioId, usuarioId]
    );
    return { meGusta: rows[0].me_gusta, likes: rows[0].likes };
};

// De los ids de una página, a cuáles les dio me gusta el usuario: una consulta
// para toda la página en vez de una por anuncio.
const idsConLike = async (usuarioId, anuncioIds) => {
    if (!usuarioId || anuncioIds.length === 0) return new Set();
    const { rows } = await pool.query(
        `SELECT anuncio_id FROM anuncio_likes WHERE usuario_id = $1 AND anuncio_id = ANY($2::bigint[])`,
        [usuarioId, anuncioIds]
    );
    return new Set(rows.map((r) => String(r.anuncio_id)));
};

// ---------- Guardados ----------

// Idempotentes, igual que el like: guardar dos veces no duplica nada.
// true si se guardó ahora (para avisar solo una vez).
const guardar = async (anuncioId, usuarioId) => {
    const { rowCount } = await pool.query(
        `INSERT INTO anuncio_guardados (anuncio_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [anuncioId, usuarioId]
    );
    return rowCount > 0;
};

const quitarGuardado = async (anuncioId, usuarioId) => {
    await pool.query(`DELETE FROM anuncio_guardados WHERE anuncio_id = $1 AND usuario_id = $2`, [
        anuncioId,
        usuarioId,
    ]);
};

// De los ids de una página, cuáles guardó el usuario.
const idsGuardados = async (usuarioId, anuncioIds) => {
    if (!usuarioId || anuncioIds.length === 0) return new Set();
    const { rows } = await pool.query(
        `SELECT anuncio_id FROM anuncio_guardados WHERE usuario_id = $1 AND anuncio_id = ANY($2::bigint[])`,
        [usuarioId, anuncioIds]
    );
    return new Set(rows.map((r) => String(r.anuncio_id)));
};

// Los guardados del usuario, del más reciente al más antiguo. Incluye los ya
// vendidos o pausados (para poder avisar "ya se vendió"), no los eliminados.
const listarGuardados = async ({ usuarioId, cursor, limite }) => {
    const { rows } = await pool.query(
        `${SELECT_BASE.replace(
            'SELECT a.*,',
            `SELECT a.*, g.creado_en::text AS guardado_en_exacto, g.creado_en AS guardado_en, ${FOTOS_JSON},`
        ).replace('FROM anuncios a', 'FROM anuncio_guardados g JOIN anuncios a ON a.id = g.anuncio_id')}
         WHERE g.usuario_id = $1 AND a.eliminado_en IS NULL
           AND ($2::timestamptz IS NULL OR (g.creado_en, a.id) < ($2::timestamptz, $3::bigint))
         ORDER BY g.creado_en DESC, a.id DESC
         LIMIT $4`,
        [usuarioId, cursor ? cursor.c : null, cursor ? cursor.id : null, limite + 1]
    );
    return rows;
};

// ---------- Vistas ----------

// Una vista cuenta una vez por persona y anuncio cada 24 horas, y nunca la del
// dueño. `visitante` es 'u:<id de usuario>' con sesión o 'a:<huella>' sin ella.
// Devuelve cuántas vistas nuevas se sumaron.
const registrarVistas = async (anuncioIds, visitante, usuarioId) => {
    if (anuncioIds.length === 0) return 0;
    const { rowCount } = await pool.query(
        `WITH candidatos AS (
             SELECT a.id FROM anuncios a
             WHERE a.id = ANY($1::bigint[]) AND ${VISIBLE}
               AND ($3::uuid IS NULL OR a.autor_usuario_id <> $3::uuid)
         ), marca AS (
             INSERT INTO anuncio_vistas (anuncio_id, visitante, ultimo_en)
             SELECT id, $2, NOW() FROM candidatos
             ON CONFLICT (anuncio_id, visitante) DO UPDATE SET ultimo_en = NOW()
                 WHERE anuncio_vistas.ultimo_en < NOW() - INTERVAL '24 hours'
             RETURNING anuncio_id
         )
         UPDATE anuncios a SET vistas = a.vistas + 1
         FROM marca WHERE a.id = marca.anuncio_id`,
        [anuncioIds, visitante, usuarioId || null]
    );
    return rowCount;
};

// ---------- Idempotencia ----------

const buscarIdempotencia = async (usuarioId, clave) => {
    const { rows } = await pool.query(
        `SELECT anuncio_id FROM anuncio_idempotencia WHERE usuario_id = $1 AND clave = $2`,
        [usuarioId, clave]
    );
    return rows[0]?.anuncio_id || null;
};

// Devuelve true si la clave quedó registrada; false si otra petición ya la usó.
// Si hay otra transacción en curso con la misma clave, el INSERT espera a que termine.
const registrarIdempotencia = async (client, usuarioId, clave, anuncioId) => {
    const { rowCount } = await client.query(
        `INSERT INTO anuncio_idempotencia (usuario_id, clave, anuncio_id) VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id, clave) DO NOTHING`,
        [usuarioId, clave, anuncioId]
    );
    return rowCount > 0;
};

module.exports = {
    insertar,
    guardarDetalle,
    insertarFoto,
    listarFotos,
    eliminarFotos,
    reordenarFotos,
    buscarPorId,
    buscarPorSlug,
    bloquearParaEditar,
    actualizar,
    eliminarSoft,
    incrementarVistas,
    registrarContacto,
    feed,
    listarPorAutor,
    darLike,
    quitarLike,
    estadoLike,
    idsConLike,
    guardar,
    quitarGuardado,
    idsGuardados,
    listarGuardados,
    registrarVistas,
    buscarIdempotencia,
    registrarIdempotencia,
};
