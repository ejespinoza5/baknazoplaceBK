const pool = require('../config/db');

// Una notificación con lo necesario para armar su texto: quién la provocó
// (con su nombre de negocio si lo es) y el anuncio al que se refiere.
const SELECT_NOTIFICACION = `
    SELECT n.*,
           u.tipo_cuenta AS actor_tipo, u.nombres AS actor_nombres, u.apellidos AS actor_apellidos,
           u.foto_perfil AS actor_foto, ne.nombre_comercial AS actor_negocio, ne.logo_url AS actor_logo,
           a.titulo AS anuncio_titulo, a.pilar AS anuncio_pilar
    FROM notificaciones n
    LEFT JOIN usuarios u ON u.id = n.actor_id
    LEFT JOIN negocios ne ON ne.usuario_id = u.id
    LEFT JOIN anuncios a ON a.id = n.anuncio_id`;

const COLUMNAS = `usuario_id, tipo, actor_id, actores, anuncio_id, conversacion_id, postulacion_id, datos,
                  clave_grupo, clave_unica, despachada_en`;
const VALORES = `$1, $2, $3, CASE WHEN $3::uuid IS NULL THEN '{}'::uuid[] ELSE ARRAY[$3::uuid] END,
                 $4, $5, $6, $7::jsonb, $8, $9, NOW()`;

// Guarda una notificación y devuelve su id, o null si no hay nada nuevo.
//  · Con clave_grupo: si ya hay una sin leer del mismo grupo, la actualiza
//    sumando a la persona (si no estaba ya). Los mensajes suman siempre.
//  · Con clave_unica: si ya existe, no hace nada.
const registrar = async (n) => {
    const params = [
        n.usuarioId,
        n.tipo,
        n.actorId ?? null,
        n.anuncioId ?? null,
        n.conversacionId ?? null,
        n.postulacionId ?? null,
        JSON.stringify(n.datos ?? {}),
        n.claveGrupo ?? null,
        n.claveUnica ?? null,
    ];
    let sql;
    if (n.claveGrupo) {
        sql = `INSERT INTO notificaciones (${COLUMNAS}) VALUES (${VALORES})
               ON CONFLICT (usuario_id, clave_grupo) WHERE leida_en IS NULL AND clave_grupo IS NOT NULL
               DO UPDATE SET
                   actor_id = COALESCE(EXCLUDED.actor_id, notificaciones.actor_id),
                   actores = CASE
                       WHEN EXCLUDED.actor_id IS NULL OR EXCLUDED.actor_id = ANY(notificaciones.actores)
                           THEN notificaciones.actores
                       ELSE notificaciones.actores || EXCLUDED.actor_id
                   END,
                   cantidad = notificaciones.cantidad + 1,
                   datos = notificaciones.datos || EXCLUDED.datos,
                   actualizada_en = NOW(),
                   despachada_en = NOW()
               -- La misma persona dos veces (like, quitar, like) no suma ni avisa otra vez.
               WHERE notificaciones.tipo = 'MENSAJE'
                  OR EXCLUDED.actor_id IS NULL
                  OR NOT (EXCLUDED.actor_id = ANY(notificaciones.actores))
               RETURNING id`;
    } else if (n.claveUnica) {
        sql = `INSERT INTO notificaciones (${COLUMNAS}) VALUES (${VALORES})
               ON CONFLICT (usuario_id, clave_unica) WHERE clave_unica IS NOT NULL DO NOTHING
               RETURNING id`;
    } else {
        sql = `INSERT INTO notificaciones (${COLUMNAS}) VALUES (${VALORES}) RETURNING id`;
    }
    const { rows } = await pool.query(sql, params);
    return rows[0]?.id ?? null;
};

const buscarPorId = async (id) => {
    const { rows } = await pool.query(`${SELECT_NOTIFICACION} WHERE n.id = $1`, [id]);
    return rows[0] || null;
};

const listar = async ({ usuarioId, soloNoLeidas, limite, offset }) => {
    const { rows } = await pool.query(
        `${SELECT_NOTIFICACION}
         WHERE n.usuario_id = $1 AND ($2::boolean = FALSE OR n.leida_en IS NULL)
         ORDER BY n.actualizada_en DESC, n.id DESC
         LIMIT $3 OFFSET $4`,
        [usuarioId, soloNoLeidas, limite, offset]
    );
    return rows;
};

const contarNoLeidas = async (usuarioId) => {
    const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS total FROM notificaciones WHERE usuario_id = $1 AND leida_en IS NULL',
        [usuarioId]
    );
    return rows[0].total;
};

