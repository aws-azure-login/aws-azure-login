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
    .parse(process.argv);

const profileName = commander.profile || process.env.AWS_PROFILE || "default";

Promise.resolve()
    .then(() => {
        if (commander.configure) return configureProfileAsync(profileName);
        return login.loginAsync(profileName);
    })
    .catch(err => {
        if (err.name === "CLIError") {
            console.error(err.message);
            process.exit(2);
        } else {
            console.log(err);
        }
    });
