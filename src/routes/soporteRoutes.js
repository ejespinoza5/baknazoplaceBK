const express = require('express');
const router = express.Router();
const soporteController = require('../controllers/soporteController');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');
const { limitadorSoporte } = require('../middlewares/rateLimiter');

// Soporte: el hilo del usuario con el equipo de Baknazo. Las respuestas del
// equipo llegan en vivo por el WebSocket del chat (eventos `soporte*`).
router.use(requiereAutenticacion);

// Historial (?antesDe=<id del más antiguo cargado>) con el estado del hilo.
router.get('/', soporteController.obtener);
router.get('/no-leidos', soporteController.contarNoLeidos);
router.post('/mensajes', limitadorSoporte, soporteController.enviar);
router.post('/leido', soporteController.marcarLeido);

module.exports = router;
