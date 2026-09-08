const env = require('../config/env');

const GRAPH_URL = 'https://graph.facebook.com/v19.0';

// Verifica el access_token contra el Graph API de Facebook (debug_token) usando
// el app secret del servidor, y luego obtiene el perfil. Nunca confiar en datos
// del cliente sin esta verificación server-side.
const verificarAccessTokenFacebook = async (accessToken) => {
    if (!env.facebook.appId || !env.facebook.appSecret) {
        const err = new Error('Login con Facebook no está configurado en el servidor');
        err.status = 503;
        throw err;
    }
    if (!accessToken || typeof accessToken !== 'string') {
        const err = new Error('access_token requerido');
        err.status = 400;
        throw err;
    }

    const appToken = `${env.facebook.appId}|${env.facebook.appSecret}`;
    const debugUrl = `${GRAPH_URL}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`;

    const debugResp = await fetch(debugUrl);
    const debugData = await debugResp.json();
    const info = debugData && debugData.data;

    if (!info || !info.is_valid || info.app_id !== env.facebook.appId) {
        const err = new Error('Token de Facebook inválido o expirado');
        err.status = 401;
        throw err;
    }

    const perfilUrl = `${GRAPH_URL}/me?fields=id,name,first_name,last_name,email&access_token=${encodeURIComponent(accessToken)}`;
    const perfilResp = await fetch(perfilUrl);
    const perfil = await perfilResp.json();

    if (!perfil || !perfil.id) {
        const err = new Error('No se pudo obtener el perfil de Facebook');
        err.status = 401;
        throw err;
    }

    if (!perfil.email) {
        const err = new Error(
            'Tu cuenta de Facebook no tiene un correo disponible. Regístrate con correo o Google.'
        );
        err.status = 422;
        throw err;
    }

    return {
        proveedorId: perfil.id,
        correo: perfil.email,
        correoVerificado: true, // Facebook solo entrega el email si está verificado
        nombre: perfil.first_name || perfil.name || 'Usuario',
        apellido: perfil.last_name || null,
    };
};

module.exports = { verificarAccessTokenFacebook };
