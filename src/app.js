require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const env = require('./config/env'); // Valida variables de entorno obligatorias (falla rápido si faltan)
require('./config/db'); // Importa la configuración de la base de datos
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
require('./config/redis'); // Conecta a Redis si REDIS_URL está configurado (opcional).

const authRoutes = require('./routes/authRoutes');
const catalogoRoutes = require('./routes/catalogoRoutes');
const anuncioRoutes = require('./routes/anuncioRoutes');
const perfilRoutes = require('./routes/perfilRoutes');
const postulacionRoutes = require('./routes/postulacionRoutes');
const chatRoutes = require('./routes/chatRoutes');
const notificacionRoutes = require('./routes/notificacionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const soporteRoutes = require('./routes/soporteRoutes');
const { adjuntarChat } = require('./realtime/chatSocket');
const notificacionService = require('./services/notificacionService');
const { limitadorGeneral } = require('./middlewares/rateLimiter');
const app = express();

// En producción la API está detrás de un proxy inverso (Nginx) que envía X-Forwarded-For.
// Confiar en 1 salto permite que req.ip (y el rate limiter) usen la IP real del cliente.
app.set('trust proxy', 1);

app.use(helmet());
// Respuestas JSON comprimidas (gzip): el feed pesa varias veces menos y llega
// antes con datos móviles. Las fotos ya vienen comprimidas y no se tocan.
app.use(compression({ threshold: 1024 }));
app.use(cors({
    origin: env.corsOrigin.length > 0 ? env.corsOrigin : false,
    // Permite que el navegador envíe y guarde la cookie del refresh token.
    credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Helmet pone Cross-Origin-Resource-Policy: same-origin, lo que impide que el frontend
// (otro dominio) muestre estas imágenes. Solo los archivos estáticos se permiten cross-origin.
const permitirCrossOrigin = (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
};

// Imágenes subidas (fotos de perfil y logos de negocio)
app.use('/uploads', permitirCrossOrigin, express.static(env.uploadDir));

// Archivos públicos del proyecto
app.use('/public', permitirCrossOrigin, express.static(path.join(__dirname, '..', 'public')));

// Tope general por IP para toda la API (cada ruta sensible tiene además el suyo).
app.use('/api', limitadorGeneral);

// Rutas de autenticación
app.use('/api/auth', authRoutes);

// Catálogos del formulario y anuncios
app.use('/api/catalogos', catalogoRoutes);
app.use('/api/anuncios', anuncioRoutes);

// Perfil público y seguidores
app.use('/api/perfil', perfilRoutes);

// Postulaciones a empleo (bandeja del empleador, las enviadas y la descarga del CV)
app.use('/api/postulaciones', postulacionRoutes);

// Chat: bandeja e historial por REST; los mensajes en vivo van por /ws/chat.
app.use('/api/chat', chatRoutes);

// Notificaciones: historial de la campana, preferencias y dispositivos push.
app.use('/api/notificaciones', notificacionRoutes);

// Soporte: el hilo de cada usuario con el equipo de Baknazo.
app.use('/api/soporte', soporteRoutes);

// Panel de administración y moderación (sesión y permisos propios).
app.use('/api/admin', adminRoutes);

// Manejador de errores centralizado (nunca exponer detalles internos/stack al cliente)
app.use((err, req, res, next) => {
    if (err.name === 'MulterError') {
        const mensaje =
            err.code === 'LIMIT_FILE_SIZE'
                ? 'La imagen supera el tamaño máximo permitido (8 MB)'
                : err.code === 'LIMIT_UNEXPECTED_FILE'
                    ? `Campo inesperado: ${err.field}`
                    : `Error al subir el archivo: ${err.message}`;
        return res.status(400).json({ error: mensaje });
    }
    // Validación por campo (anuncios): 422 con el mapa campo → mensaje.
    if (err.status === 422 && err.errores) {
        return res.status(422).json({
            error: err.message,
            message: err.message,
            statusCode: 422,
            errores: err.errores,
        });
    }
    // Los errores esperados (4xx: credenciales, validación…) no ensucian el log.
    if (!err.status || err.status >= 500) console.error(err.stack || err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno' });
});

app.get('/', (req, res) => {
    res.json({ mensaje: 'API funcionando correctamente' });
});

const PORT = process.env.PORT || 3000;
const servidor = app.listen(PORT, () => {
    console.log(`Servidor en http://localhost:${PORT}`);
});

// El chat en vivo comparte puerto con la API: el WebSocket entra por el
// 'upgrade' del mismo servidor HTTP (detrás de Nginx necesita las cabeceras
// Upgrade/Connection en la ruta /ws/).
adjuntarChat(servidor);

// Reparte lo que insertó la base (moderación) y avisa de anuncios vencidos.
notificacionService.iniciarTareas();