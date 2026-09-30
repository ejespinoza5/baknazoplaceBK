// Qué partes del perfil público ve alguien que no es el dueño.
// Todo es visible por defecto: un perfil nuevo se ve completo y el dueño apaga
// lo que quiera esconder. Se guarda en usuarios.privacidad_perfil (jsonb).

const CLAVES = [
    'vendidos', // pestaña "Vendidos" y la cifra de ventas
    'me_gusta', // total de "me gusta" recibidos
    'seguidores', // cifras y listas de seguidores y seguidos
    'ubicacion', // ciudad o sector
    'miembro_desde', // "Miembro desde"
    'direccion', // negocio: dirección del local y coordenadas del mapa
    'horario', // negocio: horario de atención
    'redes', // negocio: redes sociales
    'contacto_negocio', // negocio: teléfono y WhatsApp del perfil
];

const POR_DEFECTO = Object.freeze(Object.fromEntries(CLAVES.map((c) => [c, true])));

// Lo guardado (o null) completado con los valores por defecto.
const privacidadDe = (guardada) => {
    const base = { ...POR_DEFECTO };
    if (guardada && typeof guardada === 'object' && !Array.isArray(guardada)) {
        for (const clave of CLAVES) {
            if (typeof guardada[clave] === 'boolean') base[clave] = guardada[clave];
        }
    }
    return base;
};

// Valida lo que llega en el PATCH. Devuelve el objeto completo o un mensaje de error.
const validarPrivacidad = (valor) => {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
        return { error: 'La privacidad del perfil no tiene un formato válido.' };
    }
    for (const [clave, v] of Object.entries(valor)) {
        if (!CLAVES.includes(clave)) return { error: `Opción de privacidad desconocida: ${clave}` };
        if (typeof v !== 'boolean') return { error: `La opción ${clave} debe ser true o false.` };
    }
    return { privacidad: privacidadDe(valor) };
};

module.exports = { CLAVES, POR_DEFECTO, privacidadDe, validarPrivacidad };
