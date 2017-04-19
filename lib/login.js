"use strict";

/* eslint-env browser */

const _ = require("lodash");
const Promise = require("bluebird");
const inquirer = require("inquirer");
const phantom = require('phantom');
const zlib = Promise.promisifyAll(require("zlib"));
const AWS = require("aws-sdk");
const cheerio = require("cheerio");
const uuid = require("node-uuid");
const debug = require("debug")('aws-azure-login');
const CLIError = require("./CLIError");
const awsConfig = require("./awsConfig");

const sts = Promise.promisifyAll(new AWS.STS());

module.exports = profileName => {
    let profile, instance, page, pageResolve, assertion;
    return Promise.resolve()
        .then(() => awsConfig.getProfileConfig(profileName))
        .then(_profile => {
            profile = _profile;

            if (!profile) throw new CLIError(`Unknown profile '${profileName}'. You must configure it first.`);
            if (!profile.azure_tenant_id || !profile.azure_app_id_uri) throw new CLIError(`Profile '${profileName}' is not configured properly.`);

            // Create a promise to capture the user credentials.
            const credentialsPromise = Promise.resolve()
                .then(() => {
                    debug('Requesting user credentials');
                    return inquirer.prompt([{
                        name: "username",
                        message: "Username:",
                        default: profile.azure_default_username
                    }, {
                        name: "password",
                        message: "Password:",
                        type: "password"
                    }]);
                });

            // Create a promise to initialize PhantomJS and load the login page.
            const phantomPromise = Promise.resolve()
                .then(() => {
                    debug("Creating PhantomJS instance");
                    return phantom.create();
                })
                .then(_instance => {
                    instance = _instance;

                    debug("Creating PhantomJS page");
                    return instance.createPage();
                })
                .then(_page => {
                    page = _page;

                    debug("Generating UUID for SAML request");
                    const id = uuid.v4();
                    const samlRequest = `
                    <samlp:AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ID="id${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" IsPassive="false" AssertionConsumerServiceURL="https://signin.aws.amazon.com/saml" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
                        <Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${profile.azure_app_id_uri}</Issuer>
                        <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"></samlp:NameIDPolicy>
                    </samlp:AuthnRequest>
                    `;

                    debug("Generated SAML request", samlRequest);

                    debug("Deflating SAML");
                    return zlib.deflateRawAsync(samlRequest);
                })
                .then(samlBuffer => {
                    debug("Encoding SAML in base64");
                    const samlBase64 = samlBuffer.toString('base64');

                    const url = `https://login.microsoftonline.com/${profile.azure_tenant_id}/saml2?SAMLRequest=${encodeURIComponent(samlBase64)}`;
                    debug("Loading Azure login page", url);
                    return page.open(url);
                })
                .then(status => {
                    debug("Page opened");
                    if (status !== "success") throw new CLIError("Failed to load Azure login page!");

                    page.on("onLoadFinished", () => {
                        debug("onLoadFinished event triggered");
                        if (pageResolve) {
                            pageResolve();
                            pageResolve = null;
                        }
                    });
                });

            // Run the promises in parallel so we are loading the login page while we wait for the user to input the credentials.
            return Promise.all([credentialsPromise, phantomPromise]);
        })
        .spread(answers => {
            debug("User input captured. Populating form in PhantomJS");
            return page.evaluate(function (username, password) {
                document.forms[0].login.value = username;
                document.forms[0].passwd.value = password;
                document.forms[0].submit();
            }, answers.username, answers.password);
        })
        .then(() => {
            debug("Waiting for page to load");
            return new Promise((resolve, rejected) => {
                debug("Page loaded");
                pageResolve = resolve;
            });
        })
        .then(() => {
            debug("Fetching page content");
            return page.property("content");
        })
        .then(contentText => {
            debug("Content fetched", contentText);

            debug("Parsing content");
            const content = cheerio.load(contentText);

            debug("Looking for error message");
            const errorMessage = content("#recover_container h1").text();
            if (errorMessage) throw new CLIError(`Login failed: ${errorMessage}`);

            // If SAML response, TFA isn't enabled.
            if (content("input[name=SAMLResponse]").length) return content;

            const tfaResult = content("#tfa_results_container>div").filter(function () {
                return content(this).css('display') === 'block';
            });

            const tfaMessage = tfaResult.text().trim();
            if (tfaMessage) console.log(tfaMessage);

            return Promise.resolve()
                .then(() => {
                    // Check if verification code is needed.
                    if (tfaMessage && tfaMessage.toLowerCase().indexOf("verification code") < 0) return;

                    debug("Prompting user for verification code");
                    return inquirer.prompt([{
                        name: "verificationCode",
                        message: "Verification Code:"
                    }])
                        .then(answers => {
                            debug('Received code. Populating form in PhantomJS');
                            return page.evaluate(function (verificationCode) {
                                document.getElementById("tfa_code_inputtext").value = verificationCode;
                                document.getElementById("tfa_signin_button").click();

                                // Error handling is done client-side, so check to see if the error message displays.
                                var errorBox = document.getElementById('tfa_client_side_error_text');
                                if (errorBox.style.display === "block") {
                                    return errorBox.textContent.trim();
                                }
                            }, answers.verificationCode);
                        })
                        .then(errorMessage => {
                            if (errorMessage) throw new CLIError(`Login failed: ${errorMessage}`);
                        });
                })
                .then(() => {
                    debug("Waiting for page to load");
                    return new Promise((resolve, rejected) => { // Wait for the page to load
                        debug("Page loaded");
                        pageResolve = resolve;
                    });
                })
                .then(() => {
                    debug("Fetching page content");
                    return page.property("content");
                })
                .then(contentText => {
                    debug("Content fetched", contentText);

                    debug("Parsing content");
                    return cheerio.load(contentText);
                });
        })
        .then(content => {
            debug("Looking for SAML assertion in input field");
            assertion = content("input[name=SAMLResponse]").val();
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
                const roleArn = parts[0].trim();
                const principalArn = parts[1].trim();
                return { roleArn, principalArn };
            }).get();
            debug("Found roles", roles);

            if (roles.length === 1) return roles[0];

            debug("Asking user to choose role");
            return inquirer.prompt([{
                name: "role",
                message: "Role:",
                type: "list",
                choices: _.map(roles, "roleArn")
            }])
                .then(answers => _.find(roles, ["roleArn", answers.role]));
        })
        .then(role => {
            console.log(`Assuming role ${role.roleArn}`);
            return sts.assumeRoleWithSAMLAsync({
                PrincipalArn: role.principalArn,
                RoleArn: role.roleArn,
                SAMLAssertion: assertion
            });
        })
        .then(res => {
            return awsConfig.setProfileCredentials(profileName, {
                aws_access_key_id: res.Credentials.AccessKeyId,
                aws_secret_access_key: res.Credentials.SecretAccessKey,
                aws_session_token: res.Credentials.SessionToken
            });
        })
        .finally(() => {
            debug("Exiting PhantomJS");
            return instance && instance.exit();
        });
};
