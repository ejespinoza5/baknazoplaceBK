const pool = require('../config/db');

// Datos de la postulación + la vacante + quien se postuló, en una sola fila.
const SELECT_BASE = `
    SELECT p.*,
           a.titulo AS anuncio_titulo, a.slug AS anuncio_slug, a.autor_usuario_id AS dueno_id,
           a.estado AS anuncio_estado, a.vendido AS anuncio_cerrado,
           u.nombres AS postulante_nombres, u.apellidos AS postulante_apellidos,
           u.foto_perfil AS postulante_foto, u.correo AS postulante_correo,
           d.nombres AS dueno_nombres, d.apellidos AS dueno_apellidos,
           n.nombre_comercial AS negocio_nombre, n.logo_url AS negocio_logo
    FROM postulaciones p
    JOIN anuncios a ON a.id = p.anuncio_id
    JOIN usuarios u ON u.id = p.postulante_id
    JOIN usuarios d ON d.id = a.autor_usuario_id
    LEFT JOIN negocios n ON n.id = a.autor_negocio_id`;

// Devuelve null si esa persona ya se había postulado (UNIQUE anuncio+postulante).
const crear = async ({ anuncioId, postulanteId, mensaje, telefono, cvKey, cvNombre, cvBytes }) => {
    const { rows } = await pool.query(
        `INSERT INTO postulaciones (anuncio_id, postulante_id, mensaje, telefono, cv_key, cv_nombre, cv_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (anuncio_id, postulante_id) DO NOTHING
         RETURNING id`,
        [anuncioId, postulanteId, mensaje, telefono, cvKey, cvNombre, cvBytes]
    );
    return rows[0]?.id ?? null;
};

const buscarPorId = async (id) => {
    const { rows } = await pool.query(`${SELECT_BASE} WHERE p.id = $1`, [id]);
    return rows[0] || null;
};

// Bandeja del dueño: todas las postulaciones a sus vacantes, filtrables.
const listarRecibidas = async ({ duenoId, anuncioId, estado, limite, offset }) => {
    const { rows } = await pool.query(
        `${SELECT_BASE}
         WHERE a.autor_usuario_id = $1 AND a.eliminado_en IS NULL
           AND ($2::bigint IS NULL OR p.anuncio_id = $2)
           AND ($3::text IS NULL OR p.estado = $3)
         ORDER BY (p.estado = 'NUEVA') DESC, p.creado_en DESC, p.id DESC
         LIMIT $4 OFFSET $5`,
        [duenoId, anuncioId, estado, limite, offset]
    );
    return rows;
};

// Cifras de la bandeja: por estado y por vacante (para los filtros).
const resumenRecibidas = async (duenoId) => {
    const [porEstado, porVacante] = await Promise.all([
        pool.query(
            `SELECT p.estado, COUNT(*)::int AS total
             FROM postulaciones p JOIN anuncios a ON a.id = p.anuncio_id
             WHERE a.autor_usuario_id = $1 AND a.eliminado_en IS NULL
             GROUP BY p.estado`,
            [duenoId]
        ),
        pool.query(
            `SELECT a.id, a.titulo, a.estado, a.vendido,
                    COUNT(p.id)::int AS total,
                    COUNT(p.id) FILTER (WHERE p.estado = 'NUEVA')::int AS nuevas
             FROM anuncios a
             LEFT JOIN postulaciones p ON p.anuncio_id = a.id
             WHERE a.autor_usuario_id = $1 AND a.pilar = 'empleo' AND a.eliminado_en IS NULL
             GROUP BY a.id
             ORDER BY nuevas DESC, a.creado_en DESC`,
            [duenoId]
        ),
    ]);
    return { porEstado: porEstado.rows, porVacante: porVacante.rows };
};

const listarEnviadas = async ({ postulanteId, limite, offset }) => {
    const { rows } = await pool.query(
        `${SELECT_BASE}
         WHERE p.postulante_id = $1
         ORDER BY p.creado_en DESC, p.id DESC
         LIMIT $2 OFFSET $3`,
        [postulanteId, limite, offset]
    );
    return rows;
};

const actualizar = async (id, { estado, notaInterna }) => {
    await pool.query(
        `UPDATE postulaciones
         SET estado = COALESCE($2, estado),
             nota_interna = CASE WHEN $3::boolean THEN $4 ELSE nota_interna END
         WHERE id = $1`,
        [id, estado ?? null, notaInterna !== undefined, notaInterna ?? null]
    );
};

// Al abrir el CV por primera vez, "Nueva" pasa a "Vista". Solo desde NUEVA:
// no pisa una decisión que el dueño ya tomó.
const marcarVista = async (id) => {
    await pool.query(`UPDATE postulaciones SET estado = 'VISTA' WHERE id = $1 AND estado = 'NUEVA'`, [id]);
};

const eliminar = async (id) => {
    await pool.query(`DELETE FROM postulaciones WHERE id = $1`, [id]);
};

// Para la ficha del anuncio: si quien mira ya se postuló, y cuántas tiene el dueño.
const deUsuarioEnAnuncio = async (anuncioId, usuarioId) => {
    const { rows } = await pool.query(
        `SELECT id, estado, creado_en FROM postulaciones WHERE anuncio_id = $1 AND postulante_id = $2`,
        [anuncioId, usuarioId]
    );
    return rows[0] || null;
};

const contarPorAnuncio = async (anuncioId) => {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE estado = 'NUEVA')::int AS nuevas
         FROM postulaciones WHERE anuncio_id = $1`,
        [anuncioId]
    );
    return rows[0];
};

module.exports = {
    crear,
    buscarPorId,
    listarRecibidas,
    resumenRecibidas,
    listarEnviadas,
    actualizar,
    marcarVista,
    eliminar,
    deUsuarioEnAnuncio,
    contarPorAnuncio,
};
