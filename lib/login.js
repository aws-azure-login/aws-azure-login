"use strict";

const _ = require("lodash");
const Bluebird = require("bluebird");
const inquirer = require("inquirer");
const zlib = Bluebird.promisifyAll(require("zlib"));
const AWS = require("aws-sdk");
const cheerio = require("cheerio");
const uuid = require("uuid");
const puppeteer = require('puppeteer');
const querystring = require('querystring');
const debug = require("debug")('aws-azure-login');
const CLIError = require("./CLIError");
const awsConfig = require("./awsConfig");
const proxy = require('proxy-agent');

const WIDTH = 425;
const HEIGHT = 550;
const DELAY_ON_UNRECOGNIZED_PAGE = 1000;
const MAX_UNRECOGNIZED_PAGE_DELAY = 30 * 1000;

if (process.env.https_proxy) {
    AWS.config.update({
        httpOptions: { agent: proxy(process.env.https_proxy) }
    });
}
const sts = new AWS.STS();

/**
 * To proxy the input/output of the Azure login page, it's easiest to run a loop that
 * monitors the state of the page and then perform the corresponding CLI behavior.
 * The states have a name that is used for the debug messages, a selector that is used
 * with puppeteer's page.$(selector) to determine if the state is active, and a handler
 * that is called if the state is active.
 */
const states = [
    {
        name: "username input",
        selector: `input[name="loginfmt"]:not(.moveOffScreen)`,
        async handler(page, _selected, noPrompt, defaultUsername, _defaultPassword) {
            const error = await page.$(".alert-error");
            if (error) {
                debug("Found error message. Displaying");
                const errorMessage = await page.evaluate(err => err.textContent, error);
                console.log(errorMessage);
            }

            var username;

            if (noPrompt && defaultUsername) {
                debug("Not prompting user for username");
                username = defaultUsername;
            } else {
                debug("Prompting user for username");
                ({ username } = await inquirer.prompt([{
                    name: "username",
                    message: "Username:",
                    default: defaultUsername
                }]));
            }

            debug("Focusing on username input");
            await page.focus(`input[name="loginfmt"]`);

            debug("Clearing input");
            for (let i = 0; i < 100; i++) {
                await page.keyboard.press("Backspace");
            }

            debug("Typing username");
            await page.keyboard.type(username);

            debug("Submitting form");
            await page.click("input[type=submit]");

            await Bluebird.delay(500);

            debug("Waiting for submission to finish");
            await Promise.race([
                page.waitForSelector(`input[name=loginfmt].has-error,input[name=loginfmt].moveOffScreen`, { timeout: 60000 }),
                (async () => {
                    await Bluebird.delay(1000);
                    await page.waitForSelector(`input[name=loginfmt]`, { hidden: true, timeout: 60000 });
                })()
            ]);
        }
    },
    {
        name: "password input",
        selector: `input[name="Password"]:not(.moveOffScreen),input[name="passwd"]:not(.moveOffScreen)`,
        async handler(page, _selected, noPrompt, _defaultUsername, defaultPassword) {
            const error = await page.$(".alert-error");
            if (error) {
                debug("Found error message. Displaying");
                const errorMessage = await page.evaluate(err => err.textContent, error);
                console.log(errorMessage);
                defaultPassword = ''; // Password error. Unset the default and allow user to enter it.
            }

            var password;

            if (noPrompt && defaultPassword) {
                debug("Not prompting user for password");
                password = defaultPassword;
            } else {
                debug("Prompting user for password");
                ({ password } = await inquirer.prompt([{
                    name: "password",
                    message: "Password:",
                    type: "password"
                }]));
            }

            debug("Focusing on password input");
            await page.focus(`input[name="Password"],input[name="passwd"]`);

            debug("Typing password");
            await page.keyboard.type(password);

            debug("Submitting form");
            await page.click("span[class=submit],input[type=submit]");

            debug("Waiting for a delay");
            await Bluebird.delay(500);
        }
    },
    {
        name: 'TFA instructions',
        selector: `#idDiv_SAOTCAS_Description`,
        async handler(page, selected) {
            const descriptionMessage = await page.evaluate(description => description.textContent, selected);
            console.log(descriptionMessage);

            debug("Waiting for response");
            await page.waitForSelector(`#idDiv_SAOTCAS_Description`, { hidden: true, timeout: 60000 });
        }
    },
    {
        name: 'TFA failed',
        selector: `#idDiv_SAASDS_Description,#idDiv_SAASTO_Description`,
        async handler(page, selected) {
            const descriptionMessage = await page.evaluate(description => description.textContent, selected);
            throw new CLIError(descriptionMessage);
        }
    },
    {
        name: 'TFA code input',
        selector: "input[name=otc]:not(.moveOffScreen)",
        async handler(page) {
            const error = await page.$(".alert-error");
            if (error) {
                debug("Found error message. Displaying");
                const errorMessage = await page.evaluate(err => err.textContent, error);
                console.log(errorMessage);
            } else {
                const description = await page.$("#idDiv_SAOTCC_Description");
                const descriptionMessage = await page.evaluate(description => description.textContent, description);
                console.log(descriptionMessage);
            }

            const { verificationCode } = await inquirer.prompt([{
                name: "verificationCode",
                message: "Verification Code:"
            }]);

            debug("Focusing on verification code input");
            await page.focus(`input[name="otc"]`);

            debug("Clearing input");
            for (let i = 0; i < 100; i++) {
                await page.keyboard.press("Backspace");
            }

            debug("Typing verification code");
            await page.keyboard.type(verificationCode);

            debug("Submitting form");
            await page.click("input[type=submit]");

            debug("Waiting for submission to finish");
            await Promise.race([
                page.waitForSelector(`input[name=otc].has-error,input[name=otc].moveOffScreen`, { timeout: 60000 }),
                (async () => {
                    await Bluebird.delay(1000);
                    await page.waitForSelector(`input[name=otc]`, { hidden: true, timeout: 60000 });
                })()
            ]);
        }
    },
    {
        name: "Remember me",
        selector: `#KmsiDescription`,
        async handler(page) {
            debug("Clicking don't remember button");
            await page.click("#idBtn_Back");

            debug("Waiting for a delay");
            await Bluebird.delay(500);
        }
    },
    {
        name: "Service exception",
        selector: "#service_exception_message",
        async handler(page, selected) {
            const descriptionMessage = await page.evaluate(description => description.textContent, selected);
            throw new CLIError(descriptionMessage);
        }
    }
];

