const pool = require('../config/db');

// ---------- Configuración y diccionario ----------

const obtenerConfig = async () => {
    const { rows } = await pool.query('SELECT * FROM moderacion_config WHERE id = 1');
    return rows[0] || { revision_usuarios_nuevos: false, dias_usuario_nuevo: 7, umbral_denuncias: 3, categorias_prohibidas: [] };
};

const guardarConfig = async ({ revisionUsuariosNuevos, diasUsuarioNuevo, umbralDenuncias, categoriasProhibidas }, adminId) => {
    await pool.query(
        `INSERT INTO moderacion_config (id, revision_usuarios_nuevos, dias_usuario_nuevo, umbral_denuncias, categorias_prohibidas, actualizado_por, actualizado_en)
         VALUES (1, $1, $2, $3, $4::int[], $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
             revision_usuarios_nuevos = EXCLUDED.revision_usuarios_nuevos,
             dias_usuario_nuevo = EXCLUDED.dias_usuario_nuevo,
             umbral_denuncias = EXCLUDED.umbral_denuncias,
             categorias_prohibidas = EXCLUDED.categorias_prohibidas,
             actualizado_por = EXCLUDED.actualizado_por,
             actualizado_en = NOW()`,
        [revisionUsuariosNuevos, diasUsuarioNuevo, umbralDenuncias, categoriasProhibidas, adminId]
    );
};

const listarPalabras = async () => {
    const { rows } = await pool.query(
        `SELECT p.id, p.termino, p.nivel, p.creado_en, a.nombre AS creado_por
         FROM moderacion_palabras p LEFT JOIN administradores a ON a.id = p.creado_por
         ORDER BY p.nivel, p.termino`
    );
    return rows;
};

const guardarPalabra = async (termino, nivel, adminId) => {
    const { rows } = await pool.query(
        `INSERT INTO moderacion_palabras (termino, nivel, creado_por) VALUES ($1, $2, $3)
         ON CONFLICT (termino) DO UPDATE SET nivel = EXCLUDED.nivel
         RETURNING id, termino, nivel`,
        [termino, nivel, adminId]
    );
    return rows[0];
};

const eliminarPalabra = async (id) => {
    const { rows } = await pool.query('DELETE FROM moderacion_palabras WHERE id = $1 RETURNING termino', [id]);
    return rows[0] || null;
};

// ---------- Historial ----------

