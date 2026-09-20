export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export function element(tag, text) {
    const e = document.createElement(tag);
    if (text !== undefined)
        e.textContent = text;
    return e;
}
export function notice(id, message) {
    $(id).hidden = !message;
    $(id).textContent = message ?? '';
}
