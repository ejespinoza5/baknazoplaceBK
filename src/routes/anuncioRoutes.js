const express = require('express');
const router = express.Router();
const anuncioController = require('../controllers/anuncioController');
const postulacionController = require('../controllers/postulacionController');
const { uploadFotosAnuncio, uploadCv } = require('../middlewares/upload');
const { requiereAutenticacion, autenticacionOpcional } = require('../middlewares/authMiddleware');
const {
    limitadorPublicacion,
    limitadorContacto,
    limitadorLike,
    limitadorPostulacion,
    limitadorVistas,
    limitadorDenuncia,
} = require('../middlewares/rateLimiter');

// Feed público. La sesión es opcional: sin token se ve igual, y con token el
// backend sabe a qué anuncios les diste me gusta (meGusta) y cuáles son tuyos (esMio).
router.get('/', autenticacionOpcional, anuncioController.listar);

// "Mis anuncios" (va antes de '/:id' para que 'mios' no se tome como id)
router.get('/mios', requiereAutenticacion, anuncioController.listarMios);

// Guardados de quien tiene sesión (también antes de '/:id').
router.get('/guardados', requiereAutenticacion, anuncioController.listarGuardados);

// Vistas de la lista: publicaciones que se vieron en pantalla sin abrirlas.
// Sesión opcional: sin ella cuenta por huella anónima.
router.post('/vistas', autenticacionOpcional, limitadorVistas, anuncioController.registrarVistas);

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

// Me gusta. DELETE va a /likes/me y no a /likes: el usuario lo pone el token,
// nunca la URL, así que nadie puede quitar el like de otro.
router.post('/:id/likes', requiereAutenticacion, limitadorLike, anuncioController.darLike);
router.delete('/:id/likes/me', requiereAutenticacion, limitadorLike, anuncioController.quitarLike);

// Guardar para después. El usuario lo pone el token, igual que el like.
router.post('/:id/guardado', requiereAutenticacion, limitadorLike, anuncioController.guardar);
router.delete('/:id/guardado', requiereAutenticacion, limitadorLike, anuncioController.quitarGuardado);

// Denunciar un anuncio { motivo, detalle }. Una vez por persona y anuncio.
router.post('/:id/denuncias', requiereAutenticacion, limitadorDenuncia, anuncioController.denunciar);

// Postularse a una vacante con el CV en PDF (campo 'cv' + 'mensaje' + 'telefono').
router.post(
    '/:id/postulaciones',
    requiereAutenticacion,
    limitadorPostulacion,
    uploadCv,
    postulacionController.postular
);

module.exports = router;
