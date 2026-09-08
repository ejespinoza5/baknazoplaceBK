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

const enviarCorreo = async ({ para, asunto, textoPlano, codigoParaConsola }) => {
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
    });
};

const enviarCodigoVerificacion = (correo, codigo) =>
    enviarCorreo({
        para: correo,
        asunto: 'Verifica tu correo - BAKNAZO',
        textoPlano: `Tu código de verificación es ${codigo}. Expira en 15 minutos.`,
        codigoParaConsola: codigo,
    });

const enviarCodigoRecuperacion = (correo, codigo) =>
    enviarCorreo({
        para: correo,
        asunto: 'Recupera tu contraseña - BAKNAZO',
        textoPlano: `Tu código para restablecer tu contraseña es ${codigo}. Expira en 15 minutos. Si no lo solicitaste, ignora este correo.`,
        codigoParaConsola: codigo,
    });

module.exports = { enviarCodigoVerificacion, enviarCodigoRecuperacion };