module.exports = {
    async loginAsync(profileName, mode, disableSandbox, noPrompt) {
        let headless, cliProxy;
        if (mode === 'cli') {
            headless = true;
            cliProxy = true;
        } else if (mode === 'gui') {
            headless = false;
            cliProxy = false;
        } else if (mode === 'debug') {
            headless = false;
            cliProxy = true;
        } else {
            throw new CLIError('Invalid mode');
        }

        const profile = await this._loadProfileAsync(profileName);
        const loginUrl = await this._createLoginUrlAsync(profile.azure_app_id_uri, profile.azure_tenant_id);
        const samlResponse = await this._performLoginAsync(loginUrl, headless, disableSandbox, cliProxy, noPrompt, profile.azure_default_username, profile.azure_default_password);
        const roles = this._parseRolesFromSamlResponse(samlResponse);
        const { role, durationHours } = await this._askUserForRoleAndDurationAsync(roles, noPrompt, profile.azure_default_role_arn, profile.azure_default_duration_hours);
        await this._assumeRoleAsync(profileName, samlResponse, role, durationHours);
    },

    /**
     * Gather data from environment variables
     * @returns {string} Object of environment variables
     * @private
     */
    _loadProfileFromEnv() {
        var env = {};
        var options = [
            'azure_tenant_id',
            'azure_app_id_uri',
            'azure_default_username',
            'azure_default_password',
            'azure_default_role_arn',
            'azure_default_duration_hours'
        ];
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (process.env[opt]) {
                env[opt] = process.env[opt];
            } else if (process.env[opt.toUpperCase()]) {
                env[opt] = process.env[opt.toUpperCase()];
            }
        }
        const safe_env = Object.assign({}, env, { azure_default_password: 'xxxxxxxxxx' });
        debug('Environment');
        debug(safe_env);
        return env;
    },

    /**
     * Load the profile.
     * @param {string} profileName - The name of the profile.
     * @returns {Promise.<{}>} The profile.
     * @private
     */
    async _loadProfileAsync(profileName) {
        const profile = await awsConfig.getProfileConfigAsync(profileName);
        if (!profile) throw new CLIError(`Unknown profile '${profileName}'. You must configure it first with --configure.`);

        var env = this._loadProfileFromEnv();
        for (var prop in env) {
            if (env.hasOwnProperty(prop)) {
                profile[prop] = env[prop] === null ? profile[prop] : env[prop];
            }
        }

        if (!profile.azure_tenant_id || !profile.azure_app_id_uri) throw new CLIError(`Profile '${profileName}' is not configured properly.`);

        console.log(`Logging in with profile '${profileName}'...`);
        return profile;
    },

    /**
     * Create the Azure login SAML URL.
     * @param {string} appIdUri - The app ID URI
     * @param {string} tenantId - The Azure tenant ID
     * @returns {string} The login URL
     * @private
     */
    async _createLoginUrlAsync(appIdUri, tenantId) {
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
        debug("Created login URL", url);

        return url;
    },

    /**
     * Perform the login using Chrome.
     * @param {string} url - The login URL
     * @param {boolean} headless - True to hide the GUI, false to show it.
     * @param {boolean} disableSandbox - True to disable the Puppeteer sandbox.
     * @param {boolean} cliProxy - True to proxy input/output through the CLI, false to leave it in the GUI
     * @param {bool} [noPrompt] - Enable skipping of user prompting
     * @param {string} [defaultUsername] - The default username
     * @param {string} [defaultPassword] - The default password
     * @returns {Promise.<string>} The SAML response.
     * @private
     */
    async _performLoginAsync(url, headless, disableSandbox, cliProxy, noPrompt, defaultUsername, defaultPassword) {
        debug("Loading login page in Chrome");
        let browser;
        try {
            const args = headless ? [] : [`--app=${url}`, `--window-size=${WIDTH},${HEIGHT}`];
            if (disableSandbox) args.push('--no-sandbox');

            browser = await puppeteer.launch({
                headless,
                args
            });

            // Wait for a bit as sometimes the browser isn't ready.
            await Bluebird.delay(200);

            const pages = await browser.pages();
            const page = pages[0];
            await page.setViewport({ width: WIDTH - 15, height: HEIGHT - 35 });

            // Prevent redirection to AWS
            let samlResponseData;
            const samlResponsePromise = new Promise(resolve => {
                page.on('request', req => {
                    const url = req.url();
                    debug(`Request: ${url}`);
                    if (url === 'https://signin.aws.amazon.com/saml') {
                        resolve();
                        samlResponseData = req.postData();
                        req.respond({
                            status: 200,
                            contentType: 'text/plain',
                            body: ''
                        });
                        browser.close();
                    } else {
                        req.continue();
                    }
                });
            });

            debug("Enabling request interception");
            await page.setRequestInterception(true);

            if ((headless) || (!headless && cliProxy)) {
                debug("Going to login page");
                await page.goto(url, { waitUntil: 'domcontentloaded' });
            } else {
                debug("Waiting for login page to load");
                await page.waitForNavigation({ waitUntil: 'networkidle0' });
            }

            if (cliProxy) {
                let totalUnrecognizedDelay = 0;
                while (true) {
                    if (samlResponseData) break;

                    let foundState = false;
                    for (let i = 0; i < states.length; i++) {
                        const state = states[i];

                        let selected;
                        try {
                            selected = await page.$(state.selector);
                        } catch (err) {
                            // An error can be thrown if the page isn't in a good state.
                            // If one occurs, try again after another loop.
                            break;
                        }

                        if (selected) {
                            foundState = true;
                            debug(`Found state: ${state.name}`);

                            await Promise.race([
                                samlResponsePromise,
                                state.handler(page, selected, noPrompt, defaultUsername, defaultPassword)
                            ]);

                            debug(`Finished state: ${state.name}`);

                            break;
                        }
                    }

                    if (foundState) {
                        totalUnrecognizedDelay = 0;
                    } else {
                        debug("State not recognized!");
                        if (totalUnrecognizedDelay > MAX_UNRECOGNIZED_PAGE_DELAY) {
                            const path = 'aws-azure-login-unrecognized-state.png';
                            await page.screenshot({ path });
                            throw new CLIError(`Unable to recognize page state! A screenshot has been dumped to ${path}. If this problem persists, try running with --mode=gui or --mode=debug`);
                        }

                        totalUnrecognizedDelay += DELAY_ON_UNRECOGNIZED_PAGE;
                        await Bluebird.delay(DELAY_ON_UNRECOGNIZED_PAGE);
                    }
                }
            } else {
                console.log("Please complete the login in the opened window");
                await samlResponsePromise;
            }

            const samlResponse = querystring.parse(samlResponseData).SAMLResponse;
            debug("Found SAML response", samlResponse);

            return samlResponse;
        } finally {
            if (browser) browser.close();
        }
    },

    /**
     * Parse AWS roles out of the SAML response
     * @param {string} assertion - The SAML assertion
     * @returns {Array.<{roleArn: string, principalArn: string}>} The roles
     * @private
     */
    _parseRolesFromSamlResponse(assertion) {
        debug("Converting assertion from base64 to ASCII");
        const samlText = new Buffer.from(assertion, 'base64').toString("ascii");
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
        return roles;
    },

    /**
     * Ask the user for the role they want to use.
     * @param {Array.<{roleArn: string, principalArn: string}>} roles - The roles to pick from
     * @param {bool} [noPrompt] - Enable skipping of user prompting
     * @param {string} [defaultRoleArn] - The default role ARN
     * @param {number} [defaultDurationHours] - The default session duration in hours
     * @returns {Promise.<{role: string, durationHours: number}>} The selected role and duration
     * @private
     */
    async _askUserForRoleAndDurationAsync(roles, noPrompt, defaultRoleArn, defaultDurationHours) {
        let role;
        let durationHours;
        const questions = [];
        if (roles.length === 0) {
            throw new CLIError("No roles found in SAML response.");
        } else if (roles.length === 1) {
            debug("Choosing the only role in response");
            role = roles[0];
        } else if (noPrompt && defaultRoleArn) {
            role = _.find(roles, ["roleArn", defaultRoleArn]);
        } else {
            if (noPrompt && defaultRoleArn) {
                role = _.find(roles, ["roleArn", defaultRoleArn]);
            }

            if (role) {
                debug("Valid role found. No need to ask.");
            } else {
                debug("Asking user to choose role");
                questions.push({
                    name: "role",
                    message: "Role:",
                    type: "list",
                    choices: _.map(roles, "roleArn"),
                    default: defaultRoleArn
                });
            }
        }

        if (noPrompt && defaultDurationHours) {
            durationHours = defaultDurationHours;
        } else {
            questions.push({
                name: "durationHours",
                message: "Session Duration Hours (up to 12):",
                type: "input",
                default: defaultDurationHours || 1,
                validate(input) {
                    input = Number(input);
                    if (input > 0 && input <= 12) return true;
                    return 'Duration hours must be between 0 and 12';
                }
            });
        }

        const answers = await inquirer.prompt(questions);
        if (!role) role = _.find(roles, ["roleArn", answers.role]);
        if (!durationHours) durationHours = answers.durationHours;
        return { role, durationHours };
    },

    /**
     * Assume the role.
     * @param {string} profileName - The profile name
     * @param {string} assertion - The SAML assertion
     * @param {string} role - The role to assume
     * @param {number} durationHours - The session duration in hours
     * @returns {Promise} A promise
     * @private
     */
    async _assumeRoleAsync(profileName, assertion, role, durationHours) {
        console.log(`Assuming role ${role.roleArn}`);
        const res = await sts.assumeRoleWithSAML({
            PrincipalArn: role.principalArn,
            RoleArn: role.roleArn,
            SAMLAssertion: assertion,
            DurationSeconds: Math.round(durationHours * 60 * 60)
        }).promise();

        await awsConfig.setProfileCredentialsAsync(profileName, {
            aws_access_key_id: res.Credentials.AccessKeyId,
            aws_secret_access_key: res.Credentials.SecretAccessKey,
            aws_session_token: res.Credentials.SessionToken
        });
    }
};
