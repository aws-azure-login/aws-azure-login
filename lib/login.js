"use strict";

/* eslint-env browser */

const _ = require("lodash");
const Bluebird = require("bluebird");
const inquirer = require("inquirer");
const phantom = require('phantom');
const zlib = Bluebird.promisifyAll(require("zlib"));
const AWS = require("aws-sdk");
const cheerio = require("cheerio");
const uuid = require("uuid");
const debug = require("debug")('aws-azure-login');
const CLIError = require("./CLIError");
const awsConfig = require("./awsConfig");

const sts = new AWS.STS();

module.exports = {
    async loginAsync(profileName) {
        const profile = await this._loadProfileAsync(profileName);

        let instance;
        try {
            debug("Creating PhantomJS instance");
            instance = await phantom.create();

            const [credentials] = await Promise.all([
                this._collectCredentialsAsync(profile.azure_default_username),
                this._loadLoginPageAsync(instance, profile.azure_app_id_uri, profile.azure_tenant_id)
            ]);

            await this._submitLoginAsync(credentials);

            const content = await this._parseLoginResponseAsync();

            const { assertion, role } = await this._parseSamlResponseAsync(content, profile.azure_default_role_arn);

            await this._assumeRoleAsync(profileName, assertion, role);
        } finally {
            debug("Exiting PhantomJS");
            if (instance) await instance.exit();
        }
    },

    async _loadProfileAsync(profileName) {
        const profile = await awsConfig.getProfileConfigAsync(profileName);
        if (!profile) throw new CLIError(`Unknown profile '${profileName}'. You must configure it first.`);
        if (!profile.azure_tenant_id || !profile.azure_app_id_uri) throw new CLIError(`Profile '${profileName}' is not configured properly.`);

        console.log(`Logging in with profile '${profileName}'...`);
        return profile;
    },

    async _collectCredentialsAsync(defaultUsername) {
        debug('Requesting user credentials');
        return await inquirer.prompt([{
            name: "username",
            message: "Username:",
            default: defaultUsername
        }, {
            name: "password",
            message: "Password:",
            type: "password"
        }]);
    },

    async _loadLoginPageAsync(instance, appIdUri, tenantId) {
        debug("Creating PhantomJS page");
        const page = this._page = await instance.createPage();

        debug("Generating UUID for SAML request");
        const id = uuid.v4();
        const samlRequest = `
        <samlp:AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ID="id${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" IsPassive="false" AssertionConsumerServiceURL="https://signin.aws.amazon.com/saml" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
            <Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${appIdUri}</Issuer>
            <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"></samlp:NameIDPolicy>
        </samlp:AuthnRequest>
        `;

        debug("Generated SAML request", samlRequest);

        debug("Deflating SAML");
        const samlBuffer = await zlib.deflateRawAsync(samlRequest);

        debug("Encoding SAML in base64");
        const samlBase64 = samlBuffer.toString('base64');

        const url = `https://login.microsoftonline.com/${tenantId}/saml2?SAMLRequest=${encodeURIComponent(samlBase64)}`;
        debug("Loading Azure login page", url);
        const status = await page.open(url);

        debug("Page opened");
        if (status !== "success") throw new CLIError("Failed to load Azure login page!");

        page.on("onLoadFinished", status => {
            debug("onLoadFinished event triggered");
            if (status === "success") {
                if (this._pageResolve) {
                    this._pageResolve();
                    this._pageResolve = this._pageReject = null;
                }
            } else {
                if (this._pageReject) {
                    this._pageReject();
                    this._pageResolve = this._pageReject = null;
                }
            }
        });

        return page;
    },

    async _submitLoginAsync(credentials) {
        debug("Populating and submitting login form");
        await this._page.evaluate(function (username, password) {
            document.forms[0].login.value = username;
            document.forms[0].passwd.value = password;
            document.forms[0].submit();
        }, credentials.username, credentials.password);

        await this._waitForPageToLoadAsync(this._page);
    },

    async _waitForPageToLoadAsync() {
        debug("Waiting for page to load");
        await new Promise((resolve, reject) => { // Wait for the page to load
            debug("Page loaded");
            this._pageResolve = resolve;
            this._pageReject = reject;
        });
    },

    async _parseLoginResponseAsync() {
        debug("Fetching page content");
        let contentText = await this._page.property("content");

        debug("Content fetched", contentText);

        debug("Parsing content");
        let content = cheerio.load(contentText);

        debug("Looking for error message");
        const errorMessage = content("#recover_container h1").text();
        if (errorMessage) throw new CLIError(`Login failed: ${errorMessage}`);

        // If SAML response, TFA isn't enabled.
        if (content("input[name=SAMLResponse]").length) {
            debug("TFA not enabled.");
            return content;
        }

        debug("TFA is enabled. Looking for message");

        // The message is shown via JS so it takes a little time to show up. Look for it in a loop.
        let tfaResult;
        let i = 0;
        while (true) {
            contentText = await this._page.property("content");
            content = cheerio.load(contentText);
            tfaResult = content("#tfa_results_container>div").filter(function () {
                return content(this).css('display') === 'block';
            });

            if (tfaResult.length) break;

            if (++i > 100) throw new Error("Unable to find TFA message!");

            // Wait some time.
            await Bluebird.delay(100);
        }

        const tfaMessage = tfaResult.text().trim();
        if (tfaMessage) console.log(tfaMessage);

        // Check if verification code is needed.
        if (tfaMessage && tfaMessage.toLowerCase().indexOf("verification code") >= 0) {
            debug("Prompting user for verification code");
            const answers = await inquirer.prompt([{
                name: "verificationCode",
                message: "Verification Code:"
            }]);

            debug('Received code. Populating form in PhantomJS');
            const errorMessage = await this._page.evaluate(function (verificationCode) {
                document.getElementById("tfa_code_inputtext").value = verificationCode;
                document.getElementById("tfa_signin_button").click();

                // Error handling is done client-side, so check to see if the error message displays.
                var errorBox = document.getElementById('tfa_client_side_error_text');
                if (errorBox.style.display === "block") {
                    return errorBox.textContent.trim();
                }
            }, answers.verificationCode);

            if (errorMessage) throw new CLIError(`Login failed: ${errorMessage}`);
        }

        await this._waitForPageToLoadAsync();

        debug("Fetching page content");
        contentText = await this._page.property("content");

        debug("Content fetched", contentText);

        debug("Parsing content");
        return cheerio.load(contentText);
    },

    async _parseSamlResponseAsync(content, defaultRoleArn) {
        debug("Looking for SAML assertion in input field");
        const assertion = content("input[name=SAMLResponse]").val();
        if (!assertion) throw new CLIError("Unable to find SAMLResponse!");

        debug("Found SAML assertion", assertion);

        debug("Converting assertion from base64 to ASCII");
        const samlText = new Buffer(assertion, 'base64').toString("ascii");
        debug("Converted", samlText);

        debug("Parsing SAML XML");
        const saml = cheerio.load(samlText, { xmlMode: true });

        debug("Looking for role SAML attribute");
        const roles = saml("Attribute[Name='https://aws.amazon.com/SAML/Attributes/Role']>AttributeValue").map(function () {
            const roleAndPrincipal = saml(this).text();
            const parts = roleAndPrincipal.split(",");

            // Role / Principal claims may be in either order
            const [roleIdx, principalIdx] = parts[0].indexOf(":role/") >= 0 ? [0, 1] : [1, 0];
            const roleArn = parts[roleIdx].trim();
            const principalArn = parts[principalIdx].trim();
            return { roleArn, principalArn };
        }).get();
        debug("Found roles", roles);

        let role;
        if (roles.length === 0) {
            throw new CLIError("No roles found in SAML response.");
        } else if (roles.length === 1) {
            role = roles[0];
        } else {
            debug("Asking user to choose role");
            const answers = await inquirer.prompt([{
                name: "role",
                message: "Role:",
                type: "list",
                choices: _.map(roles, "roleArn"),
                default: defaultRoleArn
            }]);

            role = _.find(roles, ["roleArn", answers.role]);
        }

        return { assertion, role };
    },

    async _assumeRoleAsync(profileName, assertion, role) {
        console.log(`Assuming role ${role.roleArn}`);
        const res = await sts.assumeRoleWithSAML({
            PrincipalArn: role.principalArn,
            RoleArn: role.roleArn,
            SAMLAssertion: assertion
        }).promise();

        await awsConfig.setProfileCredentialsAsync(profileName, {
            aws_access_key_id: res.Credentials.AccessKeyId,
            aws_secret_access_key: res.Credentials.SecretAccessKey,
            aws_session_token: res.Credentials.SessionToken
        });
    }
};
