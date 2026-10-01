const pool = require('../config/db');

// Una conversación vista por uno de sus participantes ($1): la otra persona
// (con nombre y logo de negocio si lo es), el anuncio si lo hay, el último
// mensaje y cuántos le faltan por leer.
const SELECT_CONVERSACION = `
    SELECT c.id, c.anuncio_id, c.creado_en, c.ultimo_mensaje_en,
           o.id AS otro_id, o.tipo_cuenta AS otro_tipo, o.nombres AS otro_nombres,
           o.apellidos AS otro_apellidos, o.foto_perfil AS otro_foto,
           n.nombre_comercial AS otro_negocio, n.logo_url AS otro_logo,
           a.titulo AS anuncio_titulo, a.slug AS anuncio_slug, a.pilar AS anuncio_pilar,
           a.precio AS anuncio_precio, a.moneda AS anuncio_moneda, a.estado AS anuncio_estado,
           a.vendido AS anuncio_vendido, a.eliminado_en AS anuncio_eliminado,
           f0.storage_key AS anuncio_portada,
           um.id AS um_id, um.remitente_id AS um_remitente, um.contenido AS um_contenido,
           um.creado_en AS um_creado, um.entregado_en AS um_entregado, um.leido_en AS um_leido,
           (SELECT COUNT(*)::int FROM mensajes m
             WHERE m.conversacion_id = c.id AND m.remitente_id <> $1 AND m.leido_en IS NULL) AS no_leidos
    FROM conversaciones c
    JOIN usuarios o ON o.id = CASE WHEN c.iniciador_id = $1 THEN c.destinatario_id ELSE c.iniciador_id END
    LEFT JOIN negocios n ON n.usuario_id = o.id
    LEFT JOIN anuncios a ON a.id = c.anuncio_id
    LEFT JOIN anuncio_fotos f0 ON f0.anuncio_id = a.id AND f0.orden = 0
    LEFT JOIN mensajes um ON um.id = c.ultimo_mensaje_id`;

const PARTICIPA = '(c.iniciador_id = $1 OR c.destinatario_id = $1)';

// La bandeja: solo las conversaciones que ya tienen algún mensaje.
const listar = async ({ usuarioId, limite, offset }) => {
    const { rows } = await pool.query(
        `${SELECT_CONVERSACION}
         WHERE ${PARTICIPA} AND c.ultimo_mensaje_id IS NOT NULL
         ORDER BY c.ultimo_mensaje_en DESC, c.id DESC
         LIMIT $2 OFFSET $3`,
        [usuarioId, limite, offset]
    );
    return rows;
};

// Una conversación, solo si el usuario participa en ella (si no, null).
const buscarParaUsuario = async (id, usuarioId) => {
    const { rows } = await pool.query(`${SELECT_CONVERSACION} WHERE c.id = $2 AND ${PARTICIPA}`, [usuarioId, id]);
    return rows[0] || null;
};

// Solo los dos ids de los participantes: lo mínimo para autorizar un envío.
const participantes = async (id) => {
    const { rows } = await pool.query(
        'SELECT id, iniciador_id, destinatario_id FROM conversaciones WHERE id = $1',
        [id]
    );
    return rows[0] || null;
};

// Devuelve la conversación del par (en cualquier sentido) y anuncio, creándola
// si no existe. ON CONFLICT cubre a dos personas abriéndola a la vez.
const obtenerOCrear = async ({ iniciadorId, destinatarioId, anuncioId }) => {
    await pool.query(
        `INSERT INTO conversaciones (iniciador_id, destinatario_id, anuncio_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (LEAST(iniciador_id, destinatario_id), GREATEST(iniciador_id, destinatario_id), COALESCE(anuncio_id, 0))
         DO NOTHING`,
        [iniciadorId, destinatarioId, anuncioId]
    );
    const { rows } = await pool.query(
        `SELECT id FROM conversaciones
         WHERE LEAST(iniciador_id, destinatario_id) = LEAST($1::uuid, $2::uuid)
           AND GREATEST(iniciador_id, destinatario_id) = GREATEST($1::uuid, $2::uuid)
           AND COALESCE(anuncio_id, 0) = COALESCE($3::bigint, 0)`,
        [iniciadorId, destinatarioId, anuncioId]
    );
    return rows[0].id;
};

