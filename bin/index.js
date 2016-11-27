#!/usr/bin/env node

"use strict";

process.on('SIGINT', () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));

const commander = require("commander");
const Promise = require("bluebird");

const configureProfile = require("../lib/configureProfile");
const CLIError = require("../lib/CLIError");
const login = require("../lib/login");

commander
    .option("--profile <name>", "The name of the profile to log in with (or configure)")
    .option("--configure", "Configure the profile")
    .parse(process.argv);

const profileName = commander.profile || "default";

Promise.resolve()
    .then(() => {
        if (commander.configure) return configureProfile(profileName);
        return login(profileName);
    })
    .catch(CLIError, err => {
        console.error(err.message);
    });
