const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { uploadImagenes } = require('../middlewares/upload');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');
const {
    limitadorRegistro,
    limitadorLogin,
    limitadorVerificacion,
    limitadorRecuperacion,
    limitadorCorreo,
} = require('../middlewares/rateLimiter');

router.get('/categorias', authController.listarCategorias);
router.get('/politicas', authController.listarPoliticas);
router.post('/correo-existe', limitadorCorreo, authController.correoExiste);
router.post('/registro', uploadImagenes, limitadorRegistro, authController.registrar);
router.post('/verificar-correo', limitadorVerificacion, authController.verificarCorreo);
router.post('/reenviar-verificacion', limitadorVerificacion, authController.reenviarVerificacion);

router.post('/login', limitadorLogin, authController.iniciarSesion);
router.post('/login/google', uploadImagenes, limitadorLogin, authController.loginGoogle);
router.post('/login/google/vincular', limitadorVerificacion, authController.vincularGoogle);
router.post('/login/google/reenviar-codigo', limitadorVerificacion, authController.reenviarCodigoVinculacionGoogle);

router.post('/refrescar-token', authController.refrescarToken);
router.post('/logout', authController.cerrarSesion);

router.post('/solicitar-recuperacion', limitadorRecuperacion, authController.solicitarRecuperacion);
router.post('/restablecer-contrasena', limitadorRecuperacion, authController.restablecerContrasena);

router.get('/me', requiereAutenticacion, authController.perfil);

module.exports = router;
