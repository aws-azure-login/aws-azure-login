"use strict";

const os = require("os");
const path = require("path");
const ini = require("ini");
const _ = require("lodash");
const Bluebird = require("bluebird");
const debug = require("debug")('aws-azure-login');
const fs = Bluebird.promisifyAll(require("fs"));
const mkdirpAsync = Bluebird.promisify(require("mkdirp"));

const awsDir = path.join(os.homedir(), ".aws");
const paths = {
    config: process.env.AWS_CONFIG_FILE || path.join(awsDir, "config"),
    credentials: process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(awsDir, "credentials")
};

// Autorefresh credential time limit in minutes
const refreshLimit = 11;

module.exports = {
    async setProfileConfigValuesAsync(profileName, values) {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Setting config for profile '${profileName}' in section '${sectionName}'`);
        const config = await this._loadAsync("config");
        config[sectionName] = _.assign(config[sectionName], values);
        config[sectionName] = _.omitBy(config[sectionName], _.isNil);
        await this._saveAsync("config", config);
    },

    async getProfileConfigAsync(profileName) {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Getting config for profile '${profileName}' in section '${sectionName}'`);
        const config = await this._loadAsync("config");
        return config[sectionName];
    },

    async isProfileAboutToExpireAsync(profileName) {
        debug(`Getting credentials for profile '${profileName}'`);
        const config = await this._loadAsync("credentials");
        const refreshLimitInMs = refreshLimit * 60 * 1000;
        let expirationDate;

        if (config[profileName] === undefined || config[profileName].aws_expiration === undefined) {
            expirationDate = new Date();
        } else {
            expirationDate = Date.parse(config[profileName].aws_expiration);
        }

        const timeDifference = expirationDate - new Date();
        debug(`Remaining time till credential expiration: ${timeDifference / 1000}s, refresh due if time lower than: ${refreshLimitInMs / 1000}s`);
        return (timeDifference < refreshLimitInMs);
    },

    async setProfileCredentialsAsync(profileName, values) {
        const credentials = await this._loadAsync("credentials");

        debug(`Setting credentials for profile '${profileName}'`);
        credentials[profileName] = values;
        await this._saveAsync("credentials", credentials);
    },

    async getAllProfileNames() {
        debug(`Getting all configured profiles from config.`);
        const config = await this._loadAsync("config");

        const profiles = Object.keys(config).map(function (e) {
            return e.replace("profile ", "");
        });
        debug(`Received profiles: ${profiles.toString()}`);
        return profiles;
    },

    async _loadAsync(type) {
        if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);

        let data;
        try {
            debug(`Loading '${type}' file at '${paths[type]}'`);
            data = await fs.readFileAsync(paths[type], "utf8");
        } catch (err) {
            if (err.code === "ENOENT") {
                debug(`File not found. Returning empty object.`);
                return {};
            } else {
                throw err;
            }
        }

        debug(`Parsing data`);
        return await ini.parse(data);
    },

    async _saveAsync(type, data) {
        if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);
        if (!data) throw new Error(`You must provide data for saving.`);

        debug(`Stringifying ${type} INI data`);
        const text = ini.stringify(data);

        debug(`Creating AWS config directory '${awsDir}' if not exists.`);
        await mkdirpAsync(awsDir);
        
        debug(`Writing '${type}' INI to file '${paths[type]}'`);
        await fs.writeFileAsync(paths[type], text);
    }
};
