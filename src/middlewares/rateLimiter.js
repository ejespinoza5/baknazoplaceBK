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
    limitadorCorreo: crearLimitador(15, 30, 'Demasiadas consultas de correo. Intenta más tarde.'),
    limitadorLogin: crearLimitador(15, 10, 'Demasiados intentos de inicio de sesión. Intenta más tarde.'),
    limitadorVerificacion: crearLimitador(15, 8, 'Demasiados intentos. Intenta más tarde.'),
    limitadorRecuperacion: crearLimitador(15, 5, 'Demasiadas solicitudes. Intenta más tarde.'),
    // Evita adivinar la contraseña actual por fuerza bruta con un token robado.
    limitadorContrasena: crearLimitador(15, 5, 'Demasiados intentos de cambio de contraseña. Intenta más tarde.'),
    limitadorPublicacion: crearLimitador(60, 30, 'Demasiadas publicaciones. Intenta más tarde.'),
    // Pedir números de teléfono: por usuario (va detrás de requiereAutenticacion)
    // para frenar a quien intente recolectar números de muchos anuncios.
    limitadorContacto: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        // 'message' además de 'error': el texto por defecto del cliente para un 429
        // habla de publicaciones y aquí sería engañoso.
        message: {
            error: 'Estás pidiendo demasiados números. Espera un momento.',
            message: 'Estás pidiendo demasiados números. Espera un momento.',
        },
    }),
    // Dar/quitar me gusta: por usuario, igual que el de contacto.
    limitadorLike: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Estás dando demasiados me gusta. Espera un momento.',
            message: 'Estás dando demasiados me gusta. Espera un momento.',
        },
    }),
    // Seguir/dejar de seguir: por usuario.
    limitadorSeguir: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Demasiadas acciones de seguir. Espera un momento.',
            message: 'Demasiadas acciones de seguir. Espera un momento.',
        },
    }),
    // Vistas desde la lista: por IP; una sesión normal hace unas pocas por minuto.
    limitadorVistas: crearLimitador(15, 300, 'Demasiadas solicitudes. Intenta más tarde.'),
    // Abrir conversaciones nuevas: por usuario. Frena a quien quiera escribirle a
    // todos los anunciantes; los mensajes en sí los limita el WebSocket.
    limitadorChat: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Estás abriendo demasiadas conversaciones. Espera un momento.',
            message: 'Estás abriendo demasiadas conversaciones. Espera un momento.',
        },
    }),
    // Registrar y quitar tokens de push: por usuario. Un navegador lo hace una
    // vez al activar y al renovarse el token; esto solo frena abusos.
    limitadorDispositivos: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Demasiados cambios en las notificaciones push. Espera un momento.',
            message: 'Demasiados cambios en las notificaciones push. Espera un momento.',
        },
    }),
    // Denuncias: por usuario. Frena a quien quiera tumbar anuncios ajenos a base de denuncias.
    limitadorDenuncia: rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Enviaste demasiadas denuncias. Espera un rato.',
            message: 'Enviaste demasiadas denuncias. Espera un rato.',
        },
    }),
    // Revisión del texto mientras se escribe: el formulario la pide con pausa
    // (una por frase, no por tecla). Esto deja editar con holgura y frena a
    // quien quiera probar palabras en bucle para adivinar el diccionario.
    limitadorRevisionTexto: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: { error: 'Demasiadas revisiones seguidas. Espera un momento.' },
    }),
    // Mensajes a soporte: por usuario. De sobra para explicar un problema,
    // corta a quien quiera llenar la bandeja del equipo.
    limitadorSoporte: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Enviaste muchos mensajes seguidos. Espera un momento; el equipo ya tiene los anteriores.',
            message: 'Enviaste muchos mensajes seguidos. Espera un momento; el equipo ya tiene los anteriores.',
        },
    }),
    // Login del panel: por IP. Además, cada cuenta se bloquea 15 min tras 5 fallos.
    limitadorLoginAdmin: crearLimitador(15, 10, 'Demasiados intentos de inicio de sesión. Intenta más tarde.'),
    // Postularse sube un PDF: por usuario, y bastante más bajo que un like.
    limitadorPostulacion: rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `usuario:${req.usuario.id}`,
        message: {
            error: 'Enviaste demasiadas postulaciones. Espera un rato e inténtalo de nuevo.',
            message: 'Enviaste demasiadas postulaciones. Espera un rato e inténtalo de nuevo.',
        },
    }),
};
