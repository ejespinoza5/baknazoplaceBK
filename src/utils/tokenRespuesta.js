const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Permiso para responder un mensaje desde la notificación del teléfono, sin
// abrir la app. Viaja dentro del push y solo sirve para escribir en ESA
// conversación, como ESA persona, durante unos días.
//
// Se firma con una clave propia derivada de JWT_SECRET: con la misma clave,
// este token pasaría como access token (la verificación de sesión no mira
// nada más) y abriría la cuenta entera.

const CLAVE = crypto.createHmac('sha256', env.jwtSecret).update('baknazo:responder-push').digest();
const USO = 'responder-push';
const VIGENCIA = '3d';

const firmar = (usuarioId, conversacionId) =>
    jwt.sign({ uso: USO, cid: Number(conversacionId) }, CLAVE, {
        subject: String(usuarioId),
        expiresIn: VIGENCIA,
        algorithm: 'HS256',
    });

// Lanza si el token no es válido, venció o no es de este uso.
const verificar = (token) => {
    const p = jwt.verify(token, CLAVE, { algorithms: ['HS256'] });
    if (p.uso !== USO || !Number.isInteger(p.cid) || p.cid <= 0 || !p.sub) throw new Error('Token de respuesta inválido');
    return { usuarioId: p.sub, conversacionId: p.cid };
};

module.exports = { firmar, verificar };
