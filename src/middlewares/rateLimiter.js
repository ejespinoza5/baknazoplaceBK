const rateLimit = require('express-rate-limit');

const crearLimitador = (ventanaMinutos, maxIntentos, mensaje) =>
    rateLimit({
        windowMs: ventanaMinutos * 60 * 1000,
        max: maxIntentos,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: mensaje },
    });

module.exports = {
    limitadorRegistro: crearLimitador(60, 8, 'Demasiados registros desde esta IP. Intenta más tarde.'),
    limitadorLogin: crearLimitador(15, 10, 'Demasiados intentos de inicio de sesión. Intenta más tarde.'),
    limitadorVerificacion: crearLimitador(15, 8, 'Demasiados intentos. Intenta más tarde.'),
    limitadorRecuperacion: crearLimitador(15, 5, 'Demasiadas solicitudes. Intenta más tarde.'),
};
