FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY publisher-worker/package.json publisher-worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && chown -R pwuser:pwuser /app
COPY --chown=pwuser:pwuser publisher-worker/src ./src
USER pwuser
ENV NODE_ENV=production PORT=8080 PUBLISHER_CONCURRENCY=2
EXPOSE 8080
CMD ["node", "src/index.mjs"]
