FROM node:14-alpine as build
COPY . /aws-azure-login/
RUN cd /aws-azure-login && yarn install && yarn build

FROM node:14-alpine as buildbin
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true" \
    NODE_ENV=production
COPY package.json yarn.lock /aws-azure-login/
RUN cd /aws-azure-login && yarn install --production && \ 
    npm prune --production
COPY --from=build /aws-azure-login/lib /aws-azure-login/lib
RUN npm install -g pkg --production && cd /aws-azure-login && pkg --compress GZip .

FROM alpine:latest
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
RUN apk update && apk upgrade --no-cache --available && \
    apk add --no-cache udev ttf-freefont chromium
COPY --from=buildbin /aws-azure-login/dist/aws-azure-login /aws-azure-login/aws-azure-login

ENTRYPOINT ["/aws-azure-login/aws-azure-login", "--no-sandbox"]
