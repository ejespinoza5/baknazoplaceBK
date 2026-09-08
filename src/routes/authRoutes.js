const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');
const {
    limitadorRegistro,
    limitadorLogin,
    limitadorVerificacion,
    limitadorRecuperacion,
} = require('../middlewares/rateLimiter');

router.post('/registro', limitadorRegistro, authController.registrar);
router.post('/verificar-correo', limitadorVerificacion, authController.verificarCorreo);
router.post('/reenviar-verificacion', limitadorVerificacion, authController.reenviarVerificacion);

router.post('/login', limitadorLogin, authController.iniciarSesion);
router.post('/login/google', limitadorLogin, authController.loginGoogle);
router.post('/login/facebook', limitadorLogin, authController.loginFacebook);

router.post('/refrescar-token', authController.refrescarToken);
router.post('/logout', authController.cerrarSesion);

router.post('/solicitar-recuperacion', limitadorRecuperacion, authController.solicitarRecuperacion);
router.post('/restablecer-contrasena', limitadorRecuperacion, authController.restablecerContrasena);

router.get('/me', requiereAutenticacion, authController.perfil);

module.exports = router;
