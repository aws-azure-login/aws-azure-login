"use strict";

const Promise = require("bluebird");
const inquirer = require("inquirer");

const awsConfig = require("./awsConfig");

module.exports = profileName => {
    return Promise.resolve()
        .then(() => awsConfig.getProfileConfig(profileName))
        .then(profile => {
            return inquirer.prompt([{
                name: "tenantId",
                message: "Azure Tenant ID:",
                validate: input => !!input,
                default: profile && profile.azure_tenant_id
            }, {
                name: "appIdUri",
                message: "Azure App ID URI:",
                validate: input => !!input,
                default: profile && profile.azure_app_id_uri
            }, {
                name: "username",
                message: "Default Username:",
                default: profile && profile.azure_default_username
            }, {
                name: "defaultRoleArn",
                message: "Default Role ARN:",
                default: profile && profile.azure_default_role_arn
            }]);
        })
        .then(answers => {
            return awsConfig.setProfileConfigValues(profileName, {
                azure_tenant_id: answers.tenantId,
                azure_app_id_uri: answers.appIdUri,
                azure_default_username: answers.username,
                azure_default_role_arn: answers.defaultRoleArn
            });
        });
};
