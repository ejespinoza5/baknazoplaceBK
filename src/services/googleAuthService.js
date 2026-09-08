const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');

const client = env.google.clientId ? new OAuth2Client(env.google.clientId) : null;

// Verifica el id_token contra los servidores de Google. Nunca confiar en datos
// del cliente sin esta verificación server-side.
const verificarIdTokenGoogle = async (idToken) => {
    if (!client) {
        const err = new Error('Login con Google no está configurado en el servidor');
        err.status = 503;
        throw err;
    }
    if (!idToken || typeof idToken !== 'string') {
        const err = new Error('id_token requerido');
        err.status = 400;
        throw err;
    }

    let ticket;
    try {
        ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
    } catch (e) {
        const err = new Error('Token de Google inválido o expirado');
        err.status = 401;
        throw err;
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
        const err = new Error('Token de Google inválido');
        err.status = 401;
        throw err;
    }

    return {
        proveedorId: payload.sub,
        correo: payload.email,
        correoVerificado: Boolean(payload.email_verified),
        nombre: payload.name || payload.given_name || 'Usuario',
        apellido: payload.family_name || null,
    };
};

module.exports = { verificarIdTokenGoogle };
