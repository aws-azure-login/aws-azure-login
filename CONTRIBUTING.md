# Contributing

## Get started

This project is written in TypeScript and is using prettier and eslint for code formatting. You need node v12.

1. Install node v12. I recommend installing that with nvm: https://github.com/nvm-sh/nvm

```sh
nvm install 12
```

2. Make node v12 default

```sh
nvm alias default 12
```

3. Open a new terminal and verify node version (should return v12.X.X)

```sh
node -v
```

4. Fork and clone project

```sh
git clone git@github.com:<GITHUB_USERNAME>/aws-azure-login.git
cd aws-azure-login
```

5. Install dependencies

```sh
npm install
```

6a. Start dev mode

```sh
npm start
```

6b. Start prod mode

```sh
npm run build && node ./lib/index.js
```
