// Correo con estructura válida
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Contraseña: mínimo 8, al menos 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial
const REGEX_CONTRASENA = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// Teléfono/WhatsApp: +, dígitos, espacios, guiones y paréntesis, 7 a 20 caracteres
const REGEX_TELEFONO = /^[+\d][\d\s\-()]{6,19}$/;

const TIPOS_CUENTA_VALIDOS = ['PERSONA', 'NEGOCIO'];

const validarCorreo = (correo) => typeof correo === 'string' && REGEX_CORREO.test(correo);

const validarContrasena = (contrasena) =>
    typeof contrasena === 'string' && REGEX_CONTRASENA.test(contrasena);

const validarTipoCuenta = (tipo_cuenta) => TIPOS_CUENTA_VALIDOS.includes(tipo_cuenta);

const normalizarCorreo = (correo) => (typeof correo === 'string' ? correo.trim().toLowerCase() : correo);

const validarTelefono = (telefono) => typeof telefono === 'string' && REGEX_TELEFONO.test(telefono.trim());

const validarLatitud = (lat) =>
    lat !== null && lat !== undefined && !Number.isNaN(Number(lat)) && Number(lat) >= -90 && Number(lat) <= 90;

const validarLongitud = (lng) =>
    lng !== null && lng !== undefined && !Number.isNaN(Number(lng)) && Number(lng) >= -180 && Number(lng) <= 180;

// Convierte un JSON string (multipart/form-data) en objeto; null si viene vacío.
// Lanza un Error con el nombre del campo si el JSON es inválido.
const parsearJson = (valor, campo) => {
    if (valor === undefined || valor === null || valor === '') return null;
    if (typeof valor === 'object') return valor;
    try {
        return JSON.parse(valor);
    } catch (e) {
        const err = new Error(`${campo} no tiene un JSON válido`);
        err.status = 400;
        throw err;
    }
};

// Horario de atención: array de { dia, apertura, cierre } u objeto { lunes: habitación al día }.
const validarHorarioAtencion = (horario) => {
    if (horario === null || horario === undefined) return true;
    if (Array.isArray(horario)) {
        return horario.every(
            (h) =>
                h &&
                typeof h === 'object' &&
                typeof h.dia === 'string' &&
                typeof h.apertura === 'string' &&
                typeof h.cierre === 'string'
        );
    }
    return typeof horario === 'object';
};

// Redes sociales: objeto { red: url } con claves y valores de texto.
const validarRedesSociales = (redes) => {
    if (redes === null || redes === undefined) return true;
    return (
        typeof redes === 'object' &&
        !Array.isArray(redes) &&
        Object.values(redes).every((v) => typeof v === 'string' && v.trim() !== '')
    );
};

module.exports = {
    validarCorreo,
    validarContrasena,
    validarTipoCuenta,
    normalizarCorreo,
    validarTelefono,
    validarLatitud,
    validarLongitud,
    parsearJson,
    validarHorarioAtencion,
    validarRedesSociales,
    TIPOS_CUENTA_VALIDOS,
};