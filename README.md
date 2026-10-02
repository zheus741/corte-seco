# Corte Seco

Editor de vídeo que roda no seu computador (navegador, Mac e Windows): transcreve, acha os melhores cortes e,
quando você aplica a edição inteligente, tira pausas, vícios e takes repetidos e põe legenda viral, zoom e gancho
com a sua marca. Exporta mais rápido que o tempo real. O vídeo não sai do computador.

O vídeo sempre abre como foi gravado: a edição inteligente só entra quando você clica em **Edição inteligente**
(no alto da tela), escolhe o que entra e aplica. Dá para desfazer ou voltar ao original a qualquer momento.

## Módulos
A tela inicial pergunta o que você quer fazer. Cada módulo abre um passo com só o que ele precisa e o lugar de soltar.

Um vídeo:
- **Cortes para Reels:** vídeo longo (podcast, live, aula, jogo) vira vários cortes curtos, com nota. Serve para qualquer
  assunto: pesa o começo forte da fala, a ideia que fecha e o som que sobe (risada, torcida); com pouca fala, corta pelos picos do som.
- **Achar um momento:** escreva o que procura ("os gols", "quando fala de preço", "as risadas") e solte o vídeo.
- **Editar um vídeo:** abre inteiro na linha do tempo, como foi gravado.
- **Legendar vídeo:** escolha o estilo; a legenda entra no vídeo inteiro, sem cortar nada. Sai o vídeo legendado ou o .srt.

Vários vídeos numa edição só (pode soltar uma música junto):
- **Melhores lances:** acha os gritos da torcida e a narração (e as palavras de "O que procurar") e junta os lances.
- **Aftermovie:** escolhe os trechos mais nítidos e vivos de cada vídeo e corta na batida da música, na ordem de gravação.
- **Depoimentos:** transcreve todos e junta as melhores frases de cada pessoa, alternando quem fala, com o nome de cada uma.
- **Fala + imagens de apoio:** o vídeo de quem fala fica inteiro, com cenas dos outros por cima, sem som.
- **Podcast com várias câmeras:** uma câmera por pessoa e, se tiver, um plano aberto. Sincroniza as câmeras pelo som
  (dá para soltar o som do gravador junto), corta para a câmera de quem fala, vai para o plano aberto quando falam ao
  mesmo tempo ou quando alguém fala muito tempo seguido, e o som fica um só do começo ao fim. A legenda vem do som principal.
  Funciona melhor com cada câmera gravando o próprio som (o microfone mais perto de cada pessoa decide o corte).

Tudo abre na Edição para ajustar; "Montar de novo…" troca o tipo ou a duração sem analisar de novo.
A análise não enxerga a imagem: lance sem torcida nem narração passa batido.

## Transições, velocidade e cor (na Edição)
- **Transição nos cortes:** Zoom, Chicote ou Flash. Acontece no próprio corte (0,2 s antes e depois), sem sobrepor
  clipes. Clique num clipe do V1 para escolher a dele, ou, sem nada selecionado, aplique em todos os cortes.
- **Velocidade:** 0,25× a 2× por clipe. O que vem depois anda junto; o som estica sem mudar o tom (WSOLA na
  exportação, o próprio navegador na prévia).
- **Cor:** brilho, contraste, saturação e temperatura por clipe. **Igualar a cor dos vídeos** mede quadros de cada
  vídeo e iguala balanço de branco, brilho e contraste com o vídeo de referência (bom para câmeras diferentes).

## Procurar na imagem (coluna Cortes)
Para o que aparece e não é falado (o produto na mão, um gol sem narração): escreva o que procura e clique em
**Procurar na imagem (IA)**. O Claude olha quadros pequenos do vídeo (um a cada 1,5 a 6 s, com a sua chave) e os
quadros que mostram o pedido viram cortes. Antes de enviar, o app mostra quantos quadros vão e pede confirmação.

