const crypto = require('crypto');

// Sin caracteres que se confunden al copiarlos a mano (0/O, 1/l/I).
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const NUMEROS = '23456789';
const SIMBOLOS = '!@#$%*-_+?';

const elegir = (conjunto) => conjunto[crypto.randomInt(0, conjunto.length)];

/**
 * Contraseña temporal de 18 caracteres con al menos una de cada clase,
 * generada con crypto (no Math.random). Cumple la regla de contraseñas de la
 * app y solo se muestra una vez: en la base queda únicamente su hash.
 */
const generarContrasenaTemporal = (largo = 18) => {
    const todos = MAYUSCULAS + MINUSCULAS + NUMEROS + SIMBOLOS;
    const caracteres = [elegir(MAYUSCULAS), elegir(MINUSCULAS), elegir(NUMEROS), elegir(SIMBOLOS)];
    while (caracteres.length < largo) caracteres.push(elegir(todos));
    // Fisher-Yates para que las cuatro obligatorias no queden siempre al principio.
    for (let i = caracteres.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
    }
    return caracteres.join('');
};

module.exports = { generarContrasenaTemporal };
