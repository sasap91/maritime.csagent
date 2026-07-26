FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm install -g maritime-cli
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
