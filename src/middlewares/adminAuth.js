const env = require('../config/env');
const adminAuthService = require('../services/adminAuthService');

// La cookie del panel: HttpOnly (el JavaScript no la lee) y solo se envía a
// /api/admin. Es otra que la del marketplace: una sesión no sirve en la otra.
const COOKIE_ADMIN = 'baknazo_admin';

const opcionesCookie = () => ({
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/api/admin',
});

const ponerCookieAdmin = (res, token) =>
    res.cookie(COOKIE_ADMIN, token, { ...opcionesCookie(), maxAge: adminAuthService.DURACION_SESION_MS });

const borrarCookieAdmin = (res) => res.clearCookie(COOKIE_ADMIN, opcionesCookie());

// Con una contraseña temporal solo se puede ver quién eres, cambiarla o salir.
const LIBRES_CON_TEMPORAL = new Set(['/auth/yo', '/auth/cambiar-contrasena', '/auth/logout']);

const requiereAdmin = async (req, res, next) => {
    try {
        const sesion = await adminAuthService.sesionDesdeToken(req.cookies?.[COOKIE_ADMIN]);
        if (!sesion) {
            borrarCookieAdmin(res);
            return res.status(401).json({ error: 'Tu sesión del panel terminó. Vuelve a entrar.' });
        }
        req.admin = sesion.admin;
        req.sesionAdminId = sesion.sesionId;
        if (sesion.admin.debeCambiarContrasena && !LIBRES_CON_TEMPORAL.has(req.path)) {
            return res.status(403).json({
                error: 'Cambia tu contraseña temporal para continuar.',
                codigo: 'CAMBIO_CONTRASENA_REQUERIDO',
            });
        }
        next();
    } catch (e) {
        next(e);
    }
};

// Se comprueba siempre en el servidor: ocultar un botón no protege nada.
const requierePermiso =
    (...permisos) =>
    (req, res, next) => {
        if (req.admin?.esSuper || permisos.every((p) => req.admin?.permisos.includes(p))) return next();
        return res.status(403).json({ error: 'No tienes permiso para hacer esto.' });
    };

const requiereSuper = (req, res, next) =>
    req.admin?.esSuper ? next() : res.status(403).json({ error: 'Solo el superadministrador puede hacer esto.' });

module.exports = { ponerCookieAdmin, borrarCookieAdmin, requiereAdmin, requierePermiso, requiereSuper };
