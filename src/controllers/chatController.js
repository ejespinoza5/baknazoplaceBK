const chatService = require('../services/chatService');

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// Las respuestas del chat son personales: nunca en cachés compartidas.
const sinCache = (res) => res.set('Cache-Control', 'private, no-store');

const listar = async (req, res, next) => {
    try {
        sinCache(res);
        res.json(await chatService.listar({ usuarioId: req.usuario.id, query: req.query, base: baseUrl(req) }));
    } catch (err) {
        next(err);
    }
};

const obtener = async (req, res, next) => {
    try {
        sinCache(res);
        res.json(await chatService.obtener({ usuarioId: req.usuario.id, id: req.params.id, base: baseUrl(req) }));
    } catch (err) {
        next(err);
    }
};

const iniciar = async (req, res, next) => {
    try {
        sinCache(res);
        res.json(await chatService.iniciar({ usuarioId: req.usuario.id, datos: req.body || {}, base: baseUrl(req) }));
    } catch (err) {
        next(err);
    }
};

const listarMensajes = async (req, res, next) => {
    try {
        sinCache(res);
        res.json(await chatService.listarMensajes({ usuarioId: req.usuario.id, id: req.params.id, query: req.query }));
    } catch (err) {
        next(err);
    }
};

const marcarLeida = async (req, res, next) => {
    try {
        res.json(await chatService.marcarLeida({ usuarioId: req.usuario.id, id: req.params.id }));
    } catch (err) {
        next(err);
    }
};

const contarNoLeidos = async (req, res, next) => {
    try {
        sinCache(res);
        res.json(await chatService.contarNoLeidos({ usuarioId: req.usuario.id }));
    } catch (err) {
        next(err);
    }
};

module.exports = { listar, obtener, iniciar, listarMensajes, marcarLeida, contarNoLeidos };
