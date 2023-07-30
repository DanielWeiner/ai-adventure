const { APP_HOST, APP_PORT, APP_PROTOCOL } = process.env;

export function apiUrl(relative: string) {
    return `${APP_PROTOCOL}://${APP_HOST}${APP_PORT ? ':' + APP_PORT : ''}/api/${relative}`;
}