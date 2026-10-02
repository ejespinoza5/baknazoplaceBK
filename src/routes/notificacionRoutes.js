const express = require('express');
const router = express.Router();
const notificacionController = require('../controllers/notificacionController');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');
const { limitadorDispositivos } = require('../middlewares/rateLimiter');

// Todo es del usuario del token. Las notificaciones las crea el backend;
// aquí solo se leen, se marcan, se borran y se configuran.
router.use(requiereAutenticacion);

// Historial (?estado=no_leidas&limite=&offset=) con el total sin leer.
router.get('/', notificacionController.listar);
router.get('/no-leidas', notificacionController.contarNoLeidas);
// { ids: [..] } o { ids: 'todas' }
router.post('/leidas', notificacionController.marcarLeidas);

router.get('/preferencias', notificacionController.obtenerPreferencias);
router.put('/preferencias', notificacionController.guardarPreferencias);

// Push: el navegador registra su token FCM tras aceptar el permiso, y lo quita
// al desactivar el push o al cerrar sesión. El token va en el cuerpo, no en la URL.
router.post('/dispositivos', limitadorDispositivos, notificacionController.registrarDispositivo);
router.delete('/dispositivos', limitadorDispositivos, notificacionController.eliminarDispositivo);

router.delete('/:id', notificacionController.eliminar);

module.exports = router;
