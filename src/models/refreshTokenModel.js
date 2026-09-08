const pool = require('../config/db');

const crear = async ({ usuarioId, tokenHash, expiraEn }) => {
    const { rows } = await pool.query(
        `INSERT INTO tokens_actualizacion (usuario_id, token_hash, expira_en)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [usuarioId, tokenHash, expiraEn]
    );
    return rows[0];
};

const buscarPorHash = async (tokenHash) => {
    const { rows } = await pool.query(
        `SELECT * FROM tokens_actualizacion WHERE token_hash = $1`,
        [tokenHash]
    );
    return rows[0] || null;
};

const revocarPorId = async (id) => {
    await pool.query(
        `UPDATE tokens_actualizacion SET revocado_en = NOW() WHERE id = $1 AND revocado_en IS NULL`,
        [id]
    );
};

const revocarTodosDelUsuario = async (usuarioId) => {
    await pool.query(
        `UPDATE tokens_actualizacion SET revocado_en = NOW()
         WHERE usuario_id = $1 AND revocado_en IS NULL`,
        [usuarioId]
    );
};

module.exports = { crear, buscarPorHash, revocarPorId, revocarTodosDelUsuario };