const registrarEvento = async (e, client = pool) => {
    await client.query(
        `INSERT INTO moderacion_eventos (anuncio_id, usuario_id, accion, estado_anterior, estado_nuevo, motivo, nota, admin_id, detalle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
            e.anuncioId ?? null,
            e.usuarioId ?? null,
            e.accion,
            e.estadoAnterior ?? null,
            e.estadoNuevo ?? null,
            e.motivo ?? null,
            e.nota ?? null,
            e.adminId ?? null,
            JSON.stringify(e.detalle ?? {}),
        ]
    );
};

const eventosDe = async (anuncioId) => {
    const { rows } = await pool.query(
        `SELECT e.id, e.accion, e.estado_anterior, e.estado_nuevo, e.motivo, e.nota, e.detalle, e.creado_en,
                a.nombre AS admin_nombre
         FROM moderacion_eventos e LEFT JOIN administradores a ON a.id = e.admin_id
         WHERE e.anuncio_id = $1
         ORDER BY e.creado_en DESC, e.id DESC`,
        [anuncioId]
    );
    return rows;
};

// ---------- Denuncias ----------

const crearDenuncia = async ({ anuncioId, denuncianteId, motivo, detalle }) => {
    const { rows } = await pool.query(
        `INSERT INTO denuncias (anuncio_id, denunciante_id, motivo, detalle) VALUES ($1, $2, $3, $4)
         ON CONFLICT (anuncio_id, denunciante_id) DO NOTHING RETURNING id`,
        [anuncioId, denuncianteId, motivo, detalle]
    );
    return rows[0]?.id ?? null;
};

const contarDenunciantesPendientes = async (anuncioId) => {
    const { rows } = await pool.query(
        `SELECT COUNT(DISTINCT denunciante_id)::int AS n FROM denuncias WHERE anuncio_id = $1 AND estado = 'PENDIENTE'`,
        [anuncioId]
    );
    return rows[0].n;
};

const denunciasDe = async (anuncioId) => {
    const { rows } = await pool.query(
        `SELECT d.id, d.motivo, d.detalle, d.estado, d.creado_en, d.resuelta_en,
                u.id AS denunciante_id, u.nombres AS denunciante_nombres, u.apellidos AS denunciante_apellidos,
                a.nombre AS resuelta_por
         FROM denuncias d
         JOIN usuarios u ON u.id = d.denunciante_id
         LEFT JOIN administradores a ON a.id = d.resuelta_por
         WHERE d.anuncio_id = $1
         ORDER BY d.creado_en DESC`,
        [anuncioId]
    );
    return rows;
};

const resolverDenuncias = async (anuncioId, estado, adminId) => {
    const { rowCount } = await pool.query(
        `UPDATE denuncias SET estado = $2, resuelta_por = $3, resuelta_en = NOW()
         WHERE anuncio_id = $1 AND estado = 'PENDIENTE'`,
        [anuncioId, estado, adminId]
    );
    return rowCount;
};

// ---------- Anuncios en el panel ----------

const SELECT_ANUNCIO_ADMIN = `
    SELECT a.id, a.slug, a.titulo, a.descripcion, a.pilar, a.estado, a.precio, a.moneda,
           a.creado_en, a.publicado_en, a.actualizado_en, a.motivo_revision, a.notas_moderacion,
           a.pausa_administrativa, a.vendido, a.autor_usuario_id,
           c.nombre AS categoria_nombre, a.categoria_id,
           ca.nombre AS canton_nombre,
           u.nombres AS autor_nombres, u.apellidos AS autor_apellidos, u.correo AS autor_correo,
           u.tipo_cuenta AS autor_tipo, u.estado AS autor_estado, u.creado_en AS autor_desde,
           n.nombre_comercial AS autor_negocio,
           f0.storage_key AS portada_key,
           (SELECT COUNT(*)::int FROM denuncias d WHERE d.anuncio_id = a.id AND d.estado = 'PENDIENTE') AS denuncias_pendientes
    FROM anuncios a
    JOIN categorias_anuncio c ON c.id = a.categoria_id
    JOIN cantones ca ON ca.codigo = a.canton_codigo
    JOIN usuarios u ON u.id = a.autor_usuario_id
    LEFT JOIN negocios n ON n.usuario_id = u.id
    LEFT JOIN anuncio_fotos f0 ON f0.anuncio_id = a.id AND f0.orden = 0`;

const FILTRO_VISTA = {
    pendientes: `a.estado = 'PENDIENTE_REVISION'`,
    publicados: `a.estado = 'PUBLICADO'`,
    rechazados: `a.estado = 'RECHAZADO'`,
    pausados: `a.estado = 'PAUSADO'`,
    denunciados: `EXISTS (SELECT 1 FROM denuncias d WHERE d.anuncio_id = a.id AND d.estado = 'PENDIENTE')`,
    todos: `a.estado <> 'ELIMINADO'`,
};

const listarAnuncios = async ({ vista, q, limite, offset }) => {
    const filtro = FILTRO_VISTA[vista] || FILTRO_VISTA.todos;
    // Las pendientes, de la más antigua a la más nueva: primero lo que más espera.
    const orden = vista === 'pendientes' ? 'a.creado_en ASC, a.id ASC' : vista === 'denunciados' ? 'denuncias_pendientes DESC, a.id DESC' : 'a.creado_en DESC, a.id DESC';
    const { rows } = await pool.query(
        `SELECT * FROM (${SELECT_ANUNCIO_ADMIN}
             WHERE ${filtro} AND a.eliminado_en IS NULL
               AND ($1::text IS NULL OR f_unaccent(lower(a.titulo)) LIKE '%' || f_unaccent(lower($1)) || '%'
                    OR u.correo ILIKE '%' || $1 || '%')) a
         ORDER BY ${orden}
         LIMIT $2 OFFSET $3`,
        [q, limite, offset]
    );
    const { rows: total } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM anuncios a JOIN usuarios u ON u.id = a.autor_usuario_id
         WHERE ${filtro} AND a.eliminado_en IS NULL
           AND ($1::text IS NULL OR f_unaccent(lower(a.titulo)) LIKE '%' || f_unaccent(lower($1)) || '%'
                OR u.correo ILIKE '%' || $1 || '%')`,
        [q]
    );
    return { filas: rows, total: total[0].n };
};

