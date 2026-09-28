const express = require('express');
const router = express.Router();
const anuncioController = require('../controllers/anuncioController');
const { uploadFotosAnuncio } = require('../middlewares/upload');
const { requiereAutenticacion, autenticacionOpcional } = require('../middlewares/authMiddleware');const { limitadorPublicacion, limitadorContacto } = require('../middlewares/rateLimiter');

// Feed público
router.get('/', anuncioController.listar);

// "Mis anuncios" (va antes de '/:id' para que 'mios' no se tome como id)
router.get('/mios', requiereAutenticacion, anuncioController.listarMios);

// Publicar: un solo multipart (campo 'datos' JSON + 'fotos' 0..6). La autenticación va antes de multer.
router.post('/', requiereAutenticacion, limitadorPublicacion, uploadFotosAnuncio, anuncioController.crear);

// Detalle por id o por slug. El dueño también ve sus anuncios pausados/rechazados.
router.get('/:id', autenticacionOpcional, anuncioController.obtener);

router.patch('/:id', requiereAutenticacion, uploadFotosAnuncio, anuncioController.actualizar);
router.delete('/:id', requiereAutenticacion, anuncioController.eliminar);

// Reveal del teléfono del vendedor (y contador de contactos). Requiere sesión:
// es el único endpoint que devuelve un número. El límite va después de la
// autenticación porque se cuenta por usuario, no por IP.
router.post('/:id/contacto', requiereAutenticacion, limitadorContacto, anuncioController.revelarContacto);

module.exports = router;
