/*
 * Home Casa: service que roda no Node da TV, dentro do TizenBrew.
 *
 * A página do launcher não tem o objeto `tizen`; este service tem. Ele expõe
 * uma API HTTP pequena na porta 8086:
 *
 *   GET  /api/status   diagnóstico (versão do Node, se há tizen, remoto pronto)
 *   GET  /api/apps     apps instalados: [{ id, name, show }]  (também pela rede,
 *                      só leitura, para descobrir os IDs no PC)
 *   GET  /api/running  apps rodando agora (diagnóstico, só leitura)
 *   POST /api/launch   { id, voltar }  abre um app; com voltar=true, quando o
 *                      app fechar o service reabre o TizenBrew (só 127.0.0.1)
 *   POST /api/key      { key }  envia tecla do controle (só 127.0.0.1)
 *
 * Teclas vão pelo controle remoto de rede da Samsung:
 *   wss://TV:8002/api/v2/channels/samsung.remote.control
 * Na primeira vez a TV pergunta se permite "Home Casa". O token fica salvo.
 *
 * O Node da TV é antigo e só aceita ES5, e o TizenBrew só deixa usar módulos
 * nativos do Node. Por isso há um cliente WebSocket mínimo aqui dentro.
 *
 * No PC (desenvolvimento):  TV_HOST=192.168.1.188 node service/service.js
 */
