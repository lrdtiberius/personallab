#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

docker build -t energylab:0.4.5 companions/energylab-0.4.5
docker build -f Dockerfile.api -t personal-lab-api:2.5.7 .
docker build -f Dockerfile.web -t personal-lab-web:2.5.7 .
docker save -o personallab-2.5.7-energylab-0.4.5-images.tar \
  energylab:0.4.5 \
  personal-lab-api:2.5.7 \
  personal-lab-web:2.5.7

echo "Fertig: personallab-2.5.7-energylab-0.4.5-images.tar"
echo "EnergieLab 0.4.5 liefert PersonalLab exakt dieselben berechneten Werte wie sein Dashboard."
