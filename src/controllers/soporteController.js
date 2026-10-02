const soporteService = require('../services/soporteService');

// El usuario sale siempre del token: cada uno solo ve y escribe en su hilo.
const responder = (fn, estado = 200) => async (req, res, next) => {
    try {
        res.set('Cache-Control', 'private, no-store');
        res.status(estado).json(await fn(req));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    obtener: responder((req) => soporteService.obtener({ usuarioId: req.usuario.id, query: req.query })),
    enviar: responder(
        (req) => soporteService.enviar({ usuarioId: req.usuario.id, contenido: (req.body || {}).contenido }),
        201
    ),
    marcarLeido: responder((req) => soporteService.marcarLeido({ usuarioId: req.usuario.id })),
    contarNoLeidos: responder((req) => soporteService.contarNoLeidos({ usuarioId: req.usuario.id })),
};
