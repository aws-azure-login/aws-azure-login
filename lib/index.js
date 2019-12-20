#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
process.on('SIGINT', () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));
const commander_1 = __importDefault(require("commander"));
const configureProfileAsync_1 = require("./configureProfileAsync");
const login_1 = require("./login");
commander_1.default
    .option("-p, --profile <name>", "The name of the profile to log in with (or configure)")
    .option("-a, --all-profiles", "Run for all configured profiles")
    .option("-f, --force-refresh", "Force a credential refresh, even if they are still valid")
    .option("-c, --configure", "Configure the profile")
    .option("-m, --mode <mode>", "'cli' to hide the login page and perform the login through the CLI (default behavior), 'gui' to perform the login through the Azure GUI (more reliable but only works on GUI operating system), 'debug' to show the login page but perform the login through the CLI (useful to debug issues with the CLI login)")
    .option("--no-sandbox", "Disable the Puppeteer sandbox (usually necessary on Linux)")
    .option("--no-prompt", "Do not prompt for input and accept the default choice", false)
    .option("--enable-chrome-network-service", "Enable Chromium's Network Service (needed when login provider redirects with 3XX)")
    .option("--no-verify-ssl", "Disable SSL Peer Verification for connections to AWS (no effect if behind proxy)")
    .option("--enable-chrome-seamless-sso", "Enable Chromium's pass-through authentication with Azure Active Directory Seamless Single Sign-On")
    .option("--no-disable-extensions", "Tell Puppeteer not to pass the --disable-extensions flag to Chromium")
    .parse(process.argv);
const profileName = commander_1.default.profile || process.env.AWS_PROFILE || "default";
const mode = commander_1.default.mode || 'cli';
const disableSandbox = !commander_1.default.sandbox;
const noPrompt = !commander_1.default.prompt;
const enableChromeNetworkService = commander_1.default.enableChromeNetworkService;
const awsNoVerifySsl = !commander_1.default.verifySsl;
const enableChromeSeamlessSso = commander_1.default.enableChromeSeamlessSso;
const forceRefresh = commander_1.default.forceRefresh;
const noDisableExtensions = !commander_1.default.disableExtensions;
Promise.resolve()
    .then(() => {
    if (commander_1.default.allProfiles) {
        return login_1.login.loginAll(mode, disableSandbox, noPrompt, enableChromeNetworkService, awsNoVerifySsl, enableChromeSeamlessSso, forceRefresh, noDisableExtensions);
    }
    if (commander_1.default.configure)
        return configureProfileAsync_1.configureProfileAsync(profileName);
    return login_1.login.loginAsync(profileName, mode, disableSandbox, noPrompt, enableChromeNetworkService, awsNoVerifySsl, enableChromeSeamlessSso, noDisableExtensions);
})
    .catch(err => {
    if (err.name === "CLIError") {
        console.error(err.message);
        process.exit(2);
    }
    else {
        console.log(err);
    }
});
