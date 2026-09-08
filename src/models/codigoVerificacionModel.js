const pool = require('../config/db');

const crear = async ({ usuarioId, codigoHash, expiraEn }) => {
    const { rows } = await pool.query(
        `INSERT INTO codigos_verificacion (usuario_id, codigo_hash, expira_en)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [usuarioId, codigoHash, expiraEn]
    );
    return rows[0];
};

const buscarVigentePorUsuario = async (usuarioId) => {
    const { rows } = await pool.query(
        `SELECT * FROM codigos_verificacion
         WHERE usuario_id = $1 AND verificado_en IS NULL
         ORDER BY creado_en DESC
         LIMIT 1`,
        [usuarioId]
    );
    return rows[0] || null;
};

const incrementarIntentos = async (id) => {
    await pool.query(
        `UPDATE codigos_verificacion SET intentos = intentos + 1 WHERE id = $1`,
        [id]
    );
};

const marcarVerificado = async (id) => {
    await pool.query(
        `UPDATE codigos_verificacion SET verificado_en = NOW() WHERE id = $1`,
        [id]
    );
};

module.exports = { crear, buscarVigentePorUsuario, incrementarIntentos, marcarVerificado };
