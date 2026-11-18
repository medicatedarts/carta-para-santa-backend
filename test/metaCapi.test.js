// Pruebas de metaCapi.js sin red: se reemplaza fetch para ver qué se le enviaría a Meta.
const test = require('node:test');
const assert = require('node:assert');

function load(env) {
  for (const k of ['META_PIXEL_ID', 'META_CAPI_TOKEN', 'META_TEST_EVENT_CODE']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../metaCapi')];
  return require('../metaCapi');
}

test('sin credenciales no envía nada', async () => {
  const meta = load({});
  let called = false;
  global.fetch = async () => { called = true; };
  assert.strictEqual(await meta.sendEvent({ eventName: 'Purchase', eventId: 'x', email: 'a@b.com' }), false);
  assert.strictEqual(called, false);
});

test('Purchase: correo cifrado, monto y sin datos del niño', async () => {
  const meta = load({ META_PIXEL_ID: '123', META_CAPI_TOKEN: 'tok', META_TEST_EVENT_CODE: 'TEST1' });
  let sent;
  global.fetch = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true }; };
  const ok = await meta.sendEvent({
    eventName: 'Purchase', eventId: 'ord-1', email: ' Mama@Ejemplo.com ',
    fbc: 'fb.1.1763500000000.AbC_123', ip: '1.2.3.4', userAgent: 'UA', valueCents: 599, currency: 'usd',
    sourceUrl: 'https://cartaparasanta.com/gracias.html',
  });
  assert.strictEqual(ok, true);
  assert.match(sent.url, /graph\.facebook\.com\/v\d+\.0\/123\/events\?access_token=tok/);
  const ev = sent.body.data[0];
  assert.strictEqual(sent.body.test_event_code, 'TEST1');
  assert.strictEqual(ev.event_id, 'ord-1');
  assert.strictEqual(ev.action_source, 'website');
  assert.deepStrictEqual(ev.user_data.em, [meta.sha256('mama@ejemplo.com')]);
  assert.notStrictEqual(ev.user_data.em[0], 'mama@ejemplo.com');
  assert.strictEqual(ev.user_data.fbc, 'fb.1.1763500000000.AbC_123');
  assert.deepStrictEqual(ev.custom_data, { currency: 'USD', value: 5.99, content_name: 'Carta de Santa', content_type: 'product' });
  assert.deepStrictEqual(Object.keys(ev.user_data).sort(), ['client_ip_address', 'client_user_agent', 'em', 'fbc']);
});

test('fbc con forma rara se descarta', () => {
  const meta = load({});
  assert.strictEqual(meta.cleanFbc('fb.1.1763500000000.ok-1'), 'fb.1.1763500000000.ok-1');
  assert.strictEqual(meta.cleanFbc('<script>'), null);
  assert.strictEqual(meta.cleanFbc('fb.1.abc.x'), null);
  assert.strictEqual(meta.cleanFbc(123), null);
});

test('si Meta falla no lanza error', async () => {
  const meta = load({ META_PIXEL_ID: '1', META_CAPI_TOKEN: 't' });
  global.fetch = async () => { throw new Error('sin red'); };
  assert.strictEqual(await meta.sendEvent({ eventName: 'Purchase', eventId: 'x', email: 'a@b.com' }), false);
});
