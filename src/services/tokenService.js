const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { generarTokenOpaco, hashToken } = require('../utils/codigos');
const refreshTokenModel = require('../models/refreshTokenModel');

const emitirAccessToken = (usuario) =>
    jwt.sign(
        { sub: usuario.id, correo: usuario.correo, tipo_cuenta: usuario.tipo_cuenta },
        env.jwtSecret,
        { expiresIn: env.jwtAccessExpires }
    );

const verificarAccessToken = (token) => jwt.verify(token, env.jwtSecret);

const emitirRefreshToken = async (usuarioId) => {
    const token = generarTokenOpaco();
    const expiraEn = new Date(Date.now() + env.jwtRefreshExpiresDias * 24 * 60 * 60 * 1000);
    await refreshTokenModel.crear({ usuarioId, tokenHash: hashToken(token), expiraEn });
    return token;
};

const emitirParTokens = async (usuario) => ({
    access_token: emitirAccessToken(usuario),
    refresh_token: await emitirRefreshToken(usuario.id),
    expira_en: env.jwtAccessExpires,
});

module.exports = { emitirAccessToken, verificarAccessToken, emitirRefreshToken, emitirParTokens };
