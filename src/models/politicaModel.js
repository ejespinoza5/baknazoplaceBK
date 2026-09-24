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

module.exports = {
    listarVigentes,
    buscarPorClaveYVersionVigente,
};