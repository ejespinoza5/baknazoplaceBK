const express = require('express');
const router = express.Router();
const catalogoController = require('../controllers/catalogoController');

router.get('/', catalogoController.obtenerCatalogos);
router.get('/resumen', catalogoController.obtenerResumen);

module.exports = router;
