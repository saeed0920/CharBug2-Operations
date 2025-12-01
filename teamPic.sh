#!/bin/bash

API_URL="http://ip"
USERNAME="admin"
PASSWORD="adminPassword"
IMG_DIR="imgsPath" 
CONTEST_ID=charbug


#cd "$IMG_DIR" || exit 1

for file in *.png; do
  TEAM_ID="${file%.png}"

  echo "Uploading image for team ID: $TEAM_ID"

  curl -X POST \
      "${API_URL}/api/v4/contests/${CONTEST_ID}/teams/${TEAM_ID}/photo" \
      -H "accept: */*" \
      -u  admin:${PASSWORD} \
      -H 'Content-Type: multipart/form-data' \
      -F "photo=@${file};type=image/png"

done


