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

module.exports = { requiereAutenticacion };
