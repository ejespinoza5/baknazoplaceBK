const env = require('../config/env');

// Protección CSRF para las rutas que actúan con la cookie del refresh token.
// El navegador envía la cookie aunque la petición la dispare otra web, pero siempre
// añade la cabecera Origin en los POST entre sitios, así que basta con rechazar los
// orígenes que no están en CORS_ORIGIN. Sin Origin (Postman, curl) no hay navegador
// de una víctima cuyas cookies aprovechar, por eso se deja pasar.
const exigirOrigenPermitido = (req, res, next) => {
    const origen = req.headers.origin;
    if (origen && !env.corsOrigin.includes(origen)) {
        return res.status(403).json({ error: 'Origen no permitido' });
    }
    next();
};

module.exports = { exigirOrigenPermitido };
