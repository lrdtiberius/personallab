#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
docker build -f Dockerfile.api -t personal-lab-api:2.7.2 .
docker build -f Dockerfile.web -t personal-lab-web:2.7.2 .
docker build -f Dockerfile.qwen-scanner -t personallab-qwen-scanner:2.2.0 .
echo "PersonalLab 2.7.2 wurde erfolgreich gebaut. EnergieLab und Analyzer bleiben unverändert."
