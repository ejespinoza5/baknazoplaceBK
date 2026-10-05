const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { uploadImagenes } = require('../middlewares/upload');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');
const { exigirOrigenPermitido } = require('../middlewares/origenPermitido');
const {
    limitadorRegistro,
    limitadorLogin,
    limitadorVerificacion,
    limitadorRecuperacion,
    limitadorCorreo,
    limitadorContrasena,
} = require('../middlewares/rateLimiter');

router.get('/categorias', authController.listarCategorias);
router.get('/politicas', authController.listarPoliticas);
// Versiones nuevas que quien ya tiene cuenta aún no aceptó, y su aceptación.
router.get('/politicas/pendientes', requiereAutenticacion, authController.politicasPendientes);
router.post('/politicas/aceptar', requiereAutenticacion, authController.aceptarPoliticas);
router.post('/correo-existe', limitadorCorreo, authController.correoExiste);
// El limitador va antes de la subida: una IP que ya pasó su cupo no llega a escribir archivos.
router.post('/registro', limitadorRegistro, uploadImagenes, authController.registrar);
router.post('/verificar-correo', limitadorVerificacion, authController.verificarCorreo);
router.post('/reenviar-verificacion', limitadorVerificacion, authController.reenviarVerificacion);

router.post('/login', limitadorLogin, authController.iniciarSesion);
router.post('/login/google', limitadorLogin, uploadImagenes, authController.loginGoogle);
router.post('/login/google/vincular', limitadorVerificacion, authController.vincularGoogle);
router.post('/login/google/reenviar-codigo', limitadorVerificacion, authController.reenviarCodigoVinculacionGoogle);

router.post('/refrescar-token', exigirOrigenPermitido, authController.refrescarToken);
router.post('/logout', exigirOrigenPermitido, authController.cerrarSesion);

router.post('/solicitar-recuperacion', limitadorRecuperacion, authController.solicitarRecuperacion);
router.post('/verificar-codigo-recuperacion', limitadorVerificacion, authController.verificarCodigoRecuperacion);
router.post('/restablecer-contrasena', limitadorRecuperacion, authController.restablecerContrasena);

router.get('/me', requiereAutenticacion, authController.perfil);
// La autenticación va antes de multer para no procesar archivos de peticiones sin token.
router.patch('/perfil', requiereAutenticacion, uploadImagenes, authController.actualizarPerfil);
router.put('/cambiar-contrasena', requiereAutenticacion, limitadorContrasena, authController.cambiarContrasena);
// Eliminar la cuenta desde la app o la web. Mismo límite que el cambio de
// contraseña: también exige la contraseña y no debe poder adivinarse.
router.delete('/cuenta', requiereAutenticacion, limitadorContrasena, authController.eliminarCuenta);

module.exports = router;