## Legenda traduzida (aba Legenda)
Escolha o idioma e clique em **Traduzir**: a IA do Claude traduz a fala trecho por trecho (só o texto é enviado).
As palavras traduzidas ocupam o tempo da fala original do mesmo trecho, então a legenda continua acompanhando quem
fala e some junto com o que a limpeza tirou. Dá para revisar a tradução, corrigir no monitor e voltar à original.
O vídeo e o .srt saem no idioma que estiver na tela (o .srt ganha o código do idioma no nome).

## Abertura e tela final (aba Logo e formato)
- **Abertura:** vinheta com o logo ou com um título (o gancho do corte, se não escrever outro).
- **Tela final:** chamada para ação ("Link na bio", "Siga para ver mais"...) e o seu @.
Usam o logo, a fonte e a cor de destaque da legenda, e ficam salvos no kit de marca. Entram só no arquivo exportado;
o .srt junto é empurrado pela abertura para continuar batendo com o vídeo.

## Som de rede social (em Exportar)
- **Volume de rede social** (ligado): mede o volume da edição inteira (ITU-R BS.1770, o mesmo das plataformas) e
  exporta em −14 LUFS, com um limitador que não deixa passar de −1,5 dB.
- **Tirar ruído da voz** (desligado): passa a fala pela RNNoise (rede neural da Xiph, roda no computador). Tira
  ventilador, rua e chiado; música da trilha A2 não passa por ela. Em jogo ou show, deixe desligado: tira a torcida junto.
- "Antes" e "Depois" tocam 8 s a partir do cursor para comparar.

## Versão web
**https://corte-seco.vercel.app** — abra no Chrome ou no Edge (no Mac ou no Windows). Tudo roda no navegador: o vídeo não é enviado para lugar nenhum.
- Para ter um ícone no Dock: menu do Chrome → "Instalar Corte Seco". Depois da primeira visita, abre até sem internet.
- Em Exportar → "Escolher pasta", os vídeos vão direto para uma pasta sua (sem passar pelos Downloads).
- O site é a pasta `site/`, gerada por `python3 web/build.py` a partir de `app/`. Na Vercel: Root Directory = `site`,
  sem comando de build. O `site/vercel.json` liga os cabeçalhos que deixam a transcrição usar vários núcleos.
- Teste local: `python3 web/build.py && node web/serve.mjs` → http://localhost:8766

## Instalar (app de Mac e Windows)
Baixe em **https://github.com/zheus741/corte-seco/releases/latest**. O app avisa sozinho quando sai uma versão nova.
Para gerar instaladores novos: Actions → build → Run workflow (sai uma versão com o número do `package.json`).
- **Mac (M1, M2, M3, M4):** abra o `.zip`/`.dmg` com `arm64` e arraste o Corte Seco para Aplicativos.
  Na primeira vez, se o Mac avisar que não pode verificar o app: Ajustes do Sistema → Privacidade e Segurança →
  "Abrir mesmo assim". (Ou, no Terminal: `xattr -dr com.apple.quarantine "/Applications/Corte Seco.app"`.)
- **Mac Intel:** o arquivo com `x64` (a transcrição usa o motor embutido, mais lento).
- **Windows:** rode o `instalador.exe`. Se o SmartScreen avisar: "Mais informações" → "Executar assim mesmo".

## Transcrição
- No navegador (e no Mac Intel), vários motores trabalham ao mesmo tempo, cada um com mais de um núcleo quando a
  página permite; vídeo curto é dividido em trechos menores para todos trabalharem juntos.
- **Rápida** vem instalada.
- **Precisa** (375 MB) e **Máxima** (1 GB, a melhor em português) baixam uma vez, na primeira vez que você usar.

## IA (opcional)
Em Configurações, cole uma chave da API do Claude para a IA escolher os cortes e escrever título, legenda do post
e hashtags. Só o texto da transcrição é enviado.

## Desenvolvimento
```
npm ci
npm start          # abre o app
npm run dist:mac   # empacota (no Mac)
npm run dist:win   # empacota (no Windows)
```
O editor fica em `app/` (o mesmo código roda no navegador). O motor nativo de transcrição fica em `engine/`.
