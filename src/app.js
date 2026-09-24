require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const env = require('./config/env'); // Valida variables de entorno obligatorias (falla rápido si faltan)
require('./config/db'); // Importa la configuración de la base de datos
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const app = express();

// En producción la API está detrás de un proxy inverso (Nginx) que envía X-Forwarded-For.
// Confiar en 1 salto permite que req.ip (y el rate limiter) usen la IP real del cliente.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
    origin: env.corsOrigin.length > 0 ? env.corsOrigin : false,
}));
app.use(express.json({ limit: '10kb' }));

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

// Rutas de autenticación
app.use('/api/auth', authRoutes);

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
    console.error(err.stack || err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno' });
});

app.get('/', (req, res) => {
    res.json({ mensaje: 'API funcionando' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor en http://localhost:${PORT}`);
});