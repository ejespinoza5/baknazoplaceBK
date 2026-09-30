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

// Mismo predicado que el feed: publicados, vigentes y sin vender.
const VISIBLE_FEED = `a.estado = 'PUBLICADO' AND a.eliminado_en IS NULL
    AND (a.expira_en IS NULL OR a.expira_en > NOW()) AND NOT a.vendido`;

// Cuántos anuncios visibles hay en cada categoría (para "Explorar" y el menú).
const contarPorCategoria = async () => {
    const { rows } = await pool.query(
        `SELECT a.categoria_id AS id, COUNT(*)::int AS total
         FROM anuncios a
         WHERE ${VISIBLE_FEED}
         GROUP BY a.categoria_id`
    );
    return rows;
};

// Las ciudades con más anuncios visibles.
const cantonesConMasAnuncios = async (limite = 8) => {
    const { rows } = await pool.query(
        `SELECT ca.codigo, ca.nombre, ca.provincia_nombre, COUNT(*)::int AS total
         FROM anuncios a
         JOIN cantones ca ON ca.codigo = a.canton_codigo
         WHERE ${VISIBLE_FEED}
         GROUP BY ca.codigo, ca.nombre, ca.provincia_nombre
         ORDER BY total DESC, ca.nombre
         LIMIT $1`,
        [limite]
    );
    return rows;
};

// Anuncios visibles que comparten ubicación (los únicos que salen en "Cerca de ti").
const contarConUbicacion = async () => {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM anuncios a WHERE ${VISIBLE_FEED} AND a.latitud IS NOT NULL`
    );
    return rows[0].total;
};

module.exports = {
    listarCategoriasAnuncio,
    buscarCategoriaAnuncio,
    listarCantones,
    buscarCanton,
    contarPorCategoria,
    cantonesConMasAnuncios,
    contarConUbicacion,
};