(function () {
  'use strict';

  var http = require('http');
  var tls = require('tls');
  var crypto = require('crypto');
  var urlLib = require('url');
  var fs = require('fs');
  var pathLib = require('path');

  var PORT = 8086;
  var NAME = 'Home Casa';
  var env = (typeof process !== 'undefined' && process.env) || {};
  var TV_HOST = env.TV_HOST || '127.0.0.1';
  var HAS_TIZEN = typeof tizen !== 'undefined' && !!tizen.application;
  var SHARE_DIR = '/home/owner/share';
  var STATE_FILE = fs.existsSync(SHARE_DIR) ? SHARE_DIR + '/tv-home-casa.json' : pathLib.resolve('.tv-home-casa.json');
  var ALLOWED_KEYS = /^KEY_(HDMI[1-4]|TV|EXIT|HOME|SOURCE|RETURN)$/;

  function log(msg) { console.log('[home-casa] ' + msg); }

  function bufFrom(data, enc) { return Buffer.from ? Buffer.from(data, enc) : new Buffer(data, enc); }
  function bufAlloc(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n).fill(0); }

  /* ---------- estado salvo (token do controle remoto) ---------- */

  var state = { remoteToken: '', acordarNaHome: true, events: [] };
  try {
    var saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (typeof saved.remoteToken === 'string') state.remoteToken = saved.remoteToken;
    if (saved.acordarNaHome === false) state.acordarNaHome = false;
    if (saved.events && saved.events.length) state.events = saved.events.slice(-15);
  } catch (e) { /* primeira vez */ }

  function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); }
    catch (e) { log('não salvou estado: ' + e.message); }
  }

  /* ---------- WebSocket mínimo sobre TLS (controle remoto da TV) ---------- */

  function wsConnect(url, on) {
    var u = urlLib.parse(url);
    var buffer = bufAlloc(0);
    var upgraded = false;
    var sock = tls.connect({ host: u.hostname, port: Number(u.port) || 443, rejectUnauthorized: false }, function () {
      sock.write('GET ' + u.path + ' HTTP/1.1\r\nHost: ' + u.host + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n');
    });

    function sendFrame(payload, opcode) {
      var len = payload.length;
      var head;
      if (len < 126) { head = bufAlloc(2); head[1] = 0x80 | len; }
      else { head = bufAlloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
      head[0] = 0x80 | opcode;
      var mask = crypto.randomBytes(4);
      var body = bufAlloc(len);
      for (var i = 0; i < len; i++) body[i] = payload[i] ^ mask[i % 4];
      sock.write(Buffer.concat([head, mask, body]));
    }

    function readFrames() {
      while (buffer.length >= 2) {
        var len = buffer[1] & 127;
        var off = 2;
        if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buffer.length < 10) return; len = buffer.readUInt32BE(6); off = 10; }
        if (buffer[1] & 128) off += 4;
        if (buffer.length < off + len) return;
        var opcode = buffer[0] & 15;
        var payload = buffer.slice(off, off + len);
        buffer = buffer.slice(off + len);
        if (opcode === 1 && on.message) on.message(payload.toString('utf8'));
        else if (opcode === 8) sock.end();
        else if (opcode === 9) sendFrame(payload, 10);
      }
    }

    sock.on('data', function (chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        var end = buffer.toString('binary').indexOf('\r\n\r\n');
        if (end === -1) return;
        if (!/^HTTP\/1\.1 101/.test(buffer.slice(0, end).toString())) {
          log('TV recusou o WebSocket: ' + buffer.slice(0, end).toString().split('\r\n')[0]);
          return sock.destroy();
        }
        upgraded = true;
        buffer = buffer.slice(end + 4);
      }
      readFrames();
    });
    sock.on('close', function () { if (on.close) on.close(); });
    sock.on('error', function (e) { log('erro no controle remoto: ' + e.message); });

    return {
      send: function (text) { sendFrame(bufFrom(String(text), 'utf8'), 1); },
      close: function () { sock.end(); }
    };
  }

  var remote = { sock: null, ready: false, queue: [] };

  function remoteUrl() {
    var url = 'wss://' + TV_HOST + ':8002/api/v2/channels/samsung.remote.control?name=' +
      bufFrom(NAME).toString('base64');
    return state.remoteToken ? url + '&token=' + state.remoteToken : url;
  }

  // Conecta só quando a primeira tecla é pedida, para o "Permitir" aparecer
  // na hora em que a pessoa usa a função.
  function connectRemote() {
    if (remote.sock) return;
    remote.sock = wsConnect(remoteUrl(), {
      message: function (raw) {
        var msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (msg.event === 'ms.channel.connect') {
          if (msg.data && msg.data.token && String(msg.data.token) !== state.remoteToken) {
            state.remoteToken = String(msg.data.token);
            saveState();
          }
          remote.ready = true;
          flushKeys();
        } else if (msg.event === 'ms.channel.unauthorized') {
          log('TV não autorizou o controle remoto');
          remote.queue = [];
          remote.sock.close();
        }
      },
      close: function () { remote.sock = null; remote.ready = false; }
    });
  }

  function flushKeys() {
    while (remote.ready && remote.queue.length) {
      remote.sock.send(JSON.stringify({
        method: 'ms.remote.control',
        params: { Cmd: 'Click', DataOfCmd: remote.queue.shift(), Option: 'false', TypeOfRemote: 'SendRemoteKey' }
      }));
    }
  }

  function sendKey(key) {
    remote.queue.push(key);
    if (remote.ready) flushKeys(); else connectRemote();
  }

  /* ---------- apps (tizen.application) ---------- */

  var appsCache = null;

  function listApps() {
    if (!HAS_TIZEN) return Promise.reject(new Error('API tizen indisponível (fora da TV)'));
    if (appsCache) return Promise.resolve(appsCache);
    return new Promise(function (resolve, reject) {
      tizen.application.getAppsInfo(function (infos) {
        appsCache = infos.map(function (info) {
          return { id: info.id, name: info.name, show: info.show !== false };
        }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
        setTimeout(function () { appsCache = null; }, 60000);
        resolve(appsCache);
      }, function (err) { reject(new Error(err && err.message ? err.message : 'getAppsInfo falhou')); });
    });
  }

  function launchApp(id) {
    if (!HAS_TIZEN) return Promise.reject(new Error('API tizen indisponível (fora da TV)'));
    return new Promise(function (resolve, reject) {
      tizen.application.launch(id, resolve, function (err) {
        reject(new Error(err && err.message ? err.message : 'launch falhou'));
      });
    });
  }

  /* ---------- volta automática para a Home ---------- */

  // Quando a Home abre um app, vigiamos se ele continua rodando. Quando ele
  // fecha (Voltar/Sair dentro do app), reabrimos o TizenBrew, que reabre a Home
  // (estando aberta em segundo plano ou como módulo de auto-launch).
  var STORE_APP = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/;
  var POLL_MS = 2000;
  var NEVER_SEEN_GIVE_UP_MS = 30000;
  var watch = null;       // { appId, since, seen, others: {appId: true} }
  var lastReturn = null;  // diagnóstico: { at, appId, action }

  function tizenBrewAppId() {
    try {
      var pkg = tizen.application.getAppInfo().packageId;
      if (pkg) return pkg + '.TizenBrewStandalone';
    } catch (e) { /* cai no padrão */ }
    return 'xvvl3S1bvH.TizenBrewStandalone';
  }

  function runningApps() {
    return new Promise(function (resolve, reject) {
      if (!HAS_TIZEN) return reject(new Error('API tizen indisponível (fora da TV)'));
      tizen.application.getAppsContext(function (ctxs) {
        resolve(ctxs.map(function (c) { return c.appId; }));
      }, function (err) { reject(new Error(err && err.message ? err.message : 'getAppsContext falhou')); });
    });
  }

  function packageOf(appId) { return String(appId).split('.')[0]; }

  // Apps de loja que estão rodando e não são o vigiado nem o TizenBrew.
  function otherStoreApps(ids, watchedId) {
    var tbPkg = packageOf(tizenBrewAppId());
    var out = {};
    ids.forEach(function (id) {
      if (!STORE_APP.test(id)) return;
      if (packageOf(id) === tbPkg || packageOf(id) === packageOf(watchedId)) return;
      out[id] = true;
    });
    return out;
  }

  function startWatch(appId) {
    watch = { appId: appId, since: Date.now(), seen: false, others: {} };
  }

  function pollWatch() {
    if (!watch) return;
    var w = watch;
    runningApps().then(function (ids) {
      if (watch !== w) return;
      var running = ids.indexOf(w.appId) !== -1;
      if (running) {
        if (!w.seen) { w.seen = true; w.others = otherStoreApps(ids, w.appId); }
        return;
      }
      if (!w.seen) {
        if (Date.now() - w.since > NEVER_SEEN_GIVE_UP_MS) {
          lastReturn = { at: new Date().toISOString(), appId: w.appId, action: 'desistiu: app nunca apareceu rodando' };
          watch = null;
        }
        return;
      }
      watch = null;
      // Se outro app de loja abriu nesse meio-tempo (pela barra da Samsung),
      // a pessoa está usando ele: não puxamos a Home por cima.
      var now = otherStoreApps(ids, w.appId);
      var newer = Object.keys(now).filter(function (id) { return !w.others[id]; });
      if (newer.length) {
        lastReturn = { at: new Date().toISOString(), appId: w.appId, action: 'não voltou: outro app aberto (' + newer.join(', ') + ')' };
        return;
      }
      lastReturn = { at: new Date().toISOString(), appId: w.appId, action: 'voltou para a Home' };
      log(w.appId + ' fechou; reabrindo o TizenBrew');
      launchApp(tizenBrewAppId()).catch(function (e) {
        lastReturn.action = 'falhou ao reabrir TizenBrew: ' + e.message;
      });
    }, function (e) {
      lastReturn = { at: new Date().toISOString(), appId: w.appId, action: 'erro lendo apps rodando: ' + e.message };
      watch = null;
    });
  }

  if (HAS_TIZEN) setInterval(pollWatch, POLL_MS);

  /* ---------- abrir a Home quando a TV liga ---------- */

  // Desligada pelo controle, a TV entra em espera (Instant On) e este processo
  // fica congelado. Ao ligar, o relógio "pula": se o intervalo entre dois
  // ticks passar de WAKE_GAP_MS, a TV acabou de acordar -> reabrimos o TizenBrew.
  var TICK_MS = 5000;
  var WAKE_GAP_MS = 60000;
  var startedAt = Date.now();
  var lastTick = Date.now();

  function addEvent(text) {
    state.events = (state.events || []).concat([new Date().toISOString() + ' ' + text]).slice(-15);
    saveState();
  }

  function onTick() {
    var now = Date.now();
    var gap = now - lastTick;
    lastTick = now;
    if (gap < WAKE_GAP_MS) return;
    if (state.acordarNaHome === false) return addEvent('acordou após ' + Math.round(gap / 1000) + ' s (abrir Home desligado)');
    watch = null;
    addEvent('acordou após ' + Math.round(gap / 1000) + ' s; abrindo a Home');
    // Pequena espera para a TV terminar de ligar a tela e a rede.
    setTimeout(function () {
      launchApp(tizenBrewAppId()).catch(function (e) { addEvent('falhou ao abrir TizenBrew: ' + e.message); });
    }, 3000);
  }

  if (HAS_TIZEN) {
    setInterval(onTick, TICK_MS);
    addEvent('service iniciado');
  }

  /* ---------- HTTP ---------- */

  function isLocal(req) {
    var a = req.socket.remoteAddress || '';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  }

  function send(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var data = '';
      req.on('data', function (c) {
        data += c;
        if (data.length > 4096) { reject(new Error('corpo grande demais')); req.destroy(); }
      });
      req.on('end', function () {
        try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('JSON inválido')); }
      });
    });
  }

  function fail(res) {
    return function (err) { send(res, 500, { error: err && err.message ? err.message : String(err) }); };
  }

  function handle(req, res) {
    var route = req.method + ' ' + urlLib.parse(req.url).pathname;
    if (req.method === 'OPTIONS') return send(res, 204, {});

    if (route === 'GET /api/status') {
      return send(res, 200, {
        app: NAME,
        node: process.version,
        tizen: HAS_TIZEN,
        tvHost: TV_HOST,
        remoteReady: remote.ready,
        remoteToken: !!state.remoteToken,
        watching: watch ? { appId: watch.appId, seen: watch.seen } : null,
        lastReturn: lastReturn,
        startedAt: new Date(startedAt).toISOString(),
        acordarNaHome: state.acordarNaHome !== false,
        events: state.events || []
      });
    }
    // Diagnóstico só de leitura: apps rodando agora.
    if (route === 'GET /api/running') {
      return runningApps().then(function (ids) {
        send(res, 200, { tizenBrew: tizenBrewAppId(), running: ids });
      }).catch(fail(res));
    }
    if (route === 'GET /api/apps') {
      return listApps().then(function (apps) { send(res, 200, { apps: apps }); }).catch(fail(res));
    }

    // Daqui para baixo: só a própria TV (a página do launcher).
    if (!isLocal(req)) return send(res, 403, { error: 'Somente local' });

    if (route === 'POST /api/launch') {
      return readBody(req).then(function (body) {
        var id = String(body.id || '');
        if (!id) throw new Error('id vazio');
        return launchApp(id).then(function () {
          if (body.voltar) startWatch(id); else watch = null;
          send(res, 200, { ok: true, voltar: !!body.voltar });
        });
      }).catch(fail(res));
    }
    // A página manda as preferências do config.js ao abrir.
    if (route === 'POST /api/prefs') {
      return readBody(req).then(function (body) {
        var want = body.acordarNaHome !== false;
        if ((state.acordarNaHome !== false) !== want) { state.acordarNaHome = want; saveState(); }
        send(res, 200, { ok: true, acordarNaHome: want });
      }).catch(fail(res));
    }
    if (route === 'POST /api/key') {
      return readBody(req).then(function (body) {
        var key = String(body.key || '');
        if (!ALLOWED_KEYS.test(key)) return send(res, 400, { error: 'Tecla não permitida' });
        sendKey(key);
        send(res, 200, { ok: true });
      }).catch(fail(res));
    }
    send(res, 404, { error: 'Não encontrado' });
  }

  var server = http.createServer(function (req, res) {
    try { handle(req, res); } catch (e) { send(res, 500, { error: e.message }); }
  });
  server.on('error', function (e) {
    // Porta ocupada = o service já está rodando (módulo aberto de novo).
    log('servidor não subiu: ' + e.message);
  });
  server.listen(PORT, '0.0.0.0', function () {
    log('ouvindo na porta ' + PORT + ' (TV ' + TV_HOST + ', tizen=' + HAS_TIZEN + ')');
  });
  if (HAS_TIZEN) listApps().catch(function () {}); // aquece o cache
})();
