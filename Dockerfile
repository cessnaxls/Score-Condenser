# PDF optical music recognition needs Audiveris, which isn't included in Render's Node runtime.
FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 fontconfig libfreetype6 libfontconfig1 \
    libasound2 libxrender1 libxtst6 libxi6 libxext6 \
    && rm -rf /var/lib/apt/lists/*
# Download official Audiveris Linux .deb from its GitHub release assets at build time.
# Pin to a tested asset URL using AUDIVERIS_DEB_URL if the upstream release changes.
ARG AUDIVERIS_DEB_URL=""
ENV AUDIVERIS_DEB_URL=${AUDIVERIS_DEB_URL}
RUN python3 - <<'PY'
import json,urllib.request,os
url=os.environ.get('AUDIVERIS_DEB_URL') or ''
if not url:
    req=urllib.request.Request('https://api.github.com/repos/Audiveris/audiveris/releases/latest',headers={'User-Agent':'ScoreCondensor-Build','Accept':'application/vnd.github+json'})
    release=json.load(urllib.request.urlopen(req,timeout=30))
    assets=[a for a in release['assets'] if a['name'].lower().endswith('.deb') and ('amd64' in a['name'].lower() or 'x64' in a['name'].lower())]
    if not assets: assets=[a for a in release['assets'] if a['name'].lower().endswith('.deb')]
    if not assets: raise RuntimeError('Audiveris release contains no Linux .deb installer. Supply AUDIVERIS_DEB_URL.')
    url=assets[0]['browser_download_url']
print('Retrieving Audiveris installer:',url)
req=urllib.request.Request(url,headers={'User-Agent':'ScoreCondensor-Build'})
with urllib.request.urlopen(req,timeout=180) as src,open('/tmp/audiveris.deb','wb') as out:
    while (data:=src.read(1024*1024)):out.write(data)
PY
RUN apt-get update && apt-get install -y /tmp/audiveris.deb && rm -rf /var/lib/apt/lists/* /tmp/audiveris.deb
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
EXPOSE 10000
CMD ["sh","./start.sh"]
