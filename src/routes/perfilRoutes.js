const express = require('express');
const router = express.Router();
const perfilController = require('../controllers/perfilController');
const { requiereAutenticacion, autenticacionOpcional } = require('../middlewares/authMiddleware');
const { limitadorSeguir } = require('../middlewares/rateLimiter');

// Perfil público: con sesión opcional para saber si el visitante ya lo sigue.
router.get('/:id', autenticacionOpcional, perfilController.obtener);
// Páginas siguientes de anuncios (?limite=20&offset=20).
router.get('/:id/anuncios', autenticacionOpcional, perfilController.listarAnuncios);

router.post('/:id/seguir', requiereAutenticacion, limitadorSeguir, perfilController.seguir);
router.delete('/:id/seguir', requiereAutenticacion, limitadorSeguir, perfilController.dejarDeSeguir);

// Sesión opcional: el dueño ve sus listas aunque las haya hecho privadas.
router.get('/:id/seguidores', autenticacionOpcional, perfilController.listarSeguidores);
router.get('/:id/seguidos', autenticacionOpcional, perfilController.listarSeguidos);

module.exports = router;
