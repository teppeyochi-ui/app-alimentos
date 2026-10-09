#!/bin/sh
# Empacota o app em dist/Classificador-Camarao-App.zip (pasta classificador-camarao/ dentro do zip).
# Uso, na pasta classificador-camarao:  sh ferramentas/empacotar.sh
set -e
cd "$(dirname "$0")/.."
node teste-motor.js > /dev/null
mkdir -p dist
rm -f dist/Classificador-Camarao-App.zip
cd ..
zip -q -X -r classificador-camarao/dist/Classificador-Camarao-App.zip \
  classificador-camarao/index.html classificador-camarao/styles.css classificador-camarao/app.js \
  classificador-camarao/core.js classificador-camarao/sw.js classificador-camarao/manifest.webmanifest \
  classificador-camarao/icones classificador-camarao/LEIA-ME.md \
  classificador-camarao/teste-motor.js classificador-camarao/teste-interface.js \
  classificador-camarao/Teste_Classificador.xlsx classificador-camarao/capturas \
  classificador-camarao/ferramentas/gerar-planilha.py classificador-camarao/ferramentas/gerar-icones.js \
  classificador-camarao/ferramentas/icone.svg classificador-camarao/ferramentas/empacotar.sh
echo "dist/Classificador-Camarao-App.zip"
