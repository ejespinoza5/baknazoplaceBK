const notificacionService = require('../services/notificacionService');

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// El usuario sale siempre del token: ninguna ruta acepta un usuarioId ajeno.
const responder = (fn) => async (req, res, next) => {
    try {
        res.set('Cache-Control', 'private, no-store');
        res.json(await fn(req));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    listar: responder((req) =>
        notificacionService.listar({ usuarioId: req.usuario.id, query: req.query, base: baseUrl(req) })
    ),
    contarNoLeidas: responder((req) => notificacionService.contarNoLeidas({ usuarioId: req.usuario.id })),
    marcarLeidas: responder((req) =>
        notificacionService.marcarLeidas({ usuarioId: req.usuario.id, ids: (req.body || {}).ids })
    ),
    eliminar: responder((req) => notificacionService.eliminar({ usuarioId: req.usuario.id, id: req.params.id })),
    obtenerPreferencias: responder((req) => notificacionService.obtenerPreferencias({ usuarioId: req.usuario.id })),
    guardarPreferencias: responder((req) =>
        notificacionService.guardarPreferencias({ usuarioId: req.usuario.id, datos: req.body || {} })
    ),
    registrarDispositivo: responder((req) =>
        notificacionService.registrarDispositivo({
            usuarioId: req.usuario.id,
            token: (req.body || {}).token,
            plataforma: (req.body || {}).plataforma,
            navegador: req.get('user-agent'),
        })
    ),
    eliminarDispositivo: responder((req) =>
        notificacionService.eliminarDispositivo({ usuarioId: req.usuario.id, token: (req.body || {}).token })
    ),
};
