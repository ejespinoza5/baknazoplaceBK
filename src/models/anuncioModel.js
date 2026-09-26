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
           u.foto_perfil AS autor_foto, u.correo_verificado AS autor_verificado,
           n.nombre_comercial AS negocio_nombre, n.logo_url AS negocio_logo, n.whatsapp AS negocio_whatsapp,
           f0.storage_key AS portada_key, f0.ancho AS portada_ancho, f0.alto AS portada_alto
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
const VISIBLE = `a.estado = 'PUBLICADO' AND a.eliminado_en IS NULL AND (a.expira_en IS NULL OR a.expira_en > NOW())`;

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
             precio, latitud, longitud, autor_usuario_id, autor_negocio_id, estado, publicado_en
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PUBLICADO',
                 date_trunc('milliseconds', NOW()))
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

const incrementarContactos = async (id) => {
    const { rowCount } = await pool.query(
        `UPDATE anuncios a SET contactos = contactos + 1 WHERE a.id = $1 AND ${VISIBLE}`,
        [id]
    );
    return rowCount > 0;
};

// Feed público con paginación por cursor (keyset).
// orden 'recientes': (publicado_en DESC, id DESC). orden 'cercanos': (distancia ASC, id ASC).
const feed = async (f) => {
    const valores = [];
    const p = (valor) => {
        valores.push(valor);
        return `$${valores.length}`;
    };

    const where = [VISIBLE];
    if (f.pilar) where.push(`a.pilar = ${p(f.pilar)}`);
    if (f.categoriaId) where.push(`a.categoria_id = ${p(f.categoriaId)}`);
    if (f.cantonCodigo) where.push(`a.canton_codigo = ${p(f.cantonCodigo)}`);
    if (f.provinciaCodigo) where.push(`a.provincia_codigo = ${p(f.provinciaCodigo)}`);
    if (f.autorUsuarioId) where.push(`a.autor_usuario_id = ${p(f.autorUsuarioId)}`);
    if (f.precioMin !== null) where.push(`a.precio >= ${p(f.precioMin)}`);
    if (f.precioMax !== null) where.push(`a.precio <= ${p(f.precioMax)}`);
    if (f.q) where.push(`to_tsvector('spanish', a.titulo) @@ websearch_to_tsquery('spanish', ${p(f.q)})`);

    const hayPunto = f.lat !== null && f.lng !== null;
    const distancia = hayPunto ? distanciaSql(p(f.lat), p(f.lng)) : 'NULL::float8';
    if (hayPunto && (f.orden === 'cercanos' || f.radioKm !== null)) where.push('a.latitud IS NOT NULL');

    const filtrosExternos = [];
    if (hayPunto && f.radioKm !== null) filtrosExternos.push(`t.distancia_km <= ${p(f.radioKm)}`);

    let ordenSql;
    if (f.orden === 'cercanos') {
        if (f.cursor) filtrosExternos.push(`(t.distancia_km, t.id) > (${p(f.cursor.d)}::float8, ${p(f.cursor.id)}::bigint)`);
        ordenSql = 't.distancia_km ASC, t.id ASC';
    } else {
        if (f.cursor) {
            filtrosExternos.push(`(t.publicado_en, t.id) < (${p(f.cursor.p)}::timestamptz, ${p(f.cursor.id)}::bigint)`);
        }
        ordenSql = 't.publicado_en DESC, t.id DESC';
    }

    const sql = `
        SELECT * FROM (
            ${SELECT_BASE.replace('SELECT a.*,', `SELECT a.*, ${distancia} AS distancia_km,`)}
            WHERE ${where.join(' AND ')}
        ) t
        ${filtrosExternos.length ? `WHERE ${filtrosExternos.join(' AND ')}` : ''}
        ORDER BY ${ordenSql}
        LIMIT ${p(f.limite + 1)}`;

    const { rows } = await pool.query(sql, valores);
    return rows;
};

// "Mis anuncios": todos los estados menos eliminados, más recientes primero.
const listarPorAutor = async (usuarioId, estado) => {
    const valores = [usuarioId];
    let filtroEstado = '';
    if (estado) {
        valores.push(estado);
        filtroEstado = `AND a.estado = $2`;
    }
    const { rows } = await pool.query(
        `${SELECT_BASE}
         WHERE a.autor_usuario_id = $1 AND a.eliminado_en IS NULL ${filtroEstado}
         ORDER BY a.creado_en DESC, a.id DESC`,
        valores
    );
    return rows;
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
    incrementarContactos,
    feed,
    listarPorAutor,
    buscarIdempotencia,
    registrarIdempotencia,
};
