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

Tudo abre na Edição para ajustar; "Montar de novo…" troca o tipo ou a duração sem analisar de novo.
A análise não enxerga a imagem: lance sem torcida nem narração passa batido.

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
- **Mac (M1, M2, M3, M4):** abra o `.zip`/`.dmg` com `arm64` e arraste o Corte Seco para Aplicativos.
  Na primeira vez, se o Mac avisar que não pode verificar o app: Ajustes do Sistema → Privacidade e Segurança →
  "Abrir mesmo assim". (Ou, no Terminal: `xattr -dr com.apple.quarantine "/Applications/Corte Seco.app"`.)
- **Mac Intel:** o arquivo com `x64` (a transcrição usa o motor embutido, mais lento).
- **Windows:** rode o `instalador.exe`. Se o SmartScreen avisar: "Mais informações" → "Executar assim mesmo".

## Transcrição
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
