#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
docker build -t energylab:0.4.5 companions/energylab-0.4.5
docker build -f Dockerfile.api -t personal-lab-api:2.5.7 .
docker build -f Dockerfile.web -t personal-lab-web:2.5.7 .
echo "EnergieLab 0.4.5 und PersonalLab 2.5.7 wurden erfolgreich gebaut."