// Solo las del propio usuario: el WHERE usuario_id es la autorización.
const marcarLeidas = async (usuarioId, ids = null) => {
    const { rowCount } = await pool.query(
        `UPDATE notificaciones SET leida_en = NOW()
         WHERE usuario_id = $1 AND leida_en IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
        [usuarioId, ids]
    );
    return rowCount;
};

// Al leer una conversación, su aviso de mensajes también queda leído.
const marcarLeidasDeConversacion = async (usuarioId, conversacionId) => {
    const { rowCount } = await pool.query(
        `UPDATE notificaciones SET leida_en = NOW()
         WHERE usuario_id = $1 AND conversacion_id = $2 AND tipo = 'MENSAJE' AND leida_en IS NULL`,
        [usuarioId, conversacionId]
    );
    return rowCount;
};

const marcarLeidasDeSoporte = async (usuarioId) => {
    const { rowCount } = await pool.query(
        `UPDATE notificaciones SET leida_en = NOW()
         WHERE usuario_id = $1 AND tipo = 'SOPORTE' AND leida_en IS NULL`,
        [usuarioId]
    );
    return rowCount;
};

const eliminar = async (usuarioId, id) => {
    const { rowCount } = await pool.query('DELETE FROM notificaciones WHERE usuario_id = $1 AND id = $2', [usuarioId, id]);
    return rowCount > 0;
};

const marcarPushEnviado = async (id) => {
    await pool.query('UPDATE notificaciones SET push_enviado_en = NOW() WHERE id = $1', [id]);
};

// Las que insertó la base (trigger) y nadie repartió. Se marcan en la misma
// sentencia para que dos procesos no repartan la misma.
const tomarPendientes = async (limite = 100) => {
    const { rows } = await pool.query(
        `UPDATE notificaciones SET despachada_en = NOW()
         WHERE id IN (
             SELECT id FROM notificaciones
             WHERE despachada_en IS NULL AND creada_en > NOW() - INTERVAL '2 days'
             ORDER BY id
             LIMIT $1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id`,
        [limite]
    );
    return rows.map((r) => r.id);
};

// Anuncios publicados que ya vencieron: un aviso por anuncio y fecha de
// vencimiento (si se renueva y vuelve a vencer, avisa otra vez).
const registrarVencidos = async () => {
    const { rows } = await pool.query(
        `INSERT INTO notificaciones (usuario_id, tipo, anuncio_id, clave_unica)
         SELECT a.autor_usuario_id, 'ANUNCIO_VENCIDO', a.id,
                'vencido:' || a.id || ':' || floor(extract(epoch FROM a.expira_en))::bigint
         FROM anuncios a
         WHERE a.estado = 'PUBLICADO' AND a.eliminado_en IS NULL
           AND a.expira_en IS NOT NULL AND a.expira_en <= NOW()
           AND a.expira_en > NOW() - INTERVAL '7 days'
         ON CONFLICT (usuario_id, clave_unica) WHERE clave_unica IS NOT NULL DO NOTHING
         RETURNING id`
    );
    return rows.length;
};

// Las leídas de hace más de seis meses ya no aportan nada.
const limpiarAntiguas = async () => {
    await pool.query(`DELETE FROM notificaciones WHERE leida_en IS NOT NULL AND leida_en < NOW() - INTERVAL '180 days'`);
};

// ---------- Preferencias ----------

const obtenerPreferencias = async (usuarioId) => {
    const { rows } = await pool.query(
        'SELECT categorias, sonido FROM notificacion_preferencias WHERE usuario_id = $1',
        [usuarioId]
    );
    return rows[0] || { categorias: {}, sonido: 'campana' };
};

const guardarPreferencias = async (usuarioId, { categorias, sonido }) => {
    const { rows } = await pool.query(
        `INSERT INTO notificacion_preferencias (usuario_id, categorias, sonido)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (usuario_id) DO UPDATE
             SET categorias = EXCLUDED.categorias, sonido = EXCLUDED.sonido, actualizado_en = NOW()
         RETURNING categorias, sonido`,
        [usuarioId, JSON.stringify(categorias), sonido]
    );
    return rows[0];
};

// ---------- Dispositivos ----------

// El token es del navegador: si ya estaba con otra cuenta, pasa a esta.
const registrarDispositivo = async ({ usuarioId, token, navegador }) => {
    await pool.query(
        `INSERT INTO dispositivos_push (usuario_id, token, navegador)
         VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE
             SET usuario_id = EXCLUDED.usuario_id, navegador = EXCLUDED.navegador, actualizado_en = NOW()`,
        [usuarioId, token, navegador]
    );
    // Como mucho diez dispositivos por persona: se olvidan los más viejos.
    await pool.query(
        `DELETE FROM dispositivos_push
         WHERE usuario_id = $1 AND id NOT IN (
             SELECT id FROM dispositivos_push WHERE usuario_id = $1 ORDER BY actualizado_en DESC LIMIT 10
         )`,
        [usuarioId]
    );
};

// Solo el dueño puede quitar su token.
const eliminarDispositivo = async (usuarioId, token) => {
    const { rowCount } = await pool.query('DELETE FROM dispositivos_push WHERE usuario_id = $1 AND token = $2', [usuarioId, token]);
    return rowCount > 0;
};

const tokensDe = async (usuarioId) => {
    const { rows } = await pool.query('SELECT token FROM dispositivos_push WHERE usuario_id = $1', [usuarioId]);
    return rows.map((r) => r.token);
};

const eliminarTokens = async (tokens) => {
    if (tokens.length === 0) return;
    await pool.query('DELETE FROM dispositivos_push WHERE token = ANY($1::text[])', [tokens]);
};

// Seguidores de una cuenta, para avisarles de sus vacantes nuevas. Solo
// personas: los negocios no se postulan.
const seguidoresPersonas = async (seguidoId) => {
    const { rows } = await pool.query(
        `SELECT s.seguidor_id AS id
         FROM seguidores s JOIN usuarios u ON u.id = s.seguidor_id
         WHERE s.seguido_id = $1 AND u.tipo_cuenta = 'PERSONA' AND u.estado = 'ACTIVO'`,
        [seguidoId]
    );
    return rows.map((r) => r.id);
};

module.exports = {
    registrar,
    buscarPorId,
    listar,
    contarNoLeidas,
    marcarLeidas,
    marcarLeidasDeConversacion,
    marcarLeidasDeSoporte,
    eliminar,
    marcarPushEnviado,
    tomarPendientes,
    registrarVencidos,
    limpiarAntiguas,
    obtenerPreferencias,
    guardarPreferencias,
    registrarDispositivo,
    eliminarDispositivo,
    tokensDe,
    eliminarTokens,
    seguidoresPersonas,
};
