// Teléfonos en E.164 (+593991234567): así se guardan y así se devuelven.

// Normaliza lo que escribe el usuario. Acepta separadores (+593 99 123 4567,
// (099) 123-4567), el prefijo 00 y el formato local de Ecuador (0991234567).
// Devuelve { ok: true, valor } con valor null si vino vacío, o { ok: false }.
const normalizarTelefono = (entrada) => {
    if (entrada === undefined || entrada === null) return { ok: true, valor: null };
    if (typeof entrada !== 'string') return { ok: false };

    let t = entrada.trim().replace(/[\s\-().]/g, '');
    if (t === '') return { ok: true, valor: null };

    if (t.startsWith('00')) t = `+${t.slice(2)}`;
    // Local de Ecuador: 09XXXXXXXX (móvil) o 0XXXXXXXX (fijo con código de área).
    if (/^0\d{8,9}$/.test(t)) t = `+593${t.slice(1)}`;
    // Error común: dejar el 0 local después del código de país (+593 099...).
    if (/^\+5930\d{8,9}$/.test(t)) t = `+593${t.slice(5)}`;

    if (!/^\+[1-9]\d{7,14}$/.test(t)) return { ok: false };
    // Ecuador: 9 dígitos para móvil, 8 para fijo.
    if (t.startsWith('+593') && !/^\+593\d{8,9}$/.test(t)) return { ok: false };

    return { ok: true, valor: t };
};

// Como normalizarTelefono, pero devuelve null si no es válido. Para datos ya
// guardados (p. ej. los del negocio, que se validan con un formato más libre).
const e164ONull = (valor) => {
    const r = normalizarTelefono(valor);
    return r.ok ? r.valor : null;
};

// En Ecuador los móviles empiezan por 9. Fuera de Ecuador no se puede saber
// sin una tabla de numeración, así que se da por móvil.
const esMovil = (e164) => (e164.startsWith('+593') ? /^\+5939\d{8}$/.test(e164) : true);

// +593991234567 → "+593 99 123 4567"; +59321234567 → "+593 2 123 4567".
// Otros países se devuelven tal cual.
const telefonoLegible = (e164) => {
    const m = /^\+593(\d{8,9})$/.exec(e164);
    if (!m) return e164;
    const n = m[1];
    const corte = n.length === 9 ? 2 : 1;
    return `+593 ${n.slice(0, corte)} ${n.slice(corte, corte + 3)} ${n.slice(corte + 3)}`;
};

// Orden: usuario.telefono → negocio.telefono → negocio.whatsapp.
// El frontend replica este orden en telefonoDeContacto() (src/lib/contacto.ts).
// Devuelve null si no hay ningún número utilizable.
const resolverContacto = ({ usuarioTelefono, negocioTelefono, negocioWhatsapp }) => {
    const usuario = e164ONull(usuarioTelefono);
    const negocioTel = e164ONull(negocioTelefono);
    const negocioWa = e164ONull(negocioWhatsapp);

    let telefono;
    let origen;
    if (usuario) {
        telefono = usuario;
        origen = 'USUARIO';
    } else if (negocioTel || negocioWa) {
        telefono = negocioTel || negocioWa;
        origen = 'NEGOCIO';
    } else {
        return null;
    }

    // WhatsApp: el móvil personal si el número salió del usuario; si no, el
    // WhatsApp declarado por el negocio; y si no hay, el teléfono solo si es móvil
    // (un fijo no tiene WhatsApp y el enlace llevaría a un chat inexistente).
    let whatsapp = null;
    if (origen === 'USUARIO' && esMovil(telefono)) whatsapp = telefono;
    else if (negocioWa) whatsapp = negocioWa;
    else if (esMovil(telefono)) whatsapp = telefono;

    return { telefono, origen, whatsapp };
};

const enlaceWhatsapp = (whatsapp, tituloAnuncio) => {
    if (!whatsapp) return null;
    const texto = `Hola, me interesa tu anuncio "${tituloAnuncio}"`;
    return `https://wa.me/${whatsapp.slice(1)}?text=${encodeURIComponent(texto)}`;
};

module.exports = { normalizarTelefono, e164ONull, telefonoLegible, resolverContacto, enlaceWhatsapp };
