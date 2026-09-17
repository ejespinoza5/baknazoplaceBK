const pool = require('../config/db');

const listarActivas = async () => {
    const { rows } = await pool.query(
        `SELECT id, nombre FROM categorias WHERE estado = 'ACTIVO' ORDER BY nombre`
    );
    return rows;
};

const buscarPorId = async (id) => {
    const { rows } = await pool.query(`SELECT id, nombre FROM categorias WHERE id = $1`, [id]);
    return rows[0] || null;
};

module.exports = { listarActivas, buscarPorId };