#!/usr/bin/env node

"use strict";

process.on('SIGINT', () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));

const commander = require("commander");

const configureProfileAsync = require("../lib/configureProfileAsync");
const CLIError = require("../lib/CLIError");
const login = require("../lib/login");

commander
    .option("--profile <name>", "The name of the profile to log in with (or configure)")
    .option("--configure", "Configure the profile")
    .option("--mode <mode>", "'cli' to hide the login page and perform the login through the CLI (default behavior), 'gui' to perform the login through the Azure GUI (more reliable but only works on GUI operating system), 'debug' to show the login page but perform the login through the CLI (useful to debug issues with the CLI login)")
    .option("--no-sandbox", "Disable the Puppeteer sandbox (usually necessary on Linux)")
    .parse(process.argv);

const profileName = commander.profile || process.env.AWS_PROFILE || "default";
const mode = commander.mode || 'cli';
const disableSandbox = !commander.sandbox;

Promise.resolve()
    .then(() => {
        if (commander.configure) return configureProfileAsync(profileName);
        return login.loginAsync(profileName, mode, disableSandbox);
    })
    .catch(err => {
        if (err.name === "CLIError") {
            console.error(err.message);
            process.exit(2);
        } else {
            console.log(err);
        }
    });
