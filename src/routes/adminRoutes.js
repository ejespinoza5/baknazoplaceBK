const express = require('express');
const router = express.Router();
const c = require('../controllers/adminController');
const { requiereAdmin, requierePermiso } = require('../middlewares/adminAuth');
const { exigirOrigenPermitido } = require('../middlewares/origenPermitido');
const { limitadorLoginAdmin } = require('../middlewares/rateLimiter');

// Panel de administración. La sesión va en una cookie HttpOnly propia; contra
// CSRF, toda petición que cambia algo exige un Origin permitido. Los permisos
// se comprueban aquí, en cada ruta, no solo ocultando botones en el panel.

router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') return exigirOrigenPermitido(req, res, next);
    next();
});

router.post('/auth/login', limitadorLoginAdmin, c.login);

router.use(requiereAdmin);

// ---------- Cuenta propia ----------
router.get('/auth/yo', c.yo);
router.post('/auth/logout', c.logout);
router.post('/auth/cambiar-contrasena', c.cambiarContrasena);
router.patch('/auth/perfil', c.actualizarPerfil);
router.get('/auth/sesiones', c.sesiones);
router.post('/auth/cerrar-sesiones', c.cerrarOtrasSesiones);

router.get('/catalogos', c.catalogos);
// Lo que espera atención (filtrado por permisos dentro), para los avisos del panel.
router.get('/contadores', c.contadores);
router.get('/estadisticas', requierePermiso('estadisticas.ver'), c.estadisticas);

// ---------- Anuncios ----------
router.get('/anuncios', requierePermiso('anuncios.ver'), c.listarAnuncios);
router.get('/anuncios/:id', requierePermiso('anuncios.ver'), c.detalleAnuncio);
router.post('/anuncios/:id/aprobar', requierePermiso('anuncios.aprobar'), c.moderar('aprobar'));
router.post('/anuncios/:id/rechazar', requierePermiso('anuncios.rechazar'), c.moderar('rechazar'));
router.post('/anuncios/:id/pausar', requierePermiso('anuncios.pausar'), c.moderar('pausar'));
router.post('/anuncios/:id/eliminar', requierePermiso('anuncios.eliminar'), c.moderar('eliminar'));

// ---------- Denuncias ----------
router.get('/denuncias', requierePermiso('denuncias.ver'), c.listarDenunciados);
router.post('/denuncias/:anuncioId/desestimar', requierePermiso('denuncias.resolver'), c.desestimarDenuncias);

// ---------- Usuarios ----------
router.get('/usuarios', requierePermiso('usuarios.ver'), c.listarUsuarios);
router.post('/usuarios/:id/suspender', requierePermiso('usuarios.suspender'), c.suspenderUsuario);
router.post('/usuarios/:id/reactivar', requierePermiso('usuarios.reactivar'), c.reactivarUsuario);

// ---------- Administradores ----------
router.get('/administradores', requierePermiso('administradores.gestionar'), c.listarAdministradores);
router.post('/administradores', requierePermiso('administradores.gestionar'), c.crearAdministrador);
router.patch('/administradores/:id', requierePermiso('administradores.gestionar'), c.editarAdministrador);
router.post('/administradores/:id/activo', requierePermiso('administradores.gestionar'), c.activarAdministrador);
router.delete('/administradores/:id', requierePermiso('administradores.gestionar'), c.eliminarAdministrador);
router.post('/administradores/:id/restablecer-contrasena', requierePermiso('administradores.gestionar'), c.restablecerContrasena);
router.put('/administradores/:id/permisos', requierePermiso('permisos.gestionar'), c.asignarPermisos);

// ---------- Auditoría y moderación ----------
router.get('/auditoria', requierePermiso('auditoria.ver'), c.listarAuditoria);
router.get('/moderacion', requierePermiso('moderacion.configurar'), c.obtenerModeracion);
router.put('/moderacion', requierePermiso('moderacion.configurar'), c.guardarModeracion);
router.post('/moderacion/palabras', requierePermiso('moderacion.configurar'), c.agregarPalabra);
router.delete('/moderacion/palabras/:id', requierePermiso('moderacion.configurar'), c.eliminarPalabra);

module.exports = router;
