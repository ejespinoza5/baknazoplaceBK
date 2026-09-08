// Correo con estructura válida
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Contraseña: mínimo 8, al menos 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial
const REGEX_CONTRASENA = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const TIPOS_CUENTA_VALIDOS = ['PERSONA', 'NEGOCIO'];

const validarCorreo = (correo) => typeof correo === 'string' && REGEX_CORREO.test(correo);

const validarContrasena = (contrasena) =>
    typeof contrasena === 'string' && REGEX_CONTRASENA.test(contrasena);

const validarTipoCuenta = (tipo_cuenta) => TIPOS_CUENTA_VALIDOS.includes(tipo_cuenta);

const normalizarCorreo = (correo) => (typeof correo === 'string' ? correo.trim().toLowerCase() : correo);

module.exports = {
    validarCorreo,
    validarContrasena,
    validarTipoCuenta,
    normalizarCorreo,
    TIPOS_CUENTA_VALIDOS,
};