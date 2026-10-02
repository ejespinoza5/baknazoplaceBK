const pool = require('../config/db');

// Un administrador con sus permisos (sin el hash de la contraseña, salvo que
// se pida para comprobarla).
const SELECT_ADMIN = `
    SELECT a.id, a.nombre, a.correo, a.es_super, a.activo, a.debe_cambiar_contrasena,
           a.intentos_fallidos, a.bloqueado_hasta, a.ultimo_acceso_en, a.contrasena_cambiada_en,
           a.creado_en, a.actualizado_en, a.creado_por,
           COALESCE((SELECT array_agg(p.permiso ORDER BY p.permiso) FROM administrador_permisos p WHERE p.admin_id = a.id), '{}') AS permisos
    FROM administradores a`;

const buscarPorId = async (id) => {
    const { rows } = await pool.query(`${SELECT_ADMIN} WHERE a.id = $1 AND a.eliminado_en IS NULL`, [id]);
    return rows[0] || null;
};

// Para iniciar sesión: incluye el hash.
const buscarParaLogin = async (correo) => {
    const { rows } = await pool.query(
        `SELECT id, contrasena_hash, activo, intentos_fallidos, bloqueado_hasta
         FROM administradores WHERE correo = $1 AND eliminado_en IS NULL`,
        [correo]
    );
    return rows[0] || null;
};

const hashDe = async (id) => {
    const { rows } = await pool.query('SELECT contrasena_hash FROM administradores WHERE id = $1', [id]);
    return rows[0]?.contrasena_hash ?? null;
};

const correoEnUso = async (correo, exceptoId = null) => {
    const { rows } = await pool.query(
        `SELECT 1 FROM administradores WHERE correo = $1 AND eliminado_en IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
        [correo, exceptoId]
    );
    return rows.length > 0;
};

const existeSuper = async () => {
    const { rows } = await pool.query('SELECT 1 FROM administradores WHERE es_super AND eliminado_en IS NULL');
    return rows.length > 0;
};

const crear = async ({ nombre, correo, hash, esSuper = false, creadoPor = null }) => {
    const { rows } = await pool.query(
        `INSERT INTO administradores (nombre, correo, contrasena_hash, es_super, creado_por, debe_cambiar_contrasena)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
        [nombre, correo, hash, esSuper, creadoPor]
    );
    return rows[0].id;
};

const listar = async () => {
    const { rows } = await pool.query(
        `${SELECT_ADMIN.replace('FROM administradores a', `,
             (SELECT COUNT(*)::int FROM auditoria_admin au WHERE au.admin_id = a.id) AS acciones
         FROM administradores a`)}
         WHERE a.eliminado_en IS NULL
         ORDER BY a.es_super DESC, a.creado_en`
    );
    return rows;
};

const actualizarDatos = async (id, { nombre, correo }) => {
    await pool.query(
        `UPDATE administradores SET nombre = COALESCE($2, nombre), correo = COALESCE($3, correo) WHERE id = $1`,
        [id, nombre ?? null, correo ?? null]
    );
};

const cambiarActivo = async (id, activo) => {
    await pool.query('UPDATE administradores SET activo = $2 WHERE id = $1', [id, activo]);
};

// Contraseña nueva. `temporal` = la puso otro y debe cambiarla al entrar.
const cambiarContrasena = async (id, hash, temporal) => {
    await pool.query(
        `UPDATE administradores
         SET contrasena_hash = $2, debe_cambiar_contrasena = $3, contrasena_cambiada_en = NOW(),
             intentos_fallidos = 0, bloqueado_hasta = NULL
         WHERE id = $1`,
        [id, hash, temporal]
    );
};

const eliminar = async (id) => {
    await pool.query('UPDATE administradores SET eliminado_en = NOW(), activo = FALSE WHERE id = $1', [id]);
    await pool.query('DELETE FROM administrador_permisos WHERE admin_id = $1', [id]);
};

const registrarFallo = async (id) => {
    // A los cinco fallos seguidos, quince minutos de bloqueo.
    await pool.query(
        `UPDATE administradores
         SET intentos_fallidos = intentos_fallidos + 1,
             bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE bloqueado_hasta END
         WHERE id = $1`,
        [id]
    );
};

