"use strict";

const os = require("os");
const path = require("path");
const ini = require("ini");
const _ = require("lodash");
const Promise = require("bluebird");
const debug = require("debug")('aws-azure-login');
const fs = Promise.promisifyAll(require("fs"));

const awsDir = path.join(os.homedir(), ".aws");
const paths = {
    config: path.join(awsDir, "config"),
    credentials: path.join(awsDir, "credentials")
};

module.exports = {
    setProfileConfigValues(profileName, values) {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Setting config for profile '${profileName}' in section '${sectionName}'`);
        return this._load("config")
            .then(config => {
                config[sectionName] = _.assign(config[sectionName], values);
                config[sectionName] = _.omitBy(config[sectionName], _.isNil);
                return this._save("config", config);
            });
    },

    getProfileConfig(profileName) {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Getting config for profile '${profileName}' in section '${sectionName}'`);
        return this._load("config")
            .then(config => config[sectionName]);
    },

    setProfileCredentials(profileName, values) {
        return this._load("credentials")
            .then(credentials => {
                debug(`Setting credentials for profile '${profileName}'`);
                credentials[profileName] = values;
                return this._save("credentials", credentials);
            });
    },

    _load(type) {
        return Promise.resolve()
            .then(() => {
                if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);
            })
            .then(() => {
                debug(`Loading '${type}' file at '${paths[type]}'`);
                return fs.readFileAsync(paths[type], "utf8");
            })
            .then(data => {
                debug(`Parsing data`);
                return ini.parse(data);
            })
            .catch(err => {
                if (err.code === "ENOENT") {
                    debug(`File not found. Returning empty object.`);
                    return {};
                } else {
                    throw err;
                }
            });
    },

    _save(type, data) {
        return Promise.resolve()
            .then(() => {
                if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);
                if (!data) throw new Error(`You must provide data for saving.`);
            })
            .then(() => {
                debug(`Stringifying ${type} INI data`);
                const text = ini.stringify(data);
                debug(`Writing '${type}' INI to file '${paths[type]}'`);
                return fs.writeFileAsync(paths[type], text);
            });
    }
};
