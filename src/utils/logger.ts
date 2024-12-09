let isDebug = false;

export function enable() {
  isDebug = true;
}

export function disable() {
  isDebug = false;
}

export function debug(msg: unknown) {
  isDebug && console.debug(msg);
}

export function info(msg: unknown) {
  isDebug && console.info(msg);
}

export function log(msg: unknown) {
  isDebug && console.log(msg);
}

export function warn(msg: unknown) {
  isDebug && console.warn(msg);
}

export function error(msg: unknown) {
  isDebug && console.error(msg);
}
