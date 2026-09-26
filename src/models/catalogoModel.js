const pool = require('../config/db');

const listarCategoriasAnuncio = async () => {
    const { rows } = await pool.query(
        `SELECT id, slug, nombre, pilar
         FROM categorias_anuncio
         WHERE activa
         ORDER BY pilar, orden, nombre`
    );
    return rows;
};

const buscarCategoriaAnuncio = async (id, client) => {
    const db = client || pool;
    const { rows } = await db.query(
        `SELECT id, slug, nombre, pilar, activa FROM categorias_anuncio WHERE id = $1`,
        [id]
    );
    return rows[0] || null;
};

const listarCantones = async () => {
    const { rows } = await pool.query(
        `SELECT codigo, nombre, provincia_codigo, provincia_nombre
         FROM cantones
         ORDER BY provincia_nombre, nombre`
    );
    return rows;
};

const buscarCanton = async (codigo, client) => {
    const db = client || pool;
    const { rows } = await db.query(
        `SELECT codigo, nombre, provincia_codigo, provincia_nombre FROM cantones WHERE codigo = $1`,
        [codigo]
    );
    return rows[0] || null;
};

module.exports = { listarCategoriasAnuncio, buscarCategoriaAnuncio, listarCantones, buscarCanton };
