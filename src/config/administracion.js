// Catálogos de la administración: permisos, motivos y textos. Una sola fuente
// para el backend; el panel los pide a la API en vez de copiarlos.

// Deben coincidir con el CHECK de administrador_permisos en script.sql.
const PERMISOS = [
    { id: 'anuncios.ver', grupo: 'Anuncios', nombre: 'Ver anuncios pendientes y publicados' },
    { id: 'anuncios.aprobar', grupo: 'Anuncios', nombre: 'Aprobar anuncios' },
    { id: 'anuncios.rechazar', grupo: 'Anuncios', nombre: 'Rechazar anuncios' },
    { id: 'anuncios.pausar', grupo: 'Anuncios', nombre: 'Pausar anuncios' },
    { id: 'anuncios.eliminar', grupo: 'Anuncios', nombre: 'Eliminar anuncios' },
    { id: 'usuarios.ver', grupo: 'Usuarios', nombre: 'Consultar usuarios' },
    { id: 'usuarios.suspender', grupo: 'Usuarios', nombre: 'Suspender usuarios' },
    { id: 'usuarios.reactivar', grupo: 'Usuarios', nombre: 'Reactivar usuarios' },
    { id: 'denuncias.ver', grupo: 'Denuncias', nombre: 'Consultar denuncias' },
    { id: 'denuncias.resolver', grupo: 'Denuncias', nombre: 'Resolver denuncias' },
    { id: 'estadisticas.ver', grupo: 'Administración', nombre: 'Consultar estadísticas' },
    { id: 'administradores.gestionar', grupo: 'Administración', nombre: 'Gestionar administradores' },
    { id: 'permisos.gestionar', grupo: 'Administración', nombre: 'Gestionar permisos' },
    { id: 'moderacion.configurar', grupo: 'Administración', nombre: 'Configurar moderación' },
    { id: 'auditoria.ver', grupo: 'Administración', nombre: 'Consultar auditoría' },
];
const IDS_PERMISOS = PERMISOS.map((p) => p.id);

// Lo que ve el dueño en la nota de su anuncio rechazado.
const MOTIVOS_RECHAZO = [
    { id: 'PRODUCTO_PROHIBIDO', nombre: 'Producto o servicio prohibido' },
    { id: 'CONTENIDO_OFENSIVO', nombre: 'Contenido ofensivo o sexual' },
    { id: 'POSIBLE_ESTAFA', nombre: 'Posible estafa o engaño' },
    { id: 'INFORMACION_FALSA', nombre: 'Información falsa o engañosa' },
    { id: 'CATEGORIA_INCORRECTA', nombre: 'Categoría incorrecta' },
    { id: 'FOTOS_INADECUADAS', nombre: 'Fotos inadecuadas o que no corresponden' },
    { id: 'DUPLICADO', nombre: 'Anuncio duplicado' },
    { id: 'OTRO', nombre: 'Otro motivo' },
];

// Lo que puede elegir quien denuncia (coincide con el CHECK de denuncias).
const MOTIVOS_DENUNCIA = [
    { id: 'PROHIBIDO', nombre: 'Es algo prohibido o ilegal' },
    { id: 'ESTAFA', nombre: 'Parece una estafa' },
    { id: 'OFENSIVO', nombre: 'Contenido ofensivo o sexual' },
    { id: 'FALSO', nombre: 'Información falsa' },
    { id: 'DUPLICADO', nombre: 'Está repetido' },
    { id: 'OTRO', nombre: 'Otro motivo' },
];

// Por qué una regla automática mandó un anuncio a revisión.
const MOTIVOS_REVISION = {
    PALABRA_RESTRINGIDA: 'Contiene términos restringidos',
    USUARIO_NUEVO: 'Cuenta nueva',
    DENUNCIAS: 'Recibió varias denuncias',
    REENVIADO: 'El dueño lo corrigió tras un rechazo',
};

module.exports = { PERMISOS, IDS_PERMISOS, MOTIVOS_RECHAZO, MOTIVOS_DENUNCIA, MOTIVOS_REVISION };
