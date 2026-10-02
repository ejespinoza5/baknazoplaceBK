/*
 * Configuración inicial: crea la cuenta del superadministrador.
 *
 *   npm run admin:inicial
 *
 * - El correo sale de ADMIN_INICIAL_CORREO (por defecto admin@baknazo.com) y
 *   el nombre de ADMIN_INICIAL_NOMBRE.
 * - La contraseña se GENERA aquí, se muestra UNA vez en la consola y en la base
 *   solo queda su hash. No está escrita en ningún archivo.
 * - Al primer inicio de sesión el panel obliga a cambiarla.
 * - Si ya existe un superadministrador no hace nada: ejecutarlo otra vez no
 *   crea duplicados ni cambia la contraseña del existente.
 *
 *   npm run admin:inicial -- --restablecer
 *
 * - Recuperación: si el superadministrador perdió su contraseña, genera otra
 *   temporal y cierra sus sesiones. Solo lo puede hacer quien tiene acceso al
 *   servidor; desde la web no existe esta opción.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const bcrypt = require('bcrypt');
const env = require('../config/env');
const pool = require('../config/db');
const adminModel = require('../models/adminModel');
const { generarContrasenaTemporal } = require('../utils/contrasenas');
const { validarCorreo, normalizarCorreo } = require('../utils/validaciones');

(async () => {
    try {
        if (process.argv.includes('--restablecer')) {
            const { rows } = await pool.query('SELECT id, correo FROM administradores WHERE es_super AND eliminado_en IS NULL');
            if (!rows[0]) throw new Error('No hay superadministrador. Ejecuta el comando sin --restablecer para crearlo.');
            const contrasena = generarContrasenaTemporal();
            await adminModel.cambiarContrasena(rows[0].id, await bcrypt.hash(contrasena, env.bcryptRounds), true);
            await adminModel.cambiarActivo(rows[0].id, true);
            await adminModel.revocarSesiones(rows[0].id);
            await adminModel.auditar({ adminId: rows[0].id, accion: 'admin.recuperacion', objetivoTipo: 'administrador', objetivoId: rows[0].id });
            console.log('\nContraseña del superadministrador restablecida.');
            console.log(`  Correo:              ${rows[0].correo}`);
            console.log(`  Contraseña temporal: ${contrasena}`);
            console.log('\nSe cerraron sus sesiones. Al entrar se pedirá cambiarla.\n');
            return;
        }
        if (await adminModel.existeSuper()) {
            console.log('Ya existe un superadministrador. No se creó nada.');
            console.log('Si perdiste su contraseña: npm run admin:inicial -- --restablecer');
            return;
        }
        const correo = normalizarCorreo(process.env.ADMIN_INICIAL_CORREO || 'admin@baknazo.com');
        const nombre = (process.env.ADMIN_INICIAL_NOMBRE || 'Superadministrador').trim();
        if (!validarCorreo(correo)) throw new Error(`ADMIN_INICIAL_CORREO no es un correo válido: ${correo}`);
        if (await adminModel.correoEnUso(correo)) throw new Error(`Ya hay un administrador con el correo ${correo}`);

        const contrasena = generarContrasenaTemporal();
        const id = await adminModel.crear({
            nombre,
            correo,
            hash: await bcrypt.hash(contrasena, env.bcryptRounds),
            esSuper: true,
        });
        await adminModel.auditar({ adminId: id, accion: 'admin.inicial', objetivoTipo: 'administrador', objetivoId: id });

        console.log('\nSuperadministrador creado.');
        console.log(`  Correo:              ${correo}`);
        console.log(`  Contraseña temporal: ${contrasena}`);
        console.log('\nGuárdala ahora: no se vuelve a mostrar. Al entrar al panel (/admin) se te');
        console.log('pedirá cambiarla. Después puedes cambiar también el correo desde "Mi perfil".\n');
    } catch (e) {
        console.error('No se pudo crear el superadministrador:', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
