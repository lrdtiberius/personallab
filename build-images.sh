#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
docker build -f Dockerfile.api -t personal-lab-api:2.5.11 .
docker build -f Dockerfile.web -t personal-lab-web:2.5.11 .
echo "PersonalLab 2.5.11 wurde erfolgreich gebaut. EnergieLab und Analyzer bleiben unverändert."
