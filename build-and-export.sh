#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

docker build -f Dockerfile.api -t personal-lab-api:2.7.2 .
docker build -f Dockerfile.web -t personal-lab-web:2.7.2 .
docker build -f Dockerfile.qwen-scanner -t personallab-qwen-scanner:2.2.0 .
docker save -o personallab-2.7.2-images.tar \
  personal-lab-api:2.7.2 \
  personal-lab-web:2.7.2 \
  personallab-qwen-scanner:2.2.0

echo "Fertig: personallab-2.7.2-images.tar"
echo "EnergieLab und Analyzer wurden weder gebaut noch verändert."
