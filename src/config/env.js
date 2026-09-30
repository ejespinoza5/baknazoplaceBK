const REQUERIDAS = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

const faltantes = REQUERIDAS.filter((clave) => !process.env[clave]);

if (faltantes.length > 0) {
    console.error(
        `Faltan variables de entorno obligatorias: ${faltantes.join(', ')}. Revisa /.env`
    );
    process.exit(1);
}

const path = require('path');

const env = {
    port: process.env.PORT || 3000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtRefreshExpiresDias: Number(process.env.JWT_REFRESH_EXPIRES_DIAS || 30),
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
    corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean),
    // Cookie del refresh token. 'lax' sirve cuando frontend y API comparten dominio
    // (o en local con localhost). Si están en sitios distintos (p. ej. dos
    // subdominios de duckdns.org) hace falta 'none', que obliga a secure=true.
    cookieSameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),
    cookieSecure: process.env.COOKIE_SECURE !== 'false',
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || null,
    },
    smtp: {
        host: process.env.SMTP_HOST || null,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || null,
        pass: process.env.SMTP_PASS || null,
        from: process.env.SMTP_FROM || 'BAKNAZO <no-reply@baknazo.com>',
        replyTo: process.env.SMTP_REPLY_TO || null,
    },
    uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'),
    // Archivos privados (hojas de vida). NUNCA se sirve como estático: solo se
    // leen desde la API tras comprobar quién los pide.
    privadoDir: process.env.PRIVATE_DIR || path.join(__dirname, '..', '..', 'privado'),
    logoUrl: process.env.LOGO_URL || 'https://apibaknazo.duckdns.org/public/logo.png',
    frontendUrl: process.env.FRONTEND_URL || 'https://app.baknazo.com',
};

if (!env.google.clientId) {
    console.warn('[config] GOOGLE_CLIENT_ID no configurado: /login/google fallará hasta configurarlo.');
}
if (!env.smtp.host) {
    console.warn('[config] SMTP no configurado: los códigos de verificación/recuperación se mostrarán solo en consola.');
}

if (!['strict', 'lax', 'none'].includes(env.cookieSameSite)) {
    console.error('COOKIE_SAMESITE debe ser strict, lax o none');
    process.exit(1);
}
if (env.cookieSameSite === 'none' && !env.cookieSecure) {
    console.error('COOKIE_SAMESITE=none exige COOKIE_SECURE=true (el navegador rechaza la cookie si no)');
    process.exit(1);
}

module.exports = env;
