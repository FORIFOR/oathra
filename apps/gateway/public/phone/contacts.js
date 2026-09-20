import { $, element, notice } from './dom.js';
import { stateLabel } from './messages.js';
/** Contact editing owns its draft; it never sends a stale saved number to the call form. */
export function createContacts({ api, on, show, onSelect, owner }) {
    const fields = ['name', 'company', 'phone', 'email', 'notes', 'lastCallNotes'];
    const values = () => Object.fromEntries(fields.map(key => [key, $('#contact-' + key).value]));
    let selected = null, contacts = [], editVersion = 0, editor = 0, session = 0, loading = 0, saving = false, saveAttempt = null;
    const dirty = () => fields.some(key => values()[key] !== (selected?.[key] ?? ''));
    const storageKey = () => owner() ? 'oathra:contact:' + owner() : null;
    function persist() {
        const key = storageKey();
        if (!key) return;
        try {
            sessionStorage.setItem(key, JSON.stringify({ selected, values: values(), saveAttempt }));
        } catch { /* Browser storage can be disabled; completed saves remain on the server. */ }
    }
    function forget() {
        try { sessionStorage.removeItem(storageKey()); } catch {}
    }
    function restore() {
        let saved;
        try { saved = JSON.parse(sessionStorage.getItem(storageKey())); } catch { return; }
        if (!saved?.values || fields.some(key => typeof saved.values[key] !== 'string')) return;
        const pending = saved.saveAttempt;
        edit(saved.selected ?? null, true);
        for (const key of fields) $('#contact-' + key).value = saved.values[key];
        saveAttempt = pending;
        sync();
        notice('#contact-save-status', dirty() ? '未保存' : '');
        persist();
    }

    function sync() {
        $('#contact-use').disabled = saving || !selected?.phone || dirty();
        $('#contact-form button[type=submit]').disabled = saving;
    }
    function list() {
        const query = $('#contacts-search').value.toLowerCase();
        $('#contacts-list').replaceChildren();
        for (const contact of contacts.filter(c => (c.name + ' ' + c.company).toLowerCase().includes(query))) {
            const li = element('li'), button = element('button', contact.name || contact.company);
            button.className = 'btn';
            button.onclick = () => edit(contact);
            li.append(button);
            $('#contacts-list').append(li);
        }
        $('#contacts-empty').textContent = contacts.length ? '' : '連絡先はまだありません。';
    }
    function edit(contact, force = false) {
        if (!force && dirty() && !confirm('保存していない変更を破棄しますか？'))
            return;
        selected = contact;
        saveAttempt = null;
        editor++;
        editVersion++;
        for (const key of fields)
            $('#contact-' + key).value = contact?.[key] ?? '';
        sync();
        $('#screen-contacts').classList.add('editing-contact');
        $('#contact-editor-title').textContent = contact ? '連絡先を編集' : '連絡先を追加';
        notice('#contact-save-status', '');
        notice('#contacts-error', '');
        $('#contact-history').replaceChildren();
        persist();
        if (contact?.phone) {
            const version = editVersion, generation = session;
            api('/phone/history').then(rows => {
                if (session !== generation || editVersion !== version)
                    return;
                rows.filter(r => r.request.phone === contact.phone).forEach(r => $('#contact-history').append(element('p', `${stateLabel[r.state]} · ${r.request.instruction}`)));
            }).catch(error => {
                if (!error.stale && session === generation && editVersion === version)
                    notice('#contacts-error', error.message);
            });
        }
    }
    async function open() {
        show('contacts');
        const request = ++loading, generation = session;
        const result = await api('/contacts');
        if (request !== loading || generation !== session)
            return;
        contacts = result;
        list();
        if (!contacts.length && !selected && !dirty())
            edit(null, true);
    }
    on('#contact-form', 'input', () => {
        editVersion++;
        sync();
        notice('#contact-save-status', dirty() ? '未保存' : '');
        persist();
    });
    on('#contact-form', 'submit', async () => {
        if (saving)
            return;
        const previous = selected, version = editVersion, generation = session, selection = editor;
        const body = {
            ...(previous ? {
                id: previous.id
            } : {}), ...values()
        };
        const attempt = saveAttempt ?? { body, key: crypto.randomUUID() };
        saveAttempt = attempt;
        persist();
        saving = true;
        sync();
        notice('#contacts-error', '');
        notice('#contact-save-status', '保存中…');
        try {
            const saved = await api('/contacts', 'POST', attempt.body, attempt.key);
            if (generation !== session)
                return;
            contacts = [saved, ...contacts.filter(c => c.id !== saved.id)];
            list();
            // A response must not switch away from a newer editor or erase typing during save.
            if (selection !== editor)
                return;
            saveAttempt = null;
            const unchanged = fields.every(key => values()[key] === attempt.body[key]);
            if (editVersion === version && unchanged)
                edit(saved, true);
            else {
                selected = saved;
                $('#contact-editor-title').textContent = '連絡先を編集';
            }
            notice('#contact-save-status', dirty() ? '保存後の変更は未保存です。' : '保存しました。');
        }
        catch (error) {
            if (!error.stale && generation === session && selection === editor) {
                notice('#contact-save-status', '');
                notice('#contacts-error', error.message + ' もう一度保存すると、保存結果を確認します。');
                // Explicit validation rejection is safe to correct. A lost response reuses the same key/body.
                if (error.code && error.status >= 400 && error.status < 500) saveAttempt = null;
            }
        }
        finally {
            if (generation === session) {
                saving = false;
                sync();
                persist();
            }
        }
    });
    for (const id of ['#contacts-open', '#home-contacts', '#phone-pick-contact', '#contacts-reload'])
        on(id, 'click', open);
    on('#contacts-search', 'input', list);
    on('#contacts-new', 'click', () => edit(null));
    on('#contacts-back', 'click', () => {
        $('#screen-contacts').classList.remove('editing-contact');
        $('#contacts-search').focus();
    });
    on('#contact-use', 'click', () => {
        if (saving || !selected?.phone || dirty())
            return;
        onSelect(selected);
    });
    return {
        restore,
        reset(forgetDraft = true) {
            if (forgetDraft) forget(); else persist();
            session++;
            loading++;
            editVersion++;
            selected = null;
            contacts = [];
            saving = false;
            saveAttempt = null;
            $('#contact-form').reset();
            $('#contacts-search').value = '';
            $('#contacts-list').replaceChildren();
            $('#contact-history').replaceChildren();
            $('#screen-contacts').classList.remove('editing-contact');
            notice('#contact-save-status', '');
            notice('#contacts-error', '');
            sync();
        },
    };
}
