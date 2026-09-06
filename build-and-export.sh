#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

docker build -f Dockerfile.api -t personal-lab-api:2.5.11 .
docker build -f Dockerfile.web -t personal-lab-web:2.5.11 .
docker save -o personallab-2.5.11-images.tar \
  personal-lab-api:2.5.11 \
  personal-lab-web:2.5.11

echo "Fertig: personallab-2.5.11-images.tar"
echo "EnergieLab und Analyzer wurden weder gebaut noch verändert."
