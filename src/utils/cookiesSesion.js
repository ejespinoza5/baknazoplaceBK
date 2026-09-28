const env = require('../config/env');

// El refresh token viaja solo en una cookie HttpOnly: el JavaScript del frontend no
// puede leerla, así que un XSS no puede robarla. Solo se envía a /api/auth, que es
// donde se usa (refrescar y logout); el resto de la API sigue con Authorization: Bearer.
const COOKIE_REFRESH = 'baknazo_rt';
// Recuerda si la sesión es persistente ("Mantener sesión iniciada") para que al
// rotar el refresh token la cookie nueva conserve el mismo comportamiento.
const COOKIE_PERSISTENTE = 'baknazo_persistente';

const opcionesBase = () => ({
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/api/auth',
});

// Sin maxAge la cookie es de sesión: el navegador la borra al cerrarse.
const opcionesConDuracion = (persistente) =>
    persistente
        ? { ...opcionesBase(), maxAge: env.jwtRefreshExpiresDias * 24 * 60 * 60 * 1000 }
        : opcionesBase();

const ponerCookiesSesion = (res, refreshToken, persistente) => {
    const opciones = opcionesConDuracion(persistente);
    res.cookie(COOKIE_REFRESH, refreshToken, opciones);
    res.cookie(COOKIE_PERSISTENTE, persistente ? '1' : '0', opciones);
};

const borrarCookiesSesion = (res) => {
    res.clearCookie(COOKIE_REFRESH, opcionesBase());
    res.clearCookie(COOKIE_PERSISTENTE, opcionesBase());
};

const leerRefreshToken = (req) => req.cookies?.[COOKIE_REFRESH] || null;

const leerPersistente = (req) => req.cookies?.[COOKIE_PERSISTENTE] !== '0';

// El cliente indica "Mantener sesión iniciada" con mantener_sesion; por defecto sí.
const pidePersistente = (body) => {
    const valor = body?.mantener_sesion;
    return !(valor === false || valor === 'false' || valor === '0');
};

// Saca el refresh token del cuerpo y lo pone en la cookie. El JSON conserva el
// access token (que el frontend guarda solo en memoria) y el resto de datos.
const responderConSesion = (res, resultado, persistente, estado = 200) => {
    const { refresh_token, ...cuerpo } = resultado;
    if (refresh_token) {
        ponerCookiesSesion(res, refresh_token, persistente);
    }
    return res.status(estado).json(cuerpo);
};

module.exports = {
    borrarCookiesSesion,
    leerRefreshToken,
    leerPersistente,
    pidePersistente,
    responderConSesion,
};
