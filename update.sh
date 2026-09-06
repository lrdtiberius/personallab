#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Abbruch: .env fehlt im Ordner personal-lab-stack." >&2
  exit 1
fi

data_file="/DATA/AppData/personal-lab/personallab.json"
if [ -f "$data_file" ]; then
  backup_file="${data_file}.backup-v2.5.11-$(date +%Y%m%d-%H%M%S)"
  cp -p "$data_file" "$backup_file"
  echo "Datensicherung erstellt: $backup_file"
fi

./build-images.sh
docker compose --env-file .env -f compose.yaml up -d --force-recreate
docker compose --env-file .env -f compose.yaml ps

echo "PersonalLab 2.5.11 ist aktualisiert. Datenordner und .env blieben erhalten."
