const adminAuthService = require('../services/adminAuthService');
const adminService = require('../services/adminService');
const { ponerCookieAdmin, borrarCookieAdmin } = require('../middlewares/adminAuth');

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// Envuelve cada acción: respuesta JSON y errores al manejador central. El
// actor siempre es req.admin (del token), nunca algo que mande el navegador.
const accion = (fn, estado = 200) => async (req, res, next) => {
    try {
        res.status(estado).json(await fn(req, res));
    } catch (err) {
        next(err);
    }
};

const ctx = (req) => ({ actor: req.admin, ip: req.ip });

module.exports = {
    // ---------- Sesión y perfil ----------
    login: async (req, res, next) => {
        try {
            const { correo, contrasena } = req.body || {};
            const r = await adminAuthService.iniciarSesion({ correo, contrasena, ip: req.ip, userAgent: req.get('user-agent') });
            ponerCookieAdmin(res, r.token);
            res.json({ admin: r.admin });
        } catch (err) {
            next(err);
        }
    },
    logout: async (req, res, next) => {
        try {
            await adminAuthService.cerrarSesion({ admin: req.admin, sesionId: req.sesionAdminId, ip: req.ip });
            borrarCookieAdmin(res);
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    },
    yo: accion(async (req) => ({ admin: req.admin })),
    cambiarContrasena: accion(async (req) => ({
        admin: await adminAuthService.cambiarContrasena({
            admin: req.admin,
            sesionId: req.sesionAdminId,
            actual: (req.body || {}).actual,
            nueva: (req.body || {}).nueva,
            ip: req.ip,
        }),
    })),
    actualizarPerfil: accion(async (req) => ({
        admin: await adminAuthService.actualizarPerfil({ admin: req.admin, datos: req.body || {}, ip: req.ip }),
    })),
    sesiones: accion((req) => adminAuthService.listarSesiones({ admin: req.admin, sesionId: req.sesionAdminId })),
    cerrarOtrasSesiones: accion((req) =>
        adminAuthService.cerrarOtrasSesiones({ admin: req.admin, sesionId: req.sesionAdminId, ip: req.ip })
    ),

    // ---------- Panel ----------
    catalogos: accion(() => adminService.catalogos()),
    estadisticas: accion(() => adminService.estadisticas()),

    listarAnuncios: accion((req) => adminService.listarAnuncios({ query: req.query, base: baseUrl(req) })),
    detalleAnuncio: accion((req) => adminService.detalleAnuncio({ id: req.params.id, base: baseUrl(req) })),
    moderar: (tipo) =>
        accion((req) => {
            const { motivo, nota } = req.body || {};
            return adminService.moderar({ ...ctx(req), id: req.params.id, accion: tipo, motivo, nota });
        }),

    listarDenunciados: accion((req) => adminService.listarDenunciados({ query: req.query, base: baseUrl(req) })),
    desestimarDenuncias: accion((req) => adminService.desestimarDenuncias({ ...ctx(req), anuncioId: req.params.anuncioId })),

    listarUsuarios: accion((req) => adminService.listarUsuarios({ query: req.query })),
    suspenderUsuario: accion((req) =>
        adminService.cambiarEstadoUsuario({ ...ctx(req), id: req.params.id, suspender: true, motivo: (req.body || {}).motivo })
    ),
    reactivarUsuario: accion((req) => adminService.cambiarEstadoUsuario({ ...ctx(req), id: req.params.id, suspender: false })),

    listarAdministradores: accion(() => adminService.listarAdministradores()),
    crearAdministrador: accion((req) => adminService.crearAdministrador({ ...ctx(req), datos: req.body || {} }), 201),
    editarAdministrador: accion((req) => adminService.editarAdministrador({ ...ctx(req), id: req.params.id, datos: req.body || {} })),
    activarAdministrador: accion((req) =>
        adminService.cambiarActivoAdministrador({ ...ctx(req), id: req.params.id, activo: (req.body || {}).activo })
    ),
    eliminarAdministrador: accion((req) => adminService.eliminarAdministrador({ ...ctx(req), id: req.params.id })),
    asignarPermisos: accion((req) =>
        adminService.asignarPermisos({ ...ctx(req), id: req.params.id, permisos: (req.body || {}).permisos })
    ),
    restablecerContrasena: accion((req) => adminService.restablecerContrasena({ ...ctx(req), id: req.params.id })),

    listarAuditoria: accion((req) => adminService.listarAuditoria({ query: req.query })),

    obtenerModeracion: accion(() => adminService.obtenerModeracion()),
    guardarModeracion: accion((req) => adminService.guardarModeracion({ ...ctx(req), datos: req.body || {} })),
    agregarPalabra: accion((req) =>
        adminService.agregarPalabra({ ...ctx(req), termino: (req.body || {}).termino, nivel: (req.body || {}).nivel })
    ),
    eliminarPalabra: accion((req) => adminService.eliminarPalabra({ ...ctx(req), id: req.params.id })),
};
