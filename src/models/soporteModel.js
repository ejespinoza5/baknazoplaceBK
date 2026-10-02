const pool = require('../config/db');

// El hilo de soporte de cada usuario con el equipo de Baknazo (uno por
// usuario). Ver la sección "Soporte" de script.sql.

const COLUMNAS = 'id, usuario_id, autor, admin_id, contenido, creado_en, leido_en';

const hilo = async (usuarioId) => {
    const { rows } = await pool.query('SELECT * FROM soporte_hilos WHERE usuario_id = $1', [usuarioId]);
    return rows[0] || null;
};

/**
 * Guarda lo que escribe el usuario. Si es su primer mensaje, o el hilo estaba
 * resuelto, el hilo se (re)abre y va también la respuesta automática; todo en
 * una transacción para que dos envíos a la vez no la dupliquen.
 * Devuelve los mensajes creados, en orden.
 */
const insertarDeUsuario = async ({ usuarioId, contenido, respuestaAutomatica }) => {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        // Solo una de dos transacciones simultáneas consigue insertar.
        const nuevo =
            (await cliente.query('INSERT INTO soporte_hilos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING usuario_id', [usuarioId]))
                .rowCount > 0;
        let reabierto = false;
        if (!nuevo) {
            const { rows } = await cliente.query('SELECT estado FROM soporte_hilos WHERE usuario_id = $1 FOR UPDATE', [usuarioId]);
            reabierto = rows[0]?.estado === 'RESUELTO';
        }
        await cliente.query(
            `UPDATE soporte_hilos
             SET estado = 'ABIERTO', ultimo_mensaje_en = NOW(), resuelto_por = NULL, resuelto_en = NULL
             WHERE usuario_id = $1`,
            [usuarioId]
        );
        const creados = [];
        const r = await cliente.query(
            `INSERT INTO soporte_mensajes (usuario_id, autor, contenido) VALUES ($1, 'USUARIO', $2) RETURNING ${COLUMNAS}`,
            [usuarioId, contenido]
        );
        creados.push(r.rows[0]);
        if (nuevo || reabierto) {
            const a = await cliente.query(
                `INSERT INTO soporte_mensajes (usuario_id, autor, contenido) VALUES ($1, 'SISTEMA', $2) RETURNING ${COLUMNAS}`,
                [usuarioId, respuestaAutomatica]
            );
            creados.push(a.rows[0]);
        }
        await cliente.query('COMMIT');
        return creados;
    } catch (e) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw e;
    } finally {
        cliente.release();
    }
};

/**
 * La respuesta de un administrador. Responder es haber leído lo anterior.
 * Devuelve null si el usuario no tiene hilo (no se abre uno desde el panel).
 */
const insertarDeAdmin = async ({ usuarioId, adminId, contenido }) => {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        const h = await cliente.query('UPDATE soporte_hilos SET ultimo_mensaje_en = NOW() WHERE usuario_id = $1 RETURNING usuario_id', [usuarioId]);
        if (h.rowCount === 0) {
            await cliente.query('ROLLBACK');
            return null;
        }
        await cliente.query(
            `UPDATE soporte_mensajes SET leido_en = NOW()
             WHERE usuario_id = $1 AND autor = 'USUARIO' AND leido_en IS NULL`,
            [usuarioId]
        );
        const { rows } = await cliente.query(
            `INSERT INTO soporte_mensajes (usuario_id, autor, admin_id, contenido) VALUES ($1, 'ADMIN', $2, $3) RETURNING ${COLUMNAS}`,
            [usuarioId, adminId, contenido]
        );
        await cliente.query('COMMIT');
        return rows[0];
    } catch (e) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw e;
    } finally {
        cliente.release();
    }
};

// Del más nuevo hacia atrás; con el nombre de quien respondió (solo el panel lo usa).
const listarMensajes = async ({ usuarioId, antesDe, limite }) => {
    const { rows } = await pool.query(
        `SELECT m.id, m.usuario_id, m.autor, m.admin_id, m.contenido, m.creado_en, m.leido_en, a.nombre AS admin_nombre
         FROM soporte_mensajes m
         LEFT JOIN administradores a ON a.id = m.admin_id
         WHERE m.usuario_id = $1 AND ($2::bigint IS NULL OR m.id < $2)
         ORDER BY m.id DESC
         LIMIT $3`,
        [usuarioId, antesDe, limite]
    );
    return rows;
};

// El usuario leyó lo del equipo.
const marcarLeidosPorUsuario = async (usuarioId) => {
    const { rowCount } = await pool.query(
        `UPDATE soporte_mensajes SET leido_en = NOW()
         WHERE usuario_id = $1 AND autor <> 'USUARIO' AND leido_en IS NULL`,
        [usuarioId]
    );
    return rowCount;
};