const anuncioAdmin = async (id) => {
    const { rows } = await pool.query(`${SELECT_ANUNCIO_ADMIN} WHERE a.id = $1`, [id]);
    return rows[0] || null;
};

const fotosDe = async (id) => {
    const { rows } = await pool.query('SELECT storage_key FROM anuncio_fotos WHERE anuncio_id = $1 ORDER BY orden', [id]);
    return rows.map((r) => r.storage_key);
};

// Cambia el estado desde la moderación. Bloquea la fila: dos moderadores a la
// vez no pisan sus decisiones.
const moderarAnuncio = async (id, cambio, evento) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT id, estado, autor_usuario_id, publicado_en FROM anuncios WHERE id = $1 AND eliminado_en IS NULL FOR UPDATE', [id]);
        const actual = rows[0];
        if (!actual) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query(
            `UPDATE anuncios SET
                 estado = $2::text,
                 notas_moderacion = CASE WHEN $3::boolean THEN $4::text ELSE notas_moderacion END,
                 pausa_administrativa = $5,
                 motivo_revision = CASE WHEN $2::text = 'PENDIENTE_REVISION' THEN motivo_revision ELSE NULL END,
                 publicado_en = CASE WHEN $2::text = 'PUBLICADO' THEN COALESCE(publicado_en, date_trunc('milliseconds', NOW())) ELSE publicado_en END,
                 eliminado_en = CASE WHEN $2::text = 'ELIMINADO' THEN NOW() ELSE eliminado_en END
             WHERE id = $1`,
            [id, cambio.estado, cambio.notas !== undefined, cambio.notas ?? null, Boolean(cambio.pausaAdministrativa)]
        );
        await registrarEvento(
            { ...evento, anuncioId: id, usuarioId: actual.autor_usuario_id, estadoAnterior: actual.estado, estadoNuevo: cambio.estado },
            client
        );
        await client.query('COMMIT');
        return actual;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};

// Una regla automática (denuncias) manda a revisión un anuncio publicado.
const enviarARevision = async (id, motivo, detalle = {}) => {
    const { rows } = await pool.query(
        `UPDATE anuncios SET estado = 'PENDIENTE_REVISION', motivo_revision = $2
         WHERE id = $1 AND estado = 'PUBLICADO' AND eliminado_en IS NULL
         RETURNING autor_usuario_id`,
        [id, motivo]
    );
    if (rows[0]) {
        await registrarEvento({
            anuncioId: id,
            usuarioId: rows[0].autor_usuario_id,
            accion: 'ENVIADO_A_REVISION',
            estadoAnterior: 'PUBLICADO',
            estadoNuevo: 'PENDIENTE_REVISION',
            motivo,
            detalle,
        });
    }
    return Boolean(rows[0]);
};

// ---------- Usuarios en el panel ----------

const listarUsuarios = async ({ q, estado, limite, offset }) => {
    const { rows } = await pool.query(
        `SELECT u.id, u.tipo_cuenta, u.nombres, u.apellidos, u.correo, u.estado, u.correo_verificado,
                u.creado_en, u.ultimo_acceso_en, n.nombre_comercial,
                (SELECT COUNT(*)::int FROM anuncios a WHERE a.autor_usuario_id = u.id AND a.eliminado_en IS NULL) AS anuncios,
                (SELECT COUNT(*)::int FROM denuncias d JOIN anuncios a ON a.id = d.anuncio_id WHERE a.autor_usuario_id = u.id) AS denuncias,
                COUNT(*) OVER()::int AS total
         FROM usuarios u LEFT JOIN negocios n ON n.usuario_id = u.id
         WHERE ($1::text IS NULL OR u.correo ILIKE '%' || $1 || '%'
                OR f_unaccent(lower(u.nombres || ' ' || COALESCE(u.apellidos, '') || ' ' || COALESCE(n.nombre_comercial, ''))) LIKE '%' || f_unaccent(lower($1)) || '%')
           AND ($2::text IS NULL OR u.estado = $2)
         ORDER BY u.creado_en DESC
         LIMIT $3 OFFSET $4`,
        [q, estado, limite, offset]
    );
    return rows;
};

