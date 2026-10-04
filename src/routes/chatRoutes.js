const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');
const { limitadorChat, limitadorRespuestaPush } = require('../middlewares/rateLimiter');

// Responder desde la notificación del teléfono. Va antes del requiereAutenticacion:
// no hay sesión, la autoriza el permiso firmado que viajó en el push y que solo
// sirve para esa conversación.
router.post('/responder-push', limitadorRespuestaPush, chatController.responderPush);

// Todo el chat es privado. Los mensajes se envían por el WebSocket (/ws/chat);
// aquí está lo que se consulta: la bandeja, el historial y las marcas de leído.
router.use(requiereAutenticacion);

router.get('/no-leidos', chatController.contarNoLeidos);
router.get('/conversaciones', chatController.listar);
// Abre (o recupera) la conversación con quien publicó { anuncioId } o con { usuarioId }.
router.post('/conversaciones', limitadorChat, chatController.iniciar);
router.get('/conversaciones/:id', chatController.obtener);
// Historial hacia atrás: ?antesDe=<id del mensaje más antiguo cargado>&limite=
router.get('/conversaciones/:id/mensajes', chatController.listarMensajes);
router.post('/conversaciones/:id/leida', chatController.marcarLeida);

// Bloquear { usuarioId } y desbloquear. Quien bloquea es siempre el del token.
router.post('/bloqueos', limitadorChat, chatController.bloquear);
router.delete('/bloqueos/:usuarioId', limitadorChat, chatController.desbloquear);

module.exports = router;
