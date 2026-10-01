const express = require('express');
const router = express.Router();
const postulacionController = require('../controllers/postulacionController');
const { requiereAutenticacion } = require('../middlewares/authMiddleware');

// Todo lo de postulaciones es privado: el dueño de la vacante o quien se postuló.
router.use(requiereAutenticacion);

// Bandeja del empleador (?anuncio=&estado=&limite=&offset=) con su resumen.
router.get('/recibidas', postulacionController.listarRecibidas);
// Las vacantes del negocio con su anuncio y el embudo de candidatos.
router.get('/vacantes', postulacionController.listarVacantes);
// Las que envió quien busca trabajo.
router.get('/enviadas', postulacionController.listarEnviadas);

// El empleador cambia el estado o su nota interna.
router.patch('/:id', postulacionController.actualizar);
// Quien se postuló la retira (y se borra su CV).
router.delete('/:id', postulacionController.retirar);
// Descarga del CV.
router.get('/:id/cv', postulacionController.descargarCv);

module.exports = router;
