const pool = require('../config/db');

// 'client' permite ejecutarlo dentro de la transacción del registro
// (cuando llega el usuario_id recién creado).
const crear = async ({ usuarioId, politicaId, ip, userAgent, client }) => {
    const db = client || pool;
    const { rows } = await db.query(
        `INSERT INTO aceptaciones_politicas (usuario_id, politica_id, ip, user_agent)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [usuarioId, politicaId, ip || null, userAgent || null]
    );
    return rows[0];
};

module.exports = {
    crear,
};