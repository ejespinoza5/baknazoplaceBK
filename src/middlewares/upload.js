const multer = require('multer');

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

module.exports = { uploadImagenes };