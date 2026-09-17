const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const env = require('../config/env');

const generarNombre = (sufijo) =>
    `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${sufijo ? `-${sufijo}` : ''}.webp`;

// Convierte y comprime una imagen con sharp y la guarda en disco.
// Devuelve la ruta pública (/uploads/...) lista para guardar en la BDD.
const procesarImagen = async ({ buffer, subcarpeta = 'general', maxAncho = 800, maxAlto = 800, calidad = 80, recortar = false }) => {
    if (!buffer) return null;

    let pipeline = sharp(buffer).rotate();

    if (recortar) {
        pipeline = pipeline.resize(maxAncho, maxAlto, { fit: 'cover', withoutEnlargement: true });
    } else {
        pipeline = pipeline.resize({ width: maxAncho, height: maxAlto, fit: 'inside', withoutEnlargement: true });
    }

    const nombre = generarNombre(subcarpeta);
    const dirAbsoluto = path.join(env.uploadDir, subcarpeta);
    await fs.promises.mkdir(dirAbsoluto, { recursive: true });

    const rutaAbsoluta = path.join(dirAbsoluto, nombre);
    await pipeline.webp({ quality: calidad }).toFile(rutaAbsoluta);

    return `/uploads/${subcarpeta}/${nombre}`;
};

// Foto de perfil / avatar: cuadrado 500x500 (recorta el centro)
const procesarFotoPerfil = (buffer) =>
    procesarImagen({ buffer, subcarpeta: 'perfiles', maxAncho: 500, maxAlto: 500, calidad: 80, recortar: true });

// Logo del negocio: mantiene proporción, máximo 600px
const procesarLogo = (buffer) =>
    procesarImagen({ buffer, subcarpeta: 'logos', maxAncho: 600, maxAlto: 600, calidad: 85 });

// Convierte una URL pública (/uploads/...) en su ruta absoluta en disco.
const rutaAbsolutaDe = (urlPublica) => {
    if (!urlPublica) return null;
    const relativa = urlPublica.replace(/^\/uploads\//, '');
    return path.join(env.uploadDir, relativa);
};

module.exports = { procesarFotoPerfil, procesarLogo, rutaAbsolutaDe };