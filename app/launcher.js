/*
 * Home Casa: tela de 5 tiles, navegação por setas + OK.
 *
 * A página roda dentro do TizenBrew servida por http, e por isso NÃO tem o
 * objeto `tizen`. Listar apps, abrir app e mandar teclas (HDMI, Voltar) passa
 * pelo service (service/service.js) em http://127.0.0.1:8086.
 *
 * ES5 apenas (Chromium 63): sem arrow functions, let/const, optional chaining.
 */
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8 };
  var IS_TV = /Tizen|SMART-TV/i.test(navigator.userAgent);
  var params = parseQuery(location.search);
  // No PC: ?service=http://127.0.0.1:8086 usa um service real; sem isso, modo de teste.
  var SERVICE = IS_TV ? 'http://127.0.0.1:8086' : (params.service || '');
  var MOCK = !IS_TV && !SERVICE;

  var MOCK_APPS = [
    { id: 'MOCK.Disney', name: 'Disney+', show: true },
    { id: 'MOCK.Netflix', name: 'Netflix', show: true },
    { id: 'MOCK.Prime', name: 'Prime Video', show: true },
    { id: 'MOCK.Globoplay', name: 'Globoplay', show: true }
  ];

  var tiles = (window.CONFIG && CONFIG.tiles) || [];
  var focus = 0;
  var els = {
    tiles: document.getElementById('tiles'),
    status: document.getElementById('status')
  };
  var statusTimer = null;

  function parseQuery(search) {
    var out = {};
    search.replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent(i === -1 ? pair : pair.slice(0, i));
      out[k] = i === -1 ? '' : decodeURIComponent(pair.slice(i + 1));
    });
    return out;
  }

  function setStatus(text, keep) {
    els.status.textContent = text || '';
    if (statusTimer) clearTimeout(statusTimer);
    if (text && !keep) statusTimer = setTimeout(function () { els.status.textContent = ''; }, 6000);
  }

  /* ---------- service ---------- */

  function service(path, body) {
    if (MOCK) return mockService(path, body);
    var opts = body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // evita preflight de CORS
      body: JSON.stringify(body)
    };
    return fetch(SERVICE + path, opts).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var err = new Error(json.error || ('HTTP ' + res.status));
          err.answered = true; // o service respondeu; não adianta insistir
          throw err;
        }
        return json;
      });
    });
  }

  function mockService(path, body) {
    if (path === '/api/apps') return Promise.resolve({ apps: MOCK_APPS });
    console.log('[teste] ' + path + ' ' + JSON.stringify(body));
    return Promise.resolve({ ok: true });
  }

  // O service sobe junto com o módulo; tenta por até ~25 s.
  function loadApps(attempt) {
    attempt = attempt || 0;
    return service('/api/apps').then(function (res) {
      return res.apps || [];
    }, function (err) {
      if (err.answered || attempt >= 12) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, 2000); })
        .then(function () { return loadApps(attempt + 1); });
    });
  }

  /* ---------- tiles ---------- */

  function findApp(tile, apps) {
    var words = tile.procurar || [tile.nome];
    for (var w = 0; w < words.length; w++) {
      var word = String(words[w]).toLowerCase();
      for (var i = 0; i < apps.length; i++) {
        if (apps[i].show !== false && String(apps[i].name || '').toLowerCase().indexOf(word) !== -1) return apps[i];
      }
    }
    return null;
  }

  function resolveTiles(apps) {
    tiles.forEach(function (tile) {
      if (tile.hdmi !== undefined) return;
      if (tile.appId) { tile._id = tile.appId; return; }
      var app = findApp(tile, apps);
      tile._id = app ? app.id : '';
    });
    render();
    var missing = tiles.filter(function (t) { return t.hdmi === undefined && !t._id; })
      .map(function (t) { return t.nome; });
    if (missing.length) setStatus('Não achei na TV: ' + missing.join(', '), true);
  }

  function subtitle(tile) {
    if (tile.hdmi !== undefined) return tile.hdmi ? 'HDMI ' + tile.hdmi : 'HDMI não configurado';
    if (tile._id === undefined) return '';
    return tile._id ? '' : 'Não instalado';
  }

  function render() {
    els.tiles.innerHTML = '';
    tiles.forEach(function (tile, i) {
      var div = document.createElement('div');
      var off = (tile.hdmi !== undefined && !tile.hdmi) || tile._id === '';
      div.className = 'tile' + (i === focus ? ' focado' : '') + (off ? ' indisponivel' : '');
      div.style.backgroundColor = tile.cor || '#333';
      div.setAttribute('role', 'menuitem');
      var nome = document.createElement('div');
      nome.className = 'nome';
      nome.textContent = tile.nome;
      div.appendChild(nome);
      var subText = subtitle(tile);
      if (subText) {
        var sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = subText;
        div.appendChild(sub);
      }
      div.addEventListener('click', function () { focus = i; render(); open(i); });
      els.tiles.appendChild(div);
    });
  }

  function move(delta) {
    if (!tiles.length) return;
    focus = (focus + delta + tiles.length) % tiles.length;
    render();
  }

  function open(i) {
    var tile = tiles[i];
    if (!tile) return;
    if (tile.hdmi !== undefined) {
      var n = Number(tile.hdmi);
      if (!(n >= 1 && n <= 4)) return setStatus('Defina o número do HDMI do ' + tile.nome + ' em config.js');
      setStatus('Mudando para HDMI ' + n + '…');
      return service('/api/key', { key: 'KEY_HDMI' + n }).catch(function () {
        setStatus('Não consegui trocar a entrada. Aceite "Permitir" na TV, se aparecer.');
      });
    }
    if (tile._id === undefined) return setStatus('Carregando a lista de apps…');
    if (!tile._id) return setStatus(tile.nome + ' não está instalado nesta TV');
    setStatus('Abrindo ' + tile.nome + '…');
    service('/api/launch', { id: tile._id }).catch(function (err) {
      setStatus('Não abriu ' + tile.nome + ' (' + (err && err.message ? err.message : 'erro') + ')');
    });
  }

  function back() {
    var key = (window.CONFIG && CONFIG.teclaVoltar) || 'KEY_EXIT';
    setStatus('Voltando para a TV…');
    service('/api/key', { key: key }).catch(function () {
      setStatus('Não consegui voltar. Use o botão Home do controle.');
    });
  }

  document.addEventListener('keydown', function (e) {
    switch (e.keyCode) {
      case KEY.LEFT: move(-1); break;
      case KEY.RIGHT: move(1); break;
      case KEY.ENTER: open(focus); break;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE: back(); break;
      default: return;
    }
    e.preventDefault();
  });

  render();
  if (MOCK) setStatus('Modo de teste no PC (sem TV)', true);
  loadApps().then(resolveTiles, function (err) {
    setStatus(err.answered ? 'Erro ao listar apps: ' + err.message
      : 'Serviço da Home Casa não respondeu. Abra de novo pelo TizenBrew.', true);
  });

  // Exposto para testes no PC.
  window.HomeCasa = { tiles: tiles, open: open, back: back, move: move };
})();
