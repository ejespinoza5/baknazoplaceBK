const anuncioService = require('../services/anuncioService');
const { parsearJson } = require('../utils/validaciones');

// Base para armar URLs absolutas de las fotos (/uploads/...).
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// multipart/form-data: los datos llegan como JSON string en el campo 'datos'.
// application/json (edición sin fotos): el cuerpo completo son los datos.
const leerDatos = (req) => {
    const body = req.body || {};
    const datos = body.datos !== undefined ? parsearJson(body.datos, 'datos') : body;
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        const err = new Error('datos debe ser un objeto JSON');
        err.status = 400;
        throw err;
    }
    return datos;
};

const crear = async (req, res, next) => {
    try {
        const idempotencyKey = req.get('Idempotency-Key') || null;
        const { repetido, ...resultado } = await anuncioService.crear({
            usuario: req.usuario,
            datos: leerDatos(req),
            archivos: req.files || [],
            idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
            base: baseUrl(req),
        });
        if (repetido) res.set('Idempotent-Replayed', 'true');
        res.status(201).json(resultado);
    } catch (err) {
        next(err);
    }
};

const listar = async (req, res, next) => {
    try {
        const resultado = await anuncioService.listarFeed({
            query: req.query,
            // Opcional a propósito: el feed se puede ver sin iniciar sesión, y
            // quien sí lo está solo necesita que el Backend sepa cuáles de los
            // anuncios son suyos para marcarlo.
            usuarioId: req.usuario?.id || null,
            base: baseUrl(req),
        });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const listarMios = async (req, res, next) => {
    try {
        const resultado = await anuncioService.listarMios({
            usuarioId: req.usuario.id,
            query: req.query,
            base: baseUrl(req),
        });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const obtener = async (req, res, next) => {
    try {
        const anuncio = await anuncioService.obtener({
            idOSlug: req.params.id,
            usuarioId: req.usuario?.id || null,
            base: baseUrl(req),
        });
        res.json({ anuncio });
    } catch (err) {
        next(err);
    }
};

const actualizar = async (req, res, next) => {
    try {
        const anuncio = await anuncioService.actualizar({
            id: req.params.id,
            usuarioId: req.usuario.id,
            datos: leerDatos(req),
            archivos: req.files || [],
            base: baseUrl(req),
        });
        res.json({ anuncio });
    } catch (err) {
        next(err);
    }
};

const eliminar = async (req, res, next) => {
    try {
        await anuncioService.eliminar({ id: req.params.id, usuarioId: req.usuario.id });
        res.status(204).end();
    } catch (err) {
        next(err);
    }
};

const revelarContacto = async (req, res, next) => {
    try {
        const resultado = await anuncioService.revelarContacto({ id: req.params.id, usuarioId: req.usuario.id });
        // El teléfono es un dato personal: ni el navegador ni un proxy deben
        // guardarlo, o quedaría accesible sin volver a pedir permiso.
        res.set('Cache-Control', 'no-store');
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

module.exports = { crear, listar, listarMios, obtener, actualizar, eliminar, revelarContacto };
