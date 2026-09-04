FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production
CMD ["npm","start"]