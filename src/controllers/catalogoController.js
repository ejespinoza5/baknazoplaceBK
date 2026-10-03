const catalogoModel = require('../models/catalogoModel');
const cacheService = require('../services/cacheService');
const { ENUMERACIONES, MAX_FOTOS, MAX_BYTES_FOTO } = require('../config/anuncios');

// GET /api/catalogos: todo lo que el formulario de publicar necesita en una sola llamada.
const calcularCatalogos = async () => {
    const [categorias, cantones] = await Promise.all([
        catalogoModel.listarCategoriasAnuncio(),
        catalogoModel.listarCantones(),
    ]);

    // Agrupa los cantones por provincia conservando el orden alfabético.
    const porProvincia = new Map();
    for (const c of cantones) {
        if (!porProvincia.has(c.provincia_codigo)) {
            porProvincia.set(c.provincia_codigo, {
                codigo: c.provincia_codigo,
                nombre: c.provincia_nombre,
                cantones: [],
            });
        }
        porProvincia.get(c.provincia_codigo).cantones.push({ codigo: c.codigo, nombre: c.nombre });
    }
    return {
        categorias,
        provincias: [...porProvincia.values()],
        enumeraciones: ENUMERACIONES,
        maxFotos: MAX_FOTOS,
        maxBytesFoto: MAX_BYTES_FOTO,
    };
};

const obtenerCatalogos = async (req, res, next) => {
    try {
        // Categorías y cantones casi nunca cambian: una hora en caché.
        const datos = await cacheService.recordar('catalogos', 'todo', 60 * 60, calcularCatalogos);
        // El navegador también puede guardarlo unos minutos.
        res.set('Cache-Control', 'public, max-age=300');
        res.json(datos);
    } catch (err) {
        next(err);
    }
};

// GET /api/catalogos/resumen: cifras para "Explorar" y el menú de categorías.
// Cuenta anuncios visibles del feed (publicados, vigentes, sin vender).
const calcularResumen = async () => {
    const [porCategoria, ciudades, conUbicacion] = await Promise.all([
        catalogoModel.contarPorCategoria(),
        catalogoModel.cantonesConMasAnuncios(8),
        catalogoModel.contarConUbicacion(),
    ]);
    return {
        total: porCategoria.reduce((suma, f) => suma + f.total, 0),
        categorias: Object.fromEntries(porCategoria.map((f) => [f.id, f.total])),
        ciudades: ciudades.map((c) => ({
            codigo: c.codigo,
            nombre: c.nombre,
            provincia: c.provincia_nombre,
            total: c.total,
        })),
        conUbicacion,
    };
};

const obtenerResumen = async (req, res, next) => {
    try {
        // Son conteos sobre toda la tabla: se calculan como mucho una vez por
        // minuto (o apenas se publica algo, que invalida la caché).
        const datos = await cacheService.recordar('resumen', 'todo', 60, calcularResumen);
        res.set('Cache-Control', 'public, max-age=60');
        res.json(datos);
    } catch (err) {
        next(err);
    }
};

module.exports = { obtenerCatalogos, obtenerResumen };
