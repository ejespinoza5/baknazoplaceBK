const crypto = require('crypto');

const generarCodigoNumerico = () =>
    crypto.randomInt(0, 1000000).toString().padStart(6, '0');

const hashCodigo = (codigo) =>
    crypto.createHash('sha256').update(codigo).digest('hex');

const generarTokenOpaco = () => crypto.randomBytes(48).toString('hex');

const hashToken = (token) =>
    crypto.createHash('sha256').update(token).digest('hex');

module.exports = { generarCodigoNumerico, hashCodigo, generarTokenOpaco, hashToken };
