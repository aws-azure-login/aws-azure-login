# Contributing

## Get started

This project is written in TypeScript and is using prettier and eslint for code formatting. You need node v14.

1. Install node v14. I recommend installing that with nvm: https://github.com/nvm-sh/nvm

```sh
nvm install 14
```

2. Make node v14 default

```sh
nvm alias default 14
```

3. Open a new terminal and verify node version (should return v14.X.X)

```sh
node -v
```

4. Install yarn

```sh
npm install -g yarn
```

5. Fork and clone project

```sh
git clone git@github.com:<GITHUB_USERNAME>/aws-azure-login.git
cd aws-azure-login
```

6. Install dependencies

```sh
yarn install
```

7a. Start dev mode

```sh
yarn start
```

7b. Start prod mode

```sh
yarn build && node ./lib/index.js
```
