const { verificarAccessToken } = require('../services/tokenService');

const requiereAutenticacion = (req, res, next) => {
    const header = req.headers.authorization || '';
    const [esquema, token] = header.split(' ');

    if (esquema !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    try {
        const payload = verificarAccessToken(token);
        req.usuario = { id: payload.sub, correo: payload.correo, tipo_cuenta: payload.tipo_cuenta };
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token de acceso inválido o expirado' });
    }
};

// Para rutas públicas que muestran algo distinto al dueño (p. ej. su anuncio pausado).
// Un token ausente o inválido no es error: simplemente no hay req.usuario.
const autenticacionOpcional = (req, res, next) => {
    const [esquema, token] = (req.headers.authorization || '').split(' ');
    if (esquema === 'Bearer' && token) {
        try {
            const payload = verificarAccessToken(token);
            req.usuario = { id: payload.sub, correo: payload.correo, tipo_cuenta: payload.tipo_cuenta };
        } catch (e) {
            // se ignora
        }
    }
    next();
};

module.exports = { requiereAutenticacion, autenticacionOpcional };
