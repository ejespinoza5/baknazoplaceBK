const REQUERIDAS = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

const faltantes = REQUERIDAS.filter((clave) => !process.env[clave]);

if (faltantes.length > 0) {
    console.error(
        `Faltan variables de entorno obligatorias: ${faltantes.join(', ')}. Revisa /.env`
    );
    process.exit(1);
}

const env = {
    port: process.env.PORT || 3000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtRefreshExpiresDias: Number(process.env.JWT_REFRESH_EXPIRES_DIAS || 30),
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
    corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean),
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || null,
    },
    facebook: {
        appId: process.env.FACEBOOK_APP_ID || null,
        appSecret: process.env.FACEBOOK_APP_SECRET || null,
    },
    smtp: {
        host: process.env.SMTP_HOST || null,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || null,
        pass: process.env.SMTP_PASS || null,
        from: process.env.SMTP_FROM || 'BAKNAZO <no-reply@baknazo.com>',
    },
};

if (!env.google.clientId) {
    console.warn('[config] GOOGLE_CLIENT_ID no configurado: /login/google fallará hasta configurarlo.');
}
if (!env.facebook.appId || !env.facebook.appSecret) {
    console.warn('[config] FACEBOOK_APP_ID/FACEBOOK_APP_SECRET no configurados: /login/facebook fallará hasta configurarlos.');
}
if (!env.smtp.host) {
    console.warn('[config] SMTP no configurado: los códigos de verificación/recuperación se mostrarán solo en consola.');
}

module.exports = env;