const usuarioBasico = async (id) => {
    const { rows } = await pool.query('SELECT id, estado, correo, nombres, apellidos, creado_en FROM usuarios WHERE id = $1', [id]);
    return rows[0] || null;
};

const cambiarEstadoUsuario = async (id, estado) => {
    await pool.query('UPDATE usuarios SET estado = $2 WHERE id = $1', [id, estado]);
    // Suspendido: se cierran todas sus sesiones del marketplace.
    if (estado !== 'ACTIVO') {
        await pool.query('UPDATE tokens_actualizacion SET revocado_en = NOW() WHERE usuario_id = $1 AND revocado_en IS NULL', [id]);
    }
};

// Lo que espera atención, para los avisos del panel (una sola consulta liviana).
const contadores = async () => {
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM anuncios WHERE estado = 'PENDIENTE_REVISION') AS pendientes,
            (SELECT COUNT(DISTINCT anuncio_id)::int FROM denuncias WHERE estado = 'PENDIENTE') AS denunciados
    `);
    return rows[0];
};

// ---------- Estadísticas ----------

const estadisticas = async () => {
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM usuarios) AS usuarios,
            (SELECT COUNT(*)::int FROM usuarios WHERE creado_en > NOW() - INTERVAL '7 days') AS usuarios_nuevos,
            (SELECT COUNT(*)::int FROM usuarios WHERE estado = 'SUSPENDIDO') AS usuarios_suspendidos,
            (SELECT COUNT(*)::int FROM anuncios WHERE estado = 'PUBLICADO' AND eliminado_en IS NULL) AS publicados,
            (SELECT COUNT(*)::int FROM anuncios WHERE estado = 'PENDIENTE_REVISION') AS pendientes,
            (SELECT COUNT(*)::int FROM anuncios WHERE estado = 'RECHAZADO' AND eliminado_en IS NULL) AS rechazados,
            (SELECT COUNT(*)::int FROM anuncios WHERE estado = 'PAUSADO' AND eliminado_en IS NULL) AS pausados,
            (SELECT COUNT(*)::int FROM anuncios WHERE creado_en > NOW() - INTERVAL '7 days') AS anuncios_semana,
            (SELECT COUNT(DISTINCT anuncio_id)::int FROM denuncias WHERE estado = 'PENDIENTE') AS denunciados,
            (SELECT COUNT(*)::int FROM moderacion_eventos WHERE admin_id IS NOT NULL AND creado_en > NOW() - INTERVAL '7 days') AS decisiones_semana,
            (SELECT MIN(creado_en) FROM anuncios WHERE estado = 'PENDIENTE_REVISION') AS pendiente_mas_antiguo
    `);
    // Publicaciones de los últimos 14 días, para la serie del panel.
    const { rows: serie } = await pool.query(`
        -- Texto 'YYYY-MM-DD': un DATE crudo, node-pg lo convierte en Date y viaja
        -- como '2026-10-02T05:00:00.000Z', que el panel no sabe leer (salía NaN).
        SELECT to_char(d, 'YYYY-MM-DD') AS dia,
               (SELECT COUNT(*)::int FROM anuncios a WHERE a.creado_en >= d AND a.creado_en < d + INTERVAL '1 day') AS total
        FROM generate_series(date_trunc('day', NOW()) - INTERVAL '13 days', date_trunc('day', NOW()), INTERVAL '1 day') d
        ORDER BY d`);
    return { ...rows[0], serie };
};

module.exports = {
    obtenerConfig,
    guardarConfig,
    listarPalabras,
    guardarPalabra,
    eliminarPalabra,
    registrarEvento,
    eventosDe,
    crearDenuncia,
    contarDenunciantesPendientes,
    denunciasDe,
    resolverDenuncias,
    listarAnuncios,
    anuncioAdmin,
    fotosDe,
    moderarAnuncio,
    enviarARevision,
    listarUsuarios,
    usuarioBasico,
    cambiarEstadoUsuario,
    contadores,
    estadisticas,
};
