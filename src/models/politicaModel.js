const pool = require('../config/db');

const listarVigentes = async () => {
    const { rows } = await pool.query(
        `SELECT id, clave, version, titulo, contenido, fecha_publicacion
         FROM politicas
         WHERE vigente = TRUE
         ORDER BY clave`
    );
    return rows;
};

const buscarPorClaveYVersionVigente = async (clave, version) => {
    const { rows } = await pool.query(
        `SELECT id, clave, version
         FROM politicas
         WHERE clave = $1 AND version = $2 AND vigente = TRUE`,
        [clave, version]
    );
    return rows[0] || null;
};

// Las vigentes que el usuario todavía no aceptó (p. ej. tras publicar una versión nueva).
const listarPendientesDe = async (usuarioId) => {
    const { rows } = await pool.query(
        `SELECT p.id, p.clave, p.version, p.titulo, p.contenido, p.fecha_publicacion
         FROM politicas p
         WHERE p.vigente = TRUE
           AND NOT EXISTS (
               SELECT 1 FROM aceptaciones_politicas a
               WHERE a.usuario_id = $1 AND a.politica_id = p.id
           )
         ORDER BY p.clave`,
        [usuarioId]
    );
    return rows;
};

module.exports = {
    listarVigentes,
    buscarPorClaveYVersionVigente,
    listarPendientesDe,
};