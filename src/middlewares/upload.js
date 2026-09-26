const multer = require('multer');
const { MAX_FOTOS, MAX_BYTES_FOTO } = require('../config/anuncios');

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

// Se guarda en memoria; el procesamiento (sharp) ocurre después en imageService.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) {
        return cb(null, true);
    }
    const err = new Error('Solo se permiten imágenes JPG, PNG, WEBP o AVIF');
    err.status = 400;
    cb(err);
};

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB máximo
    fileFilter,
});

// Captura foto_perfil (avatar del usuario) y logo (negocio), ambas opcionales.
const uploadImagenes = upload.fields([
    { name: 'foto_perfil', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
]);

// Fotos de anuncio: campo 'fotos' (0..MAX_FOTOS) + campo de texto 'datos' (JSON).
const uploadAnuncio = multer({
    storage,
    limits: { fileSize: MAX_BYTES_FOTO, files: MAX_FOTOS },
    fileFilter,
}).array('fotos', MAX_FOTOS);

// Los errores de multer en anuncios se devuelven como 422 con el campo 'fotos',
// para que el cliente pinte el error junto a los huecos de foto.
const uploadFotosAnuncio = (req, res, next) => {
    uploadAnuncio(req, res, (err) => {
        if (!err) return next();
        let mensaje = err.message;
        if (err.name === 'MulterError') {
            if (err.code === 'LIMIT_FILE_SIZE') {
                mensaje = `Cada foto puede pesar como máximo ${Math.round(MAX_BYTES_FOTO / 1024 / 1024)} MB`;
            } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
                mensaje = `Máximo ${MAX_FOTOS} fotos por anuncio`;
            }
        } else if (err.status !== 400) {
            return next(err);
        }
        res.status(422).json({
            error: 'Datos inválidos',
            message: 'Datos inválidos',
            statusCode: 422,
            errores: { fotos: mensaje },
        });
    });
};

module.exports = { uploadImagenes, uploadFotosAnuncio };