const registrarAcceso = async (id) => {
    await pool.query(
        'UPDATE administradores SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso_en = NOW() WHERE id = $1',
        [id]
    );
};

const reemplazarPermisos = async (id, permisos, otorgadoPor) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM administrador_permisos WHERE admin_id = $1', [id]);
        for (const p of permisos) {
            await client.query(
                'INSERT INTO administrador_permisos (admin_id, permiso, otorgado_por) VALUES ($1, $2, $3)',
                [id, p, otorgadoPor]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};

// ---------- Sesiones ----------

const crearSesion = async ({ adminId, tokenHash, ip, userAgent, expiraEn }) => {
    const { rows } = await pool.query(
        `INSERT INTO sesiones_admin (admin_id, token_hash, ip, user_agent, expira_en)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [adminId, tokenHash, ip, userAgent, expiraEn]
    );
    return rows[0].id;
};

const buscarSesion = async (tokenHash) => {
    const { rows } = await pool.query(
        `SELECT s.id, s.admin_id, s.expira_en, s.revocada_en, s.ultimo_uso_en
         FROM sesiones_admin s WHERE s.token_hash = $1`,
        [tokenHash]
    );
    return rows[0] || null;
};

const tocarSesion = async (id) => {
    await pool.query('UPDATE sesiones_admin SET ultimo_uso_en = NOW() WHERE id = $1', [id]);
};

const revocarSesion = async (id) => {
    await pool.query('UPDATE sesiones_admin SET revocada_en = NOW() WHERE id = $1 AND revocada_en IS NULL', [id]);
};

const revocarSesiones = async (adminId, exceptoId = null) => {
    const { rowCount } = await pool.query(
        `UPDATE sesiones_admin SET revocada_en = NOW()
         WHERE admin_id = $1 AND revocada_en IS NULL AND ($2::bigint IS NULL OR id <> $2)`,
        [adminId, exceptoId]
    );
    return rowCount;
};

const listarSesiones = async (adminId) => {
    const { rows } = await pool.query(
        `SELECT id, ip, user_agent, creado_en, ultimo_uso_en, expira_en
         FROM sesiones_admin
         WHERE admin_id = $1 AND revocada_en IS NULL AND expira_en > NOW()
         ORDER BY ultimo_uso_en DESC`,
        [adminId]
    );
    return rows;
};

// ---------- Auditoría ----------

const auditar = async ({ adminId, accion, objetivoTipo = null, objetivoId = null, detalle = {}, ip = null }) => {
    await pool.query(
        `INSERT INTO auditoria_admin (admin_id, accion, objetivo_tipo, objetivo_id, detalle, ip)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [adminId, accion, objetivoTipo, objetivoId === null ? null : String(objetivoId), JSON.stringify(detalle), ip]
    );
};

const listarAuditoria = async ({ adminId, accion, limite, offset }) => {
    const { rows } = await pool.query(
        `SELECT au.id, au.admin_id, au.accion, au.objetivo_tipo, au.objetivo_id, au.detalle, au.ip, au.creado_en,
                a.nombre AS admin_nombre, a.correo AS admin_correo,
                COUNT(*) OVER()::int AS total
         FROM auditoria_admin au LEFT JOIN administradores a ON a.id = au.admin_id
         WHERE ($1::uuid IS NULL OR au.admin_id = $1)
           AND ($2::text IS NULL OR au.accion LIKE $2 || '%')
         ORDER BY au.creado_en DESC, au.id DESC
         LIMIT $3 OFFSET $4`,
        [adminId, accion, limite, offset]
    );
    return rows;
};

module.exports = {
    buscarPorId,
    buscarParaLogin,
    hashDe,
    correoEnUso,
    existeSuper,
    crear,
    listar,
    actualizarDatos,
    cambiarActivo,
    cambiarContrasena,
    eliminar,
    registrarFallo,
    registrarAcceso,
    reemplazarPermisos,
    crearSesion,
    buscarSesion,
    tocarSesion,
    revocarSesion,
    revocarSesiones,
    listarSesiones,
    auditar,
    listarAuditoria,
};