// El equipo leyó lo del usuario.
const marcarLeidosPorEquipo = async (usuarioId) => {
    const { rows } = await pool.query(
        `UPDATE soporte_mensajes SET leido_en = NOW()
         WHERE usuario_id = $1 AND autor = 'USUARIO' AND leido_en IS NULL
         RETURNING id, leido_en`,
        [usuarioId]
    );
    return rows;
};

const contarNoLeidosUsuario = async (usuarioId) => {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM soporte_mensajes
         WHERE usuario_id = $1 AND autor <> 'USUARIO' AND leido_en IS NULL`,
        [usuarioId]
    );
    return rows[0].total;
};

const cambiarEstado = async (usuarioId, estado, adminId) => {
    const { rowCount } = await pool.query(
        `UPDATE soporte_hilos
         SET estado = $2::varchar,
             resuelto_por = CASE WHEN $2::varchar = 'RESUELTO' THEN $3::uuid END,
             resuelto_en = CASE WHEN $2::varchar = 'RESUELTO' THEN NOW() END
         WHERE usuario_id = $1`,
        [usuarioId, estado, adminId]
    );
    return rowCount > 0;
};

// ---------- Panel ----------

const FILTRO_VISTA = {
    pendientes: `EXISTS (SELECT 1 FROM soporte_mensajes p WHERE p.usuario_id = h.usuario_id AND p.autor = 'USUARIO' AND p.leido_en IS NULL)`,
    abiertos: `h.estado = 'ABIERTO'`,
    resueltos: `h.estado = 'RESUELTO'`,
    todos: 'TRUE',
};

const listarHilos = async ({ vista, q, limite, offset }) => {
    const { rows } = await pool.query(
        `SELECT h.usuario_id, h.estado, h.creado_en, h.ultimo_mensaje_en, h.resuelto_en,
                u.nombres, u.apellidos, u.correo, u.tipo_cuenta, u.estado AS usuario_estado, n.nombre_comercial,
                (SELECT COUNT(*)::int FROM soporte_mensajes p
                  WHERE p.usuario_id = h.usuario_id AND p.autor = 'USUARIO' AND p.leido_en IS NULL) AS pendientes,
                um.autor AS ultimo_autor, LEFT(um.contenido, 160) AS ultimo_contenido,
                COUNT(*) OVER()::int AS total
         FROM soporte_hilos h
         JOIN usuarios u ON u.id = h.usuario_id
         LEFT JOIN negocios n ON n.usuario_id = u.id
         LEFT JOIN LATERAL (
             SELECT autor, contenido FROM soporte_mensajes WHERE usuario_id = h.usuario_id ORDER BY id DESC LIMIT 1
         ) um ON TRUE
         WHERE ${FILTRO_VISTA[vista] || 'TRUE'}
           AND ($1::text IS NULL OR u.correo ILIKE '%' || $1 || '%'
                OR f_unaccent(lower(u.nombres || ' ' || COALESCE(u.apellidos, '') || ' ' || COALESCE(n.nombre_comercial, ''))) LIKE '%' || f_unaccent(lower($1)) || '%')
         ORDER BY h.ultimo_mensaje_en DESC
         LIMIT $2 OFFSET $3`,
        [q, limite, offset]
    );
    return rows;
};

// Quién escribe, para la cabecera de la conversación en el panel.
const usuarioDelHilo = async (usuarioId) => {
    const { rows } = await pool.query(
        `SELECT h.usuario_id, h.estado, h.creado_en, h.resuelto_en, r.nombre AS resuelto_por_nombre,
                u.nombres, u.apellidos, u.correo, u.tipo_cuenta, u.estado AS usuario_estado,
                u.creado_en AS usuario_desde, n.nombre_comercial,
                (SELECT COUNT(*)::int FROM anuncios a WHERE a.autor_usuario_id = u.id AND a.eliminado_en IS NULL) AS anuncios
         FROM soporte_hilos h
         JOIN usuarios u ON u.id = h.usuario_id
         LEFT JOIN negocios n ON n.usuario_id = u.id
         LEFT JOIN administradores r ON r.id = h.resuelto_por
         WHERE h.usuario_id = $1`,
        [usuarioId]
    );
    return rows[0] || null;
};

// Hilos con algo del usuario sin leer (el contador del panel).
const contarPendientes = async () => {
    const { rows } = await pool.query(
        `SELECT COUNT(DISTINCT usuario_id)::int AS total FROM soporte_mensajes
         WHERE autor = 'USUARIO' AND leido_en IS NULL`
    );
    return rows[0].total;
};

module.exports = {
    hilo,
    insertarDeUsuario,
    insertarDeAdmin,
    listarMensajes,
    marcarLeidosPorUsuario,
    marcarLeidosPorEquipo,
    contarNoLeidosUsuario,
    cambiarEstado,
    listarHilos,
    usuarioDelHilo,
    contarPendientes,
};
