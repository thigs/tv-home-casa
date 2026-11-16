/*
 * Configuração da Home Casa. É o único arquivo que você precisa editar.
 *
 * - A ordem dos tiles na tela é a ordem desta lista.
 * - appId: ID do app nesta TV. Se ficar vazio (''), o launcher procura o app
 *   pelo nome na lista real da TV usando as palavras de "procurar".
 *   Para ver os IDs desta TV, com a Home Casa aberta, acesse no PC:
 *   http://IP-DA-TV:8086/api/apps
 * - hdmi: número da entrada HDMI (1 a 4) do tile de entrada.
 * - cor: cor de fundo do tile.
 *
 * Use só JavaScript antigo aqui (aspas simples, sem "=>").
 */
var CONFIG = {
  tiles: [
    { nome: 'Disney+',     appId: '', procurar: ['disney'],                  cor: '#0e2a73' },
    { nome: 'Netflix',     appId: '', procurar: ['netflix'],                 cor: '#9b0a12' },
    { nome: 'Prime Video', appId: '', procurar: ['prime video', 'amazon'],   cor: '#0a5f8f' },
    { nome: 'Globoplay',   appId: '', procurar: ['globoplay'],               cor: '#c2381f' },
    { nome: 'Videogame',   hdmi: 0,                                          cor: '#2c6b35' }
  ],

  // Tecla enviada quando você aperta Voltar/Return na Home Casa.
  // 'KEY_EXIT' fecha a Home e a TV volta para a última fonte (TV ao vivo ou HDMI).
  // Alternativa: 'KEY_TV' (vai sempre para a TV ao vivo).
  teclaVoltar: 'KEY_EXIT'
};