// Página del historial, de la más nueva hacia atrás.
const listarMensajes = async ({ conversacionId, antesDe, limite }) => {
    const { rows } = await pool.query(
        `SELECT id, conversacion_id, remitente_id, contenido, cliente_id, creado_en, entregado_en, leido_en
         FROM mensajes
         WHERE conversacion_id = $1 AND ($2::bigint IS NULL OR id < $2)
         ORDER BY id DESC
         LIMIT $3`,
        [conversacionId, antesDe, limite]
    );
    return rows;
};

// Guarda el mensaje y lo deja como último de la conversación, en una transacción.
// Si el mismo remitente ya mandó ese cliente_id (un reintento), no se duplica:
// se devuelve el que ya estaba y `nuevo` es false.
const insertarMensaje = async ({ conversacionId, remitenteId, contenido, clienteId }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const insertado = await client.query(
            `INSERT INTO mensajes (conversacion_id, remitente_id, contenido, cliente_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (remitente_id, cliente_id) DO NOTHING
             RETURNING id, conversacion_id, remitente_id, contenido, cliente_id, creado_en, entregado_en, leido_en`,
            [conversacionId, remitenteId, contenido, clienteId]
        );
        if (insertado.rows.length === 0) {
            await client.query('ROLLBACK');
            const { rows } = await pool.query(
                `SELECT id, conversacion_id, remitente_id, contenido, cliente_id, creado_en, entregado_en, leido_en
                 FROM mensajes WHERE remitente_id = $1 AND cliente_id = $2`,
                [remitenteId, clienteId]
            );
            return { mensaje: rows[0], nuevo: false };
        }
        const mensaje = insertado.rows[0];
        await client.query(
            'UPDATE conversaciones SET ultimo_mensaje_id = $2, ultimo_mensaje_en = $3 WHERE id = $1',
            [conversacionId, mensaje.id, mensaje.creado_en]
        );
        await client.query('COMMIT');
        return { mensaje, nuevo: true };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};

// Marca como entregado lo que otros le mandaron a este usuario y aún no le había
// llegado. Con conversacionId, solo en esa; sin él, en todas (al conectarse).
const marcarEntregados = async (usuarioId, conversacionId = null) => {
    const { rows } = await pool.query(
        `UPDATE mensajes m SET entregado_en = NOW()
         FROM conversaciones c
         WHERE c.id = m.conversacion_id AND (c.iniciador_id = $1 OR c.destinatario_id = $1)
           AND m.remitente_id <> $1 AND m.entregado_en IS NULL
           AND ($2::bigint IS NULL OR m.conversacion_id = $2)
         RETURNING m.id, m.conversacion_id, m.remitente_id, m.entregado_en`,
        [usuarioId, conversacionId]
    );
    return rows;
};

// Marca como leído todo lo que el otro mandó en esta conversación.
const marcarLeidos = async (conversacionId, lectorId) => {
    const { rows } = await pool.query(
        `UPDATE mensajes
         SET leido_en = NOW(), entregado_en = COALESCE(entregado_en, NOW())
         WHERE conversacion_id = $1 AND remitente_id <> $2 AND leido_en IS NULL
         RETURNING id, remitente_id, leido_en`,
        [conversacionId, lectorId]
    );
    return rows;
};

// Total de mensajes sin leer del usuario en todas sus conversaciones.
const contarNoLeidos = async (usuarioId) => {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
         WHERE ${PARTICIPA} AND m.remitente_id <> $1 AND m.leido_en IS NULL`,
        [usuarioId]
    );
    return rows[0].total;
};

// Lo necesario para validar a un usuario antes de chatear con él.
const buscarUsuarioActivo = async (id) => {
    const { rows } = await pool.query(
        `SELECT u.id, u.tipo_cuenta, u.nombres, u.apellidos, n.nombre_comercial
         FROM usuarios u LEFT JOIN negocios n ON n.usuario_id = u.id
         WHERE u.id = $1 AND u.estado = 'ACTIVO'`,
        [id]
    );
    return rows[0] || null;
};

module.exports = {
    listar,
    buscarParaUsuario,
    participantes,
    obtenerOCrear,
    listarMensajes,
    insertarMensaje,
    marcarEntregados,
    marcarLeidos,
    contarNoLeidos,
    buscarUsuarioActivo,
};
