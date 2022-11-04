# BUILD STAGE
FROM node:18.12.0-slim as builder

WORKDIR /home/node/app

COPY package.json .
RUN npx handpick --target=buildDependencies --manager=yarn

COPY --chown=node:node . .
RUN yarn build

# RUN STAGE
FROM node:18.12.0-slim
LABEL maintainer="Santos <lucas.santos@pagtel.com.br>"

WORKDIR /home/node/app
RUN chown node:node /home/node/app

COPY package.json .
RUN yarn install --production=true

USER node

COPY --from=builder /home/node/app/dist ./dist
RUN mkdir -p ./logs

ENTRYPOINT ["node", "dist/main/server.js"] 