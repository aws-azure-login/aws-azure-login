"use strict";

const os = require("os");
const path = require("path");
const ini = require("ini");
const _ = require("lodash");
const Bluebird = require("bluebird");
const debug = require("debug")('aws-azure-login');
const fs = Bluebird.promisifyAll(require("fs"));

const awsDir = path.join(os.homedir(), ".aws");
const paths = {
    config: path.join(awsDir, "config"),
    credentials: path.join(awsDir, "credentials")
};

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

    async setProfileCredentialsAsync(profileName, values) {
        const credentials = await this._loadAsync("credentials");

        debug(`Setting credentials for profile '${profileName}'`);
        credentials[profileName] = values;
        await this._saveAsync("credentials", credentials);
    },

    async _loadAsync(type) {
        if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);

        debug(`Loading '${type}' file at '${paths[type]}'`);
        const data = await fs.readFileAsync(paths[type], "utf8");

        try {
            debug(`Parsing data`);
            return await ini.parse(data);
        } catch (err) {
            if (err.code === "ENOENT") {
                debug(`File not found. Returning empty object.`);
                return {};
            } else {
                throw err;
            }
        }
    },

    async _saveAsync(type, data) {
        if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);
        if (!data) throw new Error(`You must provide data for saving.`);

        debug(`Stringifying ${type} INI data`);
        const text = ini.stringify(data);

        debug(`Writing '${type}' INI to file '${paths[type]}'`);
        await fs.writeFileAsync(paths[type], text);
    }
};
