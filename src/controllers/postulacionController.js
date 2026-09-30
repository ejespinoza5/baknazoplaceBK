const env = require('../config/env');
const postulacionService = require('../services/postulacionService');

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// POST /api/anuncios/:id/postulaciones (multipart: cv + mensaje + telefono)
const postular = async (req, res, next) => {
    try {
        const resultado = await postulacionService.postular({
            anuncioId: req.params.id,
            usuarioId: req.usuario.id,
            archivo: req.file || null,
            datos: req.body || {},
            frontendUrl: env.frontendUrl,
        });
        res.status(201).json(resultado);
    } catch (err) {
        next(err);
    }
};

const listarRecibidas = async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json(await postulacionService.listarRecibidas({ usuarioId: req.usuario.id, query: req.query, base: baseUrl(req) }));
    } catch (err) {
        next(err);
    }
};

const listarEnviadas = async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json(await postulacionService.listarEnviadas({ usuarioId: req.usuario.id, query: req.query, base: baseUrl(req) }));
    } catch (err) {
        next(err);
    }
};

const actualizar = async (req, res, next) => {
    try {
        res.json(
            await postulacionService.actualizar({
                id: req.params.id,
                usuarioId: req.usuario.id,
                datos: req.body || {},
                base: baseUrl(req),
            })
        );
    } catch (err) {
        next(err);
    }
};

const retirar = async (req, res, next) => {
    try {
        await postulacionService.retirar({ id: req.params.id, usuarioId: req.usuario.id });
        res.status(204).end();
    } catch (err) {
        next(err);
    }
};

// Devuelve el PDF. Nunca queda en cachés compartidas: es un documento personal.
const descargarCv = async (req, res, next) => {
    try {
        const { ruta, nombre } = await postulacionService.obtenerCv({ id: req.params.id, usuarioId: req.usuario.id });
        res.set('Cache-Control', 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type('application/pdf');
        res.attachment(nombre);
        res.sendFile(ruta, (err) => {
            if (err && !res.headersSent) next(err);
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { postular, listarRecibidas, listarEnviadas, actualizar, retirar, descargarCv };
