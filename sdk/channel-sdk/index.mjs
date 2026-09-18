/** Channel adapters translate protocols. They never receive the mission service or an approval issuer. */
export function defineChannel(implementation) {
  for (const name of ['verify', 'decode', 'send']) {
    if (typeof implementation?.[name] !== 'function') throw new TypeError(`channel.${name} is required`);
  }
  return Object.freeze({ ...implementation });
}
