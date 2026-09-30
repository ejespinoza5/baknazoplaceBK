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

// Captura foto_perfil (avatar del usuario), foto_portada y logo (negocio), todas opcionales.
const uploadImagenes = upload.fields([
    { name: 'foto_perfil', maxCount: 1 },
    { name: 'foto_portada', maxCount: 1 },
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

// Hoja de vida: un solo PDF en el campo 'cv'. El cliente ya lo comprime antes
// de subirlo; este límite es el techo por si llega sin comprimir.
const MAX_BYTES_CV = Number(process.env.MAX_BYTES_CV || 5 * 1024 * 1024);

const uploadCvMulter = multer({
    storage,
    limits: { fileSize: MAX_BYTES_CV, files: 1 },
    fileFilter: (req, file, cb) => {
        // Algunos navegadores mandan 'application/octet-stream' para PDFs: se
        // acepta y se decide por la firma del archivo después.
        if (['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(file.mimetype)) {
            return cb(null, true);
        }
        const err = new Error('La hoja de vida debe ser un archivo PDF');
        err.status = 400;
        cb(err);
    },
}).single('cv');

// Los errores vuelven como 422 con el campo 'cv', igual que las fotos de anuncio.
const uploadCv = (req, res, next) => {
    uploadCvMulter(req, res, (err) => {
        let mensaje = null;
        if (err) {
            if (err.name === 'MulterError') {
                mensaje =
                    err.code === 'LIMIT_FILE_SIZE'
                        ? `El PDF puede pesar como máximo ${Math.round(MAX_BYTES_CV / 1024 / 1024)} MB`
                        : 'Adjunta un solo PDF en el campo cv';
            } else if (err.status === 400) {
                mensaje = err.message;
            } else {
                return next(err);
            }
        } else if (req.file && req.file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
            // La extensión y el mimetype se pueden falsificar; la firma no tanto.
            mensaje = 'El archivo no es un PDF válido';
        }
        if (!mensaje) return next();
        res.status(422).json({
            error: 'Datos inválidos',
            message: mensaje,
            statusCode: 422,
            errores: { cv: mensaje },
        });
    });
};

module.exports = { uploadImagenes, uploadFotosAnuncio, uploadCv, MAX_BYTES_CV };