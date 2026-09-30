const catalogoModel = require('../models/catalogoModel');
const { ENUMERACIONES, MAX_FOTOS, MAX_BYTES_FOTO } = require('../config/anuncios');

// GET /api/catalogos: todo lo que el formulario de publicar necesita en una sola llamada.
const obtenerCatalogos = async (req, res, next) => {
    try {
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

        // Cambia poco: el cliente puede cachearlo unos minutos.
        res.set('Cache-Control', 'public, max-age=300');
        res.json({
            categorias,
            provincias: [...porProvincia.values()],
            enumeraciones: ENUMERACIONES,
            maxFotos: MAX_FOTOS,
            maxBytesFoto: MAX_BYTES_FOTO,
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/catalogos/resumen: cifras para "Explorar" y el menú de categorías.
// Cuenta anuncios visibles del feed (publicados, vigentes, sin vender).
const obtenerResumen = async (req, res, next) => {
    try {
        const [porCategoria, ciudades, conUbicacion] = await Promise.all([
            catalogoModel.contarPorCategoria(),
            catalogoModel.cantonesConMasAnuncios(8),
            catalogoModel.contarConUbicacion(),
        ]);
        const categorias = Object.fromEntries(porCategoria.map((f) => [f.id, f.total]));
        const total = porCategoria.reduce((suma, f) => suma + f.total, 0);

        // Cambia a cada publicación, pero un minuto de retraso no le importa a nadie.
        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            total,
            categorias,
            ciudades: ciudades.map((c) => ({
                codigo: c.codigo,
                nombre: c.nombre,
                provincia: c.provincia_nombre,
                total: c.total,
            })),
            conUbicacion,
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { obtenerCatalogos, obtenerResumen };
