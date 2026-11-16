# Home Casa: regras para quem for mexer aqui

Módulo TizenBrew (packageType "app") que roda numa Samsung UN65RU7100 (2019,
Tizen 5.0). Já está instalado e funcionando na TV. Não quebre o que funciona.

## Restrições da TV (obrigatórias)
- `app/` roda no **Chromium 63**: ES5 apenas (sem `=>`, `let/const`, template
  strings, optional chaining, `??`). CSS sem flexbox `gap`, sem `inset`, sem
  `aspect-ratio`; use prefixos `-webkit-` em flex/transform. Use `vw` (a tela
  é 1920x1080).
- `service/service.js` roda no **Node v4.4.3** da TV: ES5 e só módulos nativos.
- Teste a sintaxe com acorn `ecmaVersion: 5` antes de publicar.
- Sem assets externos (CDN/fontes web); caminhos relativos apenas.
- Nada de recomendações, clima, calendário ou apps extras. Idioma pt-BR.
  Legível a 3 m.

## Contrato entre página e service (não mude sem atualizar os dois lados)
- `GET /api/apps`, `POST /api/launch {id, voltar}`, `POST /api/key {key}`,
  `POST /api/prefs {acordarNaHome}`, `GET /api/status`, `GET /api/running`.
- `app/config.js` é o arquivo que o usuário edita: tiles (nome, appId, procurar,
  cor, hdmi), `teclaVoltar`, `voltarParaHome`, `abrirHomeAoLigar`. Os appIds
  são os reais desta TV; não troque.
- Teclas: ←/→ navegam, OK (13) abre, Voltar (10009) / Esc envia `teclaVoltar`.

## Como publicar (o TizenBrew carrega pelo jsDelivr)
1. Suba `version` no package.json, faça commit (mensagem curta em português).
2. `git tag -a vX.Y.Z -m vX.Y.Z && git push origin main --tags`
3. `gh release create vX.Y.Z`
4. Limpe o cache: `curl https://purge.jsdelivr.net/gh/thigs/tv-home-casa@latest/<arquivo>`
   e `curl https://purge.jsdelivr.net/gh/thigs/tv-home-casa/<arquivo>` para cada
   arquivo alterado. Confira em `https://cdn.jsdelivr.net/gh/thigs/tv-home-casa/<arquivo>`.
5. Na TV: mudanças em `app/` aparecem ao reabrir a Home. Mudanças no
   `service/` só entram após reiniciar a TV a frio (segurar o power até o logo).

## Testar no PC
- `python -m http.server 5173 --bind 127.0.0.1` dentro desta pasta e abra
  `http://127.0.0.1:5173/app/index.html` (modo de teste; Esc = Voltar).
- Diagnóstico da TV real (só leitura): `http://192.168.1.188:8086/api/status`.

O histórico completo está em `../LOG.md`.
