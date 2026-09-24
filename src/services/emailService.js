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

const C = {
    primario: '#FFB800', // Amarillo dorado
    secundario: '#0A6EBD', // Azul andino
    exito: '#1FA363', // Verde selva
    alerta: '#E63946', // Rojo terracota
    texto: '#1F2937', // Gris carbón
    textoSuave: '#6B7280', // Gris medio
    fondo: '#FAFAF7', // Blanco cálido
    borde: '#E5E7EB', // Gris claro
};

const FUENTE = 'Arial,Helvetica,sans-serif';

// Solo mostramos el enlace del pie si es un dominio público real (nunca localhost).
const urlPublica =
    env.frontendUrl && !/localhost|127\.0\.0\.1/i.test(env.frontendUrl) ? env.frontendUrl : null;

const escaparHtml = (texto) =>
    String(texto || '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

// Franja superior con los 4 colores de la marca
const franjaColores = () => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
            <td width="25%" height="6" style="background:${C.primario};font-size:0;line-height:6px;">&nbsp;</td>
            <td width="25%" height="6" style="background:${C.secundario};font-size:0;line-height:6px;">&nbsp;</td>
            <td width="25%" height="6" style="background:${C.exito};font-size:0;line-height:6px;">&nbsp;</td>
            <td width="25%" height="6" style="background:${C.alerta};font-size:0;line-height:6px;">&nbsp;</td>
        </tr>
    </table>`;

// Etiqueta superior (chip)
const chip = (texto, fondo, colorTexto) => `
    <span style="display:inline-block;padding:5px 14px;border-radius:999px;background:${fondo};color:${colorTexto};font-family:${FUENTE};font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;">${texto}</span>`;

// Bloque del código de verificación (amarillo)
const bloqueCodigo = (codigo) => `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
        <tr>
            <td align="center" style="background:#FFF6DB;border:2px dashed ${C.primario};border-radius:16px;padding:20px 34px;">
                <span style="font-family:Consolas,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:12px;color:${C.texto};">${codigo}</span>
            </td>
        </tr>
    </table>`;

// Cajas de color
const caja = (color, fondo, bordeIzq, texto, colorTexto) => `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0 0;background:${fondo};border-left:4px solid ${bordeIzq};border-radius:10px;">
        <tr>
            <td style="padding:14px 18px;font-family:${FUENTE};font-size:13px;line-height:1.6;color:${colorTexto};">${texto}</td>
        </tr>
    </table>`;

const cajaInfo = (texto) => caja(C.secundario, '#EFF6FF', C.secundario, texto, '#1E3A8A');
const cajaExito = (texto) => caja(C.exito, '#F0FDF4', C.exito, texto, '#166534');
const cajaSeguridad = (texto) => caja(C.alerta, '#FEF2F2', C.alerta, texto, '#7F1D1D');

const plantilla = ({ chip: chipHtml, titulo, cuerpoHtml }) => `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
    </head>
    <body style="margin:0;padding:0;background-color:${C.fondo};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.fondo};padding:32px 16px;">
            <tr>
                <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background-color:#FFFFFF;border:1px solid ${C.borde};border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(31,41,55,0.06);">

                        <!-- Franja de marca -->
                        <tr><td>${franjaColores()}</td></tr>

                        <!-- Encabezado con logo -->
                        <tr>
                            <td align="center" style="padding:34px 24px 6px;">
                                <img src="${env.logoUrl}" alt="BAKNAZO" width="150" style="display:block;border:0;max-width:180px;height:auto;">
                            </td>
                        </tr>

                        <!-- Contenido -->
                        <tr>
                            <td style="padding:18px 40px 38px;">
                                ${chipHtml ? `<div style="margin-bottom:16px;">${chipHtml}</div>` : ''}
                                <h1 style="margin:0 0 16px;font-family:${FUENTE};font-size:25px;line-height:1.3;color:${C.secundario};">${titulo}</h1>
                                <div style="font-family:${FUENTE};font-size:15px;line-height:1.7;color:#4B5563;">${cuerpoHtml}</div>
                            </td>
                        </tr>

                        <!-- Pie -->
                        <tr>
                            <td style="padding:24px 32px;background:${C.texto};">
                                <p style="margin:0 0 6px;font-family:${FUENTE};font-size:13px;color:#F9FAFB;text-align:center;">
                                    <strong>BAKNAZO</strong> · Compra y vende local
                                </p>
                                ${urlPublica ? `<p style="margin:0;font-family:${FUENTE};font-size:12px;text-align:center;">
                                    <a href="${urlPublica}" style="color:${C.primario};text-decoration:none;">${urlPublica}</a>
                                </p>` : ''}
                            </td>
                        </tr>
                    </table>
                    <p style="font-family:${FUENTE};font-size:11px;color:#9CA3AF;text-align:center;margin:14px 0 0;">
                        Correo transaccional de BAKNAZO. Si no esperabas este mensaje, ignóralo con tranquilidad.
                    </p>
                </td>
            </tr>
        </table>
    </body>
    </html>`;

const htmlCodigoVerificacion = (codigo) =>
    plantilla({
        chip: chip('Verificación', C.secundario, '#FFFFFF'),
        titulo: 'Confirma tu cuenta',
        cuerpoHtml: `
            <p style="margin-top:0;">¡Hola! Nos alegra que quieras formar parte de <strong>BAKNAZO</strong>.</p>
            <p>Para activar tu cuenta, ingresa este código en la app:</p>
            ${bloqueCodigo(codigo)}
            ${cajaInfo('Ingresa el código en la pantalla de verificación. Expira en <strong>15 minutos</strong>.')}
            ${cajaSeguridad('Si no creaste una cuenta en BAKNAZO, ignora este correo.')}`,
    });

const htmlCodigoRecuperacion = (codigo) =>
    plantilla({
        chip: chip('Seguridad', C.alerta, '#FFFFFF'),
        titulo: 'Restablece tu contraseña',
        cuerpoHtml: `
            <p style="margin-top:0;">Recibimos una solicitud para cambiar la contraseña de tu cuenta en <strong>BAKNAZO</strong>.</p>
            <p>Usa este código para continuar:</p>
            ${bloqueCodigo(codigo)}
            ${cajaInfo('El código expira en <strong>15 minutos</strong>. Úsalo solo una vez.')}
            ${cajaSeguridad('Si no solicitaste este cambio, ignora este correo. Tu contraseña no cambia sola.')}`,
    });

const htmlCodigoVinculacion = (codigo, proveedor = 'GOOGLE') =>
    plantilla({
        chip: chip('Seguridad', C.secundario, '#FFFFFF'),
        titulo: 'Vincula tu cuenta',
        cuerpoHtml: `
            <p style="margin-top:0;">Alguien intentó iniciar sesión con <strong>${escaparHtml(proveedor)}</strong> usando el correo de tu cuenta en <strong>BAKNAZO</strong>.</p>
            <p>Si fuiste tú, ingresa este código en la app para vincular ambas formas de acceso:</p>
            ${bloqueCodigo(codigo)}
            ${cajaInfo('El código expira en <strong>15 minutos</strong>. Úsalo solo una vez.')}
            ${cajaSeguridad('Si no fuiste tú, ignora este correo. Tu cuenta no se vinculará sin este código.')}`,
    });

const htmlBienvenida = (nombres, tipoCuenta = 'PERSONA') => {
    const texto = tipoCuenta === 'NEGOCIO'
        ? 'Tu cuenta de negocio quedó activa. Ya puedes iniciar sesión con tu correo y contraseña.'
        : 'Tu cuenta quedó activa. Ya puedes iniciar sesión con tu correo y contraseña.';
    return plantilla({
        chip: chip('Cuenta activa', C.exito, '#FFFFFF'),
        titulo: `¡Bienvenido, ${escaparHtml(nombres)}!`,
        cuerpoHtml: `
            <p style="margin-top:0;">Tu correo fue verificado correctamente y tu cuenta ya está <strong>activa</strong>.</p>
            ${cajaExito(texto)}
            ${cajaSeguridad('Si tú no creaste esta cuenta, ignora este correo.')}`,
    });
};

const enviarCorreo = async ({ para, asunto, textoPlano, html, codigoParaConsola }) => {
    if (!transporter) {
        // Sin SMTP configurado: se registra en consola para poder probar en local.
        console.log(`[email:${asunto}] destinatario=${para} codigo=${codigoParaConsola}`);
        return;
    }

    await transporter.sendMail({
        from: env.smtp.from,
        to: para,
        replyTo: env.smtp.replyTo || env.smtp.user,
        subject: asunto,
        text: textoPlano,
        ...(html ? { html } : {}),
    });
};

const enviarCodigoVerificacion = (correo, codigo) =>
    enviarCorreo({
        para: correo,
        asunto: 'Verifica tu correo - BAKNAZO',
        textoPlano: `Tu código de verificación es ${codigo}. Expira en 15 minutos. Si no creaste una cuenta en BAKNAZO, ignora este correo.`,
        html: htmlCodigoVerificacion(codigo),
        codigoParaConsola: codigo,
    });

const enviarCodigoRecuperacion = (correo, codigo) =>
    enviarCorreo({
        para: correo,
        asunto: 'Recupera tu contraseña - BAKNAZO',
        textoPlano: `Tu código para restablecer tu contraseña es ${codigo}. Expira en 15 minutos. Si no lo solicitaste, ignora este correo.`,
        html: htmlCodigoRecuperacion(codigo),
        codigoParaConsola: codigo,
    });

const enviarCodigoVinculacion = (correo, codigo, proveedor = 'GOOGLE') =>
    enviarCorreo({
        para: correo,
        asunto: 'Vincula tu cuenta - BAKNAZO',
        textoPlano: `Tu código para vincular tu cuenta con ${proveedor} es ${codigo}. Expira en 15 minutos. Si no fuiste tú, ignora este correo.`,
        html: htmlCodigoVinculacion(codigo, proveedor),
        codigoParaConsola: codigo,
    });

const enviarBienvenida = (correo, nombres, tipoCuenta = 'PERSONA') =>
    enviarCorreo({
        para: correo,
        asunto: '¡Bienvenido a BAKNAZO!',
        textoPlano: `¡Hola ${nombres}! Tu cuenta fue verificada. Bienvenido a BAKNAZO.`,
        html: htmlBienvenida(nombres, tipoCuenta),
    });

module.exports = {
    enviarCodigoVerificacion,
    enviarCodigoRecuperacion,
    enviarCodigoVinculacion,
    enviarBienvenida,
    // Generadores de HTML (útiles para vistas previas o pruebas)
    htmlCodigoVerificacion,
    htmlCodigoRecuperacion,
    htmlCodigoVinculacion,
    htmlBienvenida,
};