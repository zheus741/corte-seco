# Corte Seco

Editor de vídeo que roda no seu computador (navegador, Mac e Windows): transcreve, acha os melhores cortes e,
quando você aplica a edição inteligente, tira pausas, vícios e takes repetidos e põe legenda viral, zoom e gancho
com a sua marca. Exporta mais rápido que o tempo real. O vídeo não sai do computador.

O vídeo sempre abre como foi gravado: a edição inteligente só entra quando você clica em **Edição inteligente**
(no alto da tela), escolhe o que entra e aplica. Dá para desfazer ou voltar ao original a qualquer momento.

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
