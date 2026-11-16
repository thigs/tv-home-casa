# Home Casa

Home enxuta e sem anúncios para uma Samsung Tizen. Mostra 5 tiles grandes
(Disney+, Netflix, Prime Video, Globoplay e Videogame/HDMI) e funciona com as
setas + OK do controle. Roda como módulo **app** do
[TizenBrew](https://github.com/reisxd/TizenBrew).

## Instalar na TV

1. Instale o TizenBrew na TV.
2. Na TV, coloque o **Host PC IP do Developer Mode em `127.0.0.1`** e reinicie a
   TV. Sem isso, o TizenBrew não consegue abrir módulos.
3. Abra o TizenBrew → **Module Manager** → **Add GitHub Module** → `thigs/tv-home-casa`.
4. Opcional: defina a Home Casa como módulo de **auto-launch**.

## Controle

| Tecla | Ação |
|---|---|
| ← → | Escolher o tile |
| OK | Abrir o app ou trocar para o HDMI |
| Voltar/Return | Sair para a TV (última fonte); configurável |

Na primeira vez que a Home troca de entrada ou volta para a TV, a TV pergunta
se permite "Home Casa". Escolha **Permitir** uma vez.

## Configurar

Edite `app/config.js`: a ordem dos tiles, as cores, o número do HDMI do
videogame e a tecla do Voltar. Se `appId` ficar vazio, o app é procurado pelo
nome na lista real da TV. Com a Home aberta na TV, a lista de IDs aparece em
`http://IP-DA-TV:8086/api/apps`.

## Como funciona

```
TizenBrew ─┬─ app/        página (servida pelo jsDelivr, sem acesso ao `tizen`)
           └─ service/    Node na TV, porta 8086
                ├─ GET  /api/apps    tizen.application.getAppsInfo
                ├─ POST /api/launch  tizen.application.launch   (só local)
                └─ POST /api/key     teclas via wss://127.0.0.1:8002 (só local)
```

- O código precisa ser ES5: o navegador da TV é Chromium 63 e o Node da TV é antigo.
- O TizenBrew baixa o módulo do jsDelivr (`gh/thigs/tv-home-casa`), que serve a
  **tag semver mais recente**. Toda mudança precisa de uma tag nova (`vX.Y.Z`).
  Depois, rode a limpeza de cache:
  `curl https://purge.jsdelivr.net/gh/thigs/tv-home-casa@latest/package.json`
  (e o mesmo para os outros arquivos alterados).

## Desenvolvimento no PC

```
python -m http.server 5173 --bind 127.0.0.1
# abra http://127.0.0.1:5173/app/index.html  (modo de teste; Esc = Voltar)
node service/service.js                       # API em :8086 (sem tizen no PC)
# ?service=http://127.0.0.1:8086 na URL faz a página usar o service real
```

O mecanismo (service com o `tizen`, teclas pelo controle de rede, auto-launch
do TizenBrew) foi aprendido estudando o
[tvdeck](https://github.com/AtfastrSlushyMaker/tvdeck) (MIT).

Licença MIT.
