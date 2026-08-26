#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
docker build -t energylab:0.4.5 companions/energylab-0.4.5
docker build -f Dockerfile.api -t personal-lab-api:1.5.0 .
docker build -f Dockerfile.web -t personal-lab-web:1.5.0 .
echo "EnergieLab 0.4.5 und PersonalLab 1.5.0 wurden erfolgreich gebaut."
