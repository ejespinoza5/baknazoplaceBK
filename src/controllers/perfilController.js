const perfilService = require('../services/perfilService');

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const obtener = async (req, res, next) => {
    try {
        const resultado = await perfilService.obtenerPerfil({
            usuarioId: req.params.id,
            visitanteId: req.usuario?.id,
            base: baseUrl(req),
            query: req.query,
        });
        // 'loSigues' depende del visitante: no debe cachearse compartido.
        res.set('Cache-Control', 'private, no-cache');
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const listarAnuncios = async (req, res, next) => {
    try {
        res.json(await perfilService.listarAnuncios({ usuarioId: req.params.id, base: baseUrl(req), query: req.query }));
    } catch (err) {
        next(err);
    }
};

const seguir = async (req, res, next) => {
    try {
        res.json(await perfilService.seguir({ seguidorId: req.usuario.id, seguidoId: req.params.id }));
    } catch (err) {
        next(err);
    }
};

const dejarDeSeguir = async (req, res, next) => {
    try {
        res.json(await perfilService.dejarDeSeguir({ seguidorId: req.usuario.id, seguidoId: req.params.id }));
    } catch (err) {
        next(err);
    }
};

const listar = (direccion) => async (req, res, next) => {
    try {
        res.json(
            await perfilService.listarRelacion({
                usuarioId: req.params.id,
                direccion,
                query: req.query,
                base: baseUrl(req),
            })
        );
    } catch (err) {
        next(err);
    }
};

module.exports = {
    obtener,
    listarAnuncios,
    seguir,
    dejarDeSeguir,
    listarSeguidores: listar('seguidores'),
    listarSeguidos: listar('seguidos'),
};
