const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;
if (env.smtp.host && env.smtp.user && env.smtp.pass) {
    transporter = nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
}

const enviarCorreo = async ({ para, asunto, textoPlano, html, codigoParaConsola }) => {
    if (!transporter) {
        // Sin SMTP configurado: se registra en consola para poder probar en local.
        console.log(`[email:${asunto}] destinatario=${para} codigo=${codigoParaConsola}`);
        return;
    }

    await transporter.sendMail({
        from: env.smtp.from,
        to: para,
        subject: asunto,
        text: textoPlano,
        ...(html ? { html } : {}),
    });
};

const plantillaBase = (titulo, cuerpoHtml) => `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #ececec; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 20px;">
            <span style="font-size: 28px; font-weight: 800; color: #1f2937;">BAKNAZO</span>
        </div>
        <h2 style="color: #111827; margin: 0 0 16px;">${titulo}</h2>
        <div style="color: #4b5563; font-size: 15px; line-height: 1.6;">${cuerpoHtml}</div>
    </div>
`;

const enviarCodigoVerificacion = (correo, codigo) =>
    enviarCorreo({
        para: correo,
        asunto: 'Verifica tu correo - BAKNAZO',
        textoPlano: `Tu código de verificación es ${codigo}. Expira en 15 minutos.`,
        html: plantillaBase(
            'Confirma tu cuenta',
            `<p>Usa este código para verificar tu cuenta:</p>
             <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #111827; text-align: center; margin: 20px 0;">${codigo}</div>
             <p>El código expira en <strong>15 minutos</strong>. Si no creaste una cuenta en BAKNAZO, ignora este correo.</p>`
        ),
        codigoParaConsola: codigo,
    });

const enviarCodigoRecuperacion = (correo, codigo) =>
    enviarCorreo({
        para: correo,
        asunto: 'Recupera tu contraseña - BAKNAZO',
        textoPlano: `Tu código para restablecer tu contraseña es ${codigo}. Expira en 15 minutos. Si no lo solicitaste, ignora este correo.`,
        html: plantillaBase(
            'Restablece tu contraseña',
            `<p>Usa este código para restablecer tu contraseña:</p>
             <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #111827; text-align: center; margin: 20px 0;">${codigo}</div>
             <p>El código expira en <strong>15 minutos</strong>. Si no solicitaste un cambio de contraseña, ignora este correo.</p>`
        ),
        codigoParaConsola: codigo,
    });

const enviarBienvenida = (correo, nombres) =>
    enviarCorreo({
        para: correo,
        asunto: '¡Bienvenido a BAKNAZO!',
        textoPlano: `¡Hola ${nombres}! Tu cuenta ha sido verificada. Bienvenido a BAKNAZO.`,
        html: plantillaBase(
            `¡Bienvenido, ${nombres}!`,
            `<p>Tu correo fue verificado correctamente y tu cuenta ya está activa.</p>
             <p>Ya puedes iniciar sesión y empezar a usar BAKNAZO. Si registraste un negocio, pronto podrás publicar tus productos y conectar con más clientes.</p>
             <p style="margin-bottom: 0;">¡Nos vemos dentro!</p>`
        ),
    });

module.exports = { enviarCodigoVerificacion, enviarCodigoRecuperacion, enviarBienvenida